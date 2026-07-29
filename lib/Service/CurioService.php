<?php

declare(strict_types=1);

namespace OCA\Curio\Service;

use OCA\Curio\Db\Board;
use OCA\Curio\Db\BoardMapper;
use OCA\Curio\Db\Comment;
use OCA\Curio\Db\CommentMapper;
use OCA\Curio\Db\Folder;
use OCA\Curio\Db\FolderMapper;
use OCA\Curio\Db\Reference;
use OCA\Curio\Db\ReferenceMapper;
use OCA\Curio\Db\Setting;
use OCA\Curio\Db\SettingMapper;
use OCA\Curio\Db\Tag;
use OCA\Curio\Db\TagMapper;
use OCP\Constants;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IConfig;
use OCP\IDBConnection;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Share\IManager as IShareManager;
use OCP\Share\IShare;
use Psr\Log\LoggerInterface;

/**
 * All Curio business logic. Controllers stay thin and call into here.
 * The acting user is always the current session user; everything is scoped to
 * boards the user owns or that are shared with them.
 */
class CurioService {
	private const BOARD_COLORS = ['#0069c2', '#00897b', '#5e35b1', '#00838f', '#3949ab', '#6d4c41', '#00695c'];
	private const UPLOAD_PREFIX = 'curio-upload:';
	/** img sentinel meaning "the thumbnail is the reference's own file in the board folder". */
	public const FILE_MARKER = 'curio-file';
	/** img sentinel meaning "media is missing (imported row with no file yet)". */
	public const FILE_MISSING = 'curio-missing';

	public function __construct(
		private BoardMapper $boards,
		private ReferenceMapper $references,
		private TagMapper $tags,
		private FolderMapper $folders,
		private CommentMapper $comments,
		private SettingMapper $settings,
		private IUserSession $userSession,
		private IUserManager $userManager,
		private IDBConnection $db,
		private FetcherService $fetcher,
		private StorageService $storage,
		private TagService $tagService,
		private IConfig $config,
		private IShareManager $shareManager,
		private LoggerInterface $logger,
	) {
	}

	/** The Nextcloud permission bitmask an "edit" collaborator gets on the board folder. */
	private const PERM_EDIT = Constants::PERMISSION_READ | Constants::PERMISSION_UPDATE | Constants::PERMISSION_CREATE | Constants::PERMISSION_DELETE;

	public function uid(): string {
		$user = $this->userSession->getUser();
		return $user !== null ? $user->getUID() : '';
	}

	private function displayName(string $uid): string {
		$u = $this->userManager->get($uid);
		return $u !== null ? $u->getDisplayName() : $uid;
	}

	/* ===================== STATE ===================== */

	/** Full bootstrap payload for the current user. */
	public function getState(): array {
		$uid = $this->uid();

		// First run (or the chosen folder went missing): ask the user to create or
		// pick the base folder before doing any board discovery or file work.
		if (!$this->storage->baseConfigured($uid) || !$this->storage->baseExists($uid)) {
			return [
				'currentUser' => ['uid' => $uid, 'displayName' => $this->displayName($uid)],
				'needsFolderSetup' => true,
				'folderConfigured' => $this->storage->baseConfigured($uid),
				'suggestedFolder' => StorageService::DEFAULT_BASE,
				'boards' => [],
				'references' => [],
				'tags' => [],
				'folders' => [],
				'settings' => $this->getSettings(),
			];
		}

		// Adopt any folders created directly under the base folder as boards.
		$this->discoverBoards($uid);

		$owned = $this->boards->findOwned($uid);
		if (count($owned) === 0) {
			$owned = [$this->createDefaultBoard($uid)];
		}
		$shared = $this->boards->findSharedWith($uid);

		// Sync each board's folder with the database: pick up files dropped in
		// through Files, drop references whose file was removed, and back-fill
		// files for references that do not have one yet.
		$this->reconcileOwnedBoards($owned);
		foreach ($shared as $b) {
			$this->reconcileBoard($b, false);
		}

		// One-time migration of the legacy app tags to NC system tags (needs file ids).
		$this->migrateTagsForUser($uid, $owned);

		$boardOut = [];
		$boardIds = [];
		foreach ($owned as $b) {
			$boardIds[] = $b->getId();
			$boardOut[] = $this->serializeBoard($b, $uid);
		}
		foreach ($shared as $b) {
			$boardIds[] = $b->getId();
			$boardOut[] = $this->serializeBoard($b, $uid);
		}

		$refs = $this->references->findByBoards($boardIds);
		$refIds = array_map(static fn (Reference $r) => $r->getId(), $refs);
		$fileIds = array_values(array_filter(array_map(static fn (Reference $r) => $r->getFileId(), $refs), static fn ($v) => $v !== null));
		$tagsByFile = $this->tagService->tagsForFiles($fileIds);
		$commentMap = $this->comments->commentsForRefs($refIds);
		$refOut = [];
		foreach ($refs as $r) {
			$this->ensureImageDims($r);
			$this->ensureGeo($r);
			$data = $r->jsonSerialize();
			$data['tags'] = ($r->getFileId() !== null) ? ($tagsByFile[$r->getFileId()] ?? []) : [];
			$data['comments'] = $commentMap[$r->getId()] ?? [];
			$refOut[] = $data;
		}

		return [
			'currentUser' => ['uid' => $uid, 'displayName' => $this->displayName($uid)],
			'boards' => $boardOut,
			'references' => $refOut,
			'tags' => $this->tagService->listTags($fileIds, $uid),
			'folders' => array_map(static fn (Folder $f) => $f->jsonSerialize(), $this->folders->findOwned($uid)),
			'settings' => $this->getSettings(),
		];
	}

	private function serializeBoard(Board $b, string $uid): array {
		$mine = $b->getOwner() === $uid;
		return [
			'id' => $b->getId(),
			'name' => $b->getName(),
			'owner' => $b->getOwner(),
			'ownerDisplayName' => $this->displayName($b->getOwner()),
			'color' => $b->getColor(),
			'location' => $b->getLocation(),
			'mine' => $mine,
			'visible' => $mine,
			'sharedWith' => $mine ? $this->boardShares($b->getId()) : [],
		];
	}

	/* ===================== BOARDS ===================== */

	private function createDefaultBoard(string $uid): Board {
		$b = new Board();
		$b->setName('My Board');
		$b->setOwner($uid);
		$b->setColor(self::BOARD_COLORS[0]);
		$b->setCreated(time());
		return $this->boards->insert($b);
	}

	public function createBoard(string $name, ?string $color = null, ?string $location = null): array {
		$uid = $this->uid();
		$count = count($this->boards->findOwned($uid));
		$b = new Board();
		$b->setName($name !== '' ? $name : 'Untitled board');
		$b->setOwner($uid);
		$b->setColor($color ?: self::BOARD_COLORS[$count % count(self::BOARD_COLORS)]);
		if ($location !== null && trim($location) !== '') {
			$b->setLocation(trim($location));
		}
		$b->setCreated(time());
		$b = $this->boards->insert($b);
		$this->ensureBoardFolderPersist($b);
		return $this->serializeBoard($b, $uid);
	}

	public function updateBoard(int $id, ?string $name, ?string $color, ?string $location = null): array {
		$uid = $this->uid();
		$b = $this->boards->find($id);
		$this->assertOwner($b->getOwner());
		if ($name !== null) {
			$b->setName($name);
		}
		if ($color !== null) {
			$b->setColor($color);
		}
		if ($location !== null) {
			// Move the whole board folder so every reference's file_id stays valid.
			$moved = $this->storage->moveBoardFolder($b, trim($location));
			$b->setLocation($moved);
		}
		return $this->serializeBoard($this->boards->update($b), $uid);
	}

	/**
	 * Adopt folders sitting directly under the base "Curio" folder as
	 * boards, if they are not already mapped to one.
	 */
	private function discoverBoards(string $uid): void {
		try {
			$owned = $this->boards->findOwned($uid);
			$known = [];
			$knownFolderIds = [];
			foreach ($owned as $b) {
				$loc = trim((string)$b->getLocation(), '/');
				if ($loc === '') {
					$loc = trim($this->storage->defaultBoardPath($uid, $b->getName()), '/');
				}
				$known[$loc] = true;
				if ($b->getFolderId() !== null) {
					$knownFolderIds[(int)$b->getFolderId()] = true;
				}
			}
			$count = count($owned);
			foreach ($this->storage->listBoardFolders($uid) as $f) {
				$path = trim($f['path'], '/');
				// Skip a folder that already belongs to a board - by file id (so a folder the
				// user RENAMED/MOVED in Files isn't re-adopted as a new board) or by path.
				if (isset($knownFolderIds[(int)($f['fileId'] ?? 0)]) || isset($known[$path])) {
					continue;
				}
				$b = new Board();
				$b->setName($f['name']);
				$b->setOwner($uid);
				$b->setColor(self::BOARD_COLORS[$count % count(self::BOARD_COLORS)]);
				$b->setLocation($path);
				$b->setFolderId(isset($f['fileId']) ? (int)$f['fileId'] : null);
				$b->setCreated(time());
				$this->boards->insert($b);
				$known[$path] = true;
				if (isset($f['fileId'])) {
					$knownFolderIds[(int)$f['fileId']] = true;
				}
				$count++;
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio discoverBoards failed: ' . $e->getMessage());
		}
	}

	/** Ensure a board's Files folder exists and persist the resolved path. */
	private function ensureBoardFolderPersist(Board $b): void {
		try {
			$ens = $this->storage->ensureBoardFolder($b);
			if ($b->getLocation() !== $ens['path']) {
				$b->setLocation($ens['path']);
				$this->boards->update($b);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('Curio could not create board folder: ' . $e->getMessage());
		}
	}

	public function deleteBoard(int $id): void {
		$b = $this->boards->find($id);
		$this->assertOwner($b->getOwner());
		foreach ($this->references->findByBoards([$id]) as $r) {
			$this->tags->deleteRefTagsByRef($r->getId());
			$this->comments->deleteByRef($r->getId());
		}
		$this->references->deleteByBoard($id);
		$this->clearBoardShares($id);
		// Delete the board's folder + contents from Files, otherwise discoverBoards re-adopts the
		// orphaned folder under "Curio" on the next reload and the board reappears.
		$this->storage->deleteBoardFolder($b);
		$this->boards->delete($b);
	}

	/**
	 * Share a board with another user by creating a REAL Nextcloud folder share of
	 * the board's Files folder, so the collaborator gets the folder in their own
	 * Files with Nextcloud-managed permissions (view / edit / custom). The app's
	 * share table mirrors the granted permissions as an index for fast read/write
	 * gating. $permissions is 'view', 'edit', or a numeric NC bitmask (custom).
	 */
	public function shareBoard(int $id, string $shareWith, ?string $permissions = null): array {
		$b = $this->boards->find($id);
		$this->assertOwner($b->getOwner());
		if ($this->userManager->get($shareWith) === null) {
			throw new \InvalidArgumentException('Unknown user: ' . $shareWith);
		}
		if ($shareWith === $b->getOwner()) {
			throw new \InvalidArgumentException('You already own this board');
		}
		$perms = $this->permBits($permissions);
		// The folder must exist before it can be shared.
		$ens = $this->storage->ensureBoardFolder($b);
		if ($b->getLocation() !== $ens['path']) {
			$b->setLocation($ens['path']);
			$this->boards->update($b);
		}
		$this->createOrUpdateNcShare($ens['folder'], $b->getOwner(), $shareWith, $perms);
		$this->upsertShareRow($id, $shareWith, $perms);
		return $this->serializeBoard($b, $this->uid());
	}

	public function unshareBoard(int $id, string $shareWith): void {
		$b = $this->boards->find($id);
		$this->assertOwner($b->getOwner());
		try {
			$folder = $this->storage->boardFolder($b);
			if ($folder !== null) {
				foreach ($this->shareManager->getSharesBy($b->getOwner(), IShare::TYPE_USER, $folder, false, 200, 0) as $s) {
					if ($s->getSharedWith() === $shareWith) {
						$this->shareManager->deleteShare($s);
					}
				}
			}
		} catch (\Throwable $e) {
			$this->logger->warning('Curio could not remove NC share: ' . $e->getMessage());
		}
		$this->removeShare($id, $shareWith);
	}

	/** Map a 'view'/'edit'/numeric permission choice to an NC permission bitmask (READ always set). */
	private function permBits(?string $level): int {
		$lvl = strtolower(trim((string)$level));
		if ($lvl === 'edit' || $lvl === 'write') {
			return self::PERM_EDIT;
		}
		if ($lvl !== '' && ctype_digit($lvl)) {
			// Custom bitmask: clamp to the sharable set, never allow re-share, always allow read.
			return ((int)$lvl & (self::PERM_EDIT)) | Constants::PERMISSION_READ;
		}
		return Constants::PERMISSION_READ; // 'view' / default: least privilege
	}

	/** Create the NC user-share of the board folder, or update its permissions if it already exists. */
	private function createOrUpdateNcShare(\OCP\Files\Folder $folder, string $ownerUid, string $shareWith, int $perms): void {
		try {
			foreach ($this->shareManager->getSharesBy($ownerUid, IShare::TYPE_USER, $folder, false, 200, 0) as $s) {
				if ($s->getSharedWith() === $shareWith) {
					$s->setPermissions($perms);
					$this->shareManager->updateShare($s);
					return;
				}
			}
			$share = $this->shareManager->newShare();
			$share->setNode($folder);
			$share->setShareType(IShare::TYPE_USER);
			$share->setSharedWith($shareWith);
			$share->setSharedBy($ownerUid);
			$share->setPermissions($perms);
			$this->shareManager->createShare($share);
		} catch (\Throwable $e) {
			throw new \RuntimeException('Could not share the board folder: ' . $e->getMessage());
		}
	}

	/* ---- board_shares raw helpers (index mirroring the NC shares) ---- */

	/** @return array<int,array{uid:string,displayName:string,permissions:int,level:string}> */
	private function boardShares(int $boardId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('shared_with', 'permissions')->from('curio_board_shares')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$out = [];
		while ($row = $res->fetch()) {
			$perms = (int)$row['permissions'];
			$out[] = [
				'uid' => $row['shared_with'],
				'displayName' => $this->displayName($row['shared_with']),
				'permissions' => $perms,
				'level' => ($perms & Constants::PERMISSION_UPDATE) ? 'edit' : 'view',
			];
		}
		$res->closeCursor();
		return $out;
	}

	/** The NC permission bitmask a user has on a board: ALL for the owner, the stored share bits otherwise, 0 if none. */
	private function boardPerms(Board $b, string $uid): int {
		if ($b->getOwner() === $uid) {
			return Constants::PERMISSION_ALL;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('permissions')->from('curio_board_shares')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($b->getId(), IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('shared_with', $qb->createNamedParameter($uid)));
		$res = $qb->executeQuery();
		$row = $res->fetch();
		$res->closeCursor();
		return $row ? (int)$row['permissions'] : 0;
	}

	private function upsertShareRow(int $boardId, string $uid, int $perms): void {
		$this->removeShare($boardId, $uid);
		$qb = $this->db->getQueryBuilder();
		$qb->insert('curio_board_shares')->values([
			'board_id' => $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT),
			'shared_with' => $qb->createNamedParameter($uid),
			'permissions' => $qb->createNamedParameter($perms, IQueryBuilder::PARAM_INT),
		]);
		$qb->executeStatement();
	}

	private function removeShare(int $boardId, string $uid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_board_shares')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('shared_with', $qb->createNamedParameter($uid)));
		$qb->executeStatement();
	}

	private function clearBoardShares(int $boardId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_board_shares')
			->where($qb->expr()->eq('board_id', $qb->createNamedParameter($boardId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	/* ===================== REFERENCES ===================== */

	/** Read access: the owner, or anyone the board is shared with (any permission). */
	private function assertBoardRead(int $boardId): void {
		$b = $this->boards->find($boardId);
		if ($this->boardPerms($b, $this->uid()) <= 0) {
			throw new \RuntimeException('You do not have access to this board');
		}
	}

	/**
	 * Write access for a specific operation: the owner always passes; a collaborator
	 * passes only when their Nextcloud share on the board folder grants the needed
	 * bit (CREATE to add, UPDATE to edit, DELETE to remove). This mirrors what NC
	 * itself will enforce on the underlying file, surfaced as a clean 403.
	 */
	private function assertBoardWrite(int $boardId, int $needBit): void {
		$b = $this->boards->find($boardId);
		$perms = $this->boardPerms($b, $this->uid());
		if ($perms <= 0) {
			throw new \RuntimeException('You do not have access to this board');
		}
		if (($perms & $needBit) !== $needBit) {
			throw new \RuntimeException('You have view-only access to this board');
		}
	}

	/**
	 * @param array $data type,title,desc,source_url,img,video(array),body,note,board,seed,tagIds[]
	 */
	public function createReference(array $data): array {
		$uid = $this->uid();
		$boardId = (int)($data['board'] ?? 0);
		$this->assertBoardWrite($boardId, Constants::PERMISSION_CREATE);
		$this->assertUniqueTitle($boardId, (string)($data['title'] ?? ''), null);

		$r = new Reference();
		$r->setBoardId($boardId);
		$r->setOwner($uid);
		$r->setType((string)($data['type'] ?? 'link'));
		$r->setTitle((string)($data['title'] ?? ''));
		$r->setDescription($data['desc'] ?? null);
		$r->setSourceUrl($data['source_url'] ?? null);
		$r->setImg($data['img'] ?? null);
		$r->setVideo(isset($data['video']) && $data['video'] ? json_encode($data['video']) : null);
		$r->setBody($data['body'] ?? null);
		$r->setNote($data['note'] ?? null);
		$r->setSeed((int)($data['seed'] ?? random_int(1, 9999)));
		$r->setCreated(time());
		// Geo supplied by the add dialog (embedded page geo, or an accepted geocode
		// suggestion) is set before materialisation so it isn't overwritten by EXIF.
		$this->applyGeoInput($r, $data);
		$r = $this->references->insert($r);

		// Materialise the file that backs this reference in the board folder.
		$this->materializeReferenceFile($r, $this->boards->find($boardId));
		// Write the location into the image file so it travels with the file (images only).
		$this->writeGeoToFile($r);

		$tagIds = array_map('intval', (array)($data['tagIds'] ?? []));
		if (count($tagIds) > 0 && $r->getFileId() !== null) {
			$this->tagService->setFileTags($r->getFileId(), $tagIds);
		}

		return $this->hydrateReference($r);
	}

	public function updateReference(int $id, array $data): array {
		$r = $this->references->find($id);
		$this->assertBoardWrite($r->getBoardId(), Constants::PERMISSION_UPDATE);
		$oldTitle = (string)$r->getTitle();
		$oldBoardId = $r->getBoardId();

		foreach (['title' => 'setTitle', 'type' => 'setType'] as $k => $setter) {
			if (array_key_exists($k, $data)) {
				$r->$setter((string)$data[$k]);
			}
		}
		foreach (['desc' => 'setDescription', 'source_url' => 'setSourceUrl', 'img' => 'setImg', 'body' => 'setBody', 'note' => 'setNote'] as $k => $setter) {
			if (array_key_exists($k, $data)) {
				$r->$setter($data[$k]);
			}
		}
		if (array_key_exists('video', $data)) {
			$r->setVideo($data['video'] ? json_encode($data['video']) : null);
		}
		// Manual geolocation edit / clear.
		if (array_key_exists('lat', $data) && array_key_exists('lng', $data)) {
			$lat = $data['lat'];
			$lng = $data['lng'];
			if ($lat === null || $lng === null || $lat === '' || $lng === '') {
				$r->setLat(null);
				$r->setLng(null);
				$r->setGeoSource('none');
				if (array_key_exists('place', $data)) {
					$r->setPlace(null);
				}
			} elseif (is_numeric($lat) && is_numeric($lng) && (float)$lat >= -90 && (float)$lat <= 90 && (float)$lng >= -180 && (float)$lng <= 180) {
				$r->setLat((float)$lat);
				$r->setLng((float)$lng);
				if (array_key_exists('place', $data)) {
					$r->setPlace(($data['place'] !== null && $data['place'] !== '') ? (string)$data['place'] : null);
				}
				$r->setGeoSource(is_string($data['geoSource'] ?? null) ? $data['geoSource'] : 'manual');
			} else {
				throw new \InvalidArgumentException('Invalid coordinates');
			}
		} elseif (array_key_exists('place', $data)) {
			$r->setPlace(($data['place'] !== null && $data['place'] !== '') ? (string)$data['place'] : null);
		}
		if (array_key_exists('board', $data)) {
			// Moving a reference into another board is creating it there.
			$this->assertBoardWrite((int)$data['board'], Constants::PERMISSION_CREATE);
			$r->setBoardId((int)$data['board']);
		}

		if (array_key_exists('title', $data) && mb_strtolower(trim((string)$r->getTitle())) !== mb_strtolower(trim($oldTitle))) {
			$this->assertUniqueTitle($r->getBoardId(), (string)$r->getTitle(), $r->getId());
		}

		// --- keep the backing file in step with the metadata ---
		$this->syncReferenceFileOnUpdate($r, $data, $oldTitle, $oldBoardId);

		$r = $this->references->update($r);
		if (array_key_exists('tagIds', $data) && $r->getFileId() !== null) {
			$this->tagService->setFileTags($r->getFileId(), array_map('intval', (array)$data['tagIds']));
		}
		// A location edit/geocode on an image -> write it into the image file (portable geo).
		if (array_key_exists('lat', $data) || array_key_exists('geo', $data)) {
			$this->writeGeoToFile($r);
		}
		return $this->hydrateReference($r);
	}

	/**
	 * Reflect a reference edit onto its file: rename on title change, rewrite the
	 * body of a text note, move the file when the reference changes board. All are
	 * best-effort except a title collision, which is surfaced to the user.
	 */
	private function syncReferenceFileOnUpdate(Reference $r, array $data, string $oldTitle, int $oldBoardId): void {
		$fileId = $r->getFileId();

		// Move to another board's folder first (same owner only).
		if ($fileId !== null && array_key_exists('board', $data) && $r->getBoardId() !== $oldBoardId) {
			try {
				$oldBoard = $this->boards->find($oldBoardId);
				$newBoard = $this->boards->find($r->getBoardId());
				if ($oldBoard->getOwner() === $newBoard->getOwner()) {
					$dest = $this->storage->ensureBoardFolder($newBoard);
					$moved = $this->storage->moveFile($newBoard->getOwner(), $fileId, $dest['folder']);
					if ($moved !== null) {
						$r->setFileId($moved);
						$fileId = $moved;
					}
				}
			} catch (\InvalidArgumentException $e) {
				throw $e;
			} catch (\Throwable $e) {
				$this->logger->debug('Curio ref file move failed: ' . $e->getMessage());
			}
		}

		if ($fileId === null) {
			return;
		}
		// Rename/rewrite run as the acting user, so a collaborator's edit goes through
		// their shared mount and Nextcloud enforces (and attributes) the change.
		$actingUid = $this->uid();

		// Rename on title change.
		if (array_key_exists('title', $data) && (string)$r->getTitle() !== $oldTitle) {
			$this->storage->renameFile($actingUid, $fileId, (string)$r->getTitle(), (string)$r->getExt());
		}

		// Rewrite the markdown body of a text note.
		if ($r->getType() === 'text' && array_key_exists('body', $data)) {
			$this->storage->overwriteFile($actingUid, $fileId, (string)$r->getBody());
		}
	}

	public function deleteReference(int $id): void {
		$r = $this->references->find($id);
		$this->assertBoardWrite($r->getBoardId(), Constants::PERMISSION_DELETE);
		// Move the backing file to the trash (recoverable). Run as the acting user so
		// Nextcloud enforces their delete permission and attributes the action.
		if ($r->getFileId() !== null) {
			$this->storage->trashFile($this->uid(), $r->getFileId());
		}
		$img = (string)$r->getImg();
		if (str_starts_with($img, self::UPLOAD_PREFIX)) {
			$this->fetcher->deleteUpload(substr($img, strlen(self::UPLOAD_PREFIX)));
		}
		$this->tags->deleteRefTagsByRef($id);
		$this->comments->deleteByRef($id);
		$this->references->delete($r);
	}

	/**
	 * @param int[] $refIds
	 * @param int[] $addTagIds
	 * @param int[] $removeTagIds
	 */
	public function bulkTag(array $refIds, array $addTagIds, array $removeTagIds): void {
		$addTagIds = array_map('intval', $addTagIds);
		$removeTagIds = array_map('intval', $removeTagIds);
		foreach (array_map('intval', $refIds) as $refId) {
			$r = $this->references->find($refId);
			// Skip references the user cannot edit; tagging is a metadata write.
			try {
				$this->assertBoardWrite($r->getBoardId(), Constants::PERMISSION_UPDATE);
			} catch (\RuntimeException $e) {
				continue;
			}
			if ($r->getFileId() === null) {
				continue;
			}
			foreach ($addTagIds as $t) {
				$this->tagService->addFileTag($r->getFileId(), $t);
			}
			foreach ($removeTagIds as $t) {
				$this->tagService->removeFileTag($r->getFileId(), $t);
			}
		}
	}

	private function hydrateReference(Reference $r): array {
		$data = $r->jsonSerialize();
		$data['tags'] = ($r->getFileId() !== null)
			? ($this->tagService->tagsForFiles([$r->getFileId()])[$r->getFileId()] ?? [])
			: [];
		$data['comments'] = $this->comments->commentsForRefs([$r->getId()])[$r->getId()] ?? [];
		return $data;
	}

	/* ===================== FETCH / THUMBNAILS ===================== */

	/**
	 * Fetch link/video metadata for a URL the user is adding.
	 *
	 * @return array{type:string,title:?string,description:?string,image:?string,video:?array}
	 */
	public function fetchMeta(string $url): array {
		return $this->fetcher->fetchMeta($url);
	}

	/**
	 * Cached image bytes for a reference the current user may read. Uploaded
	 * images (img = "curio-upload:<key>") are served from appdata; everything
	 * else is a remote URL fetched + cached on demand.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function getReferenceThumbnail(int $refId): ?array {
		$r = $this->references->find($refId);
		$this->assertBoardRead($r->getBoardId());
		// Read the file as the acting user, so a collaborator reaches it through the
		// share and Nextcloud enforces their read access.
		$actingUid = $this->uid();
		// Image references - and links that saved their picture (B_webpage) - use the
		// image file in the board folder as the thumbnail. A link stub (html file) fails
		// the image-mime guard and falls through to the remote-thumbnail path below.
		if ($r->getFileId() !== null && in_array($r->getType(), ['image', 'image_url', 'link'], true)) {
			$file = $this->storage->readFile($actingUid, $r->getFileId());
			if ($file !== null && str_starts_with($file['mime'], 'image/')) {
				return $this->fetcher->downscale($file['content'], $file['mime']);
			}
		}
		// PDF card thumbnail: a rendered first-page preview, or a PDF icon.
		if ($r->getFileId() !== null && $r->getType() === 'pdf') {
			$prev = $this->storage->preview($actingUid, $r->getFileId());
			if ($prev !== null) {
				return $prev;
			}
			return ['content' => $this->pdfIconSvg(), 'mime' => 'image/svg+xml'];
		}
		$img = (string)$r->getImg();
		if ($img === self::FILE_MISSING) {
			return ['content' => $this->warningSvg(), 'mime' => 'image/svg+xml'];
		}
		if ($img === '' || $img === self::FILE_MARKER) {
			return null;
		}
		if (str_starts_with($img, self::UPLOAD_PREFIX)) {
			return $this->fetcher->getUpload(substr($img, strlen(self::UPLOAD_PREFIX)));
		}
		return $this->fetcher->getThumbnail($img);
	}

	/**
	 * Serve the raw stored file for a reference (direct video playback, opening a
	 * saved page). Returns null when the reference has no materialised file.
	 *
	 * @return array{content:string,mime:string,name:string}|null
	 */
	public function getReferenceFile(int $refId): ?array {
		$r = $this->references->find($refId);
		$this->assertBoardRead($r->getBoardId());
		if ($r->getFileId() === null) {
			return null;
		}
		return $this->storage->readFile($this->uid(), $r->getFileId());
	}

	private function pdfIconSvg(): string {
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
			. '<rect width="100" height="100" fill="#3a3f47"/>'
			. '<path d="M32 22 h26 l14 14 v42 a2 2 0 0 1-2 2 H32 a2 2 0 0 1-2-2 V24 a2 2 0 0 1 2-2 Z" fill="#e9ecf1"/>'
			. '<path d="M58 22 v14 h14 Z" fill="#b7bfc9"/>'
			. '<text x="51" y="70" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="#d0453b" text-anchor="middle">PDF</text></svg>';
	}

	private function warningSvg(): string {
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
			. '<rect width="100" height="100" fill="#3a3f47"/>'
			. '<path d="M50 24 L78 74 H22 Z" fill="none" stroke="#e0a92e" stroke-width="6" stroke-linejoin="round"/>'
			. '<rect x="47" y="44" width="6" height="16" rx="3" fill="#e0a92e"/>'
			. '<circle cx="50" cy="66" r="3.5" fill="#e0a92e"/></svg>';
	}

	/* ===================== CSV export / import ===================== */

	/**
	 * CSV for one board (or all accessible boards when $boardId is null/0).
	 * Columns: board,title,type,source_url,description,note,tags,created.
	 */
	public function exportCsv(?int $boardId): string {
		$uid = $this->uid();
		$boards = [];
		if ($boardId !== null && $boardId > 0) {
			$this->assertBoardRead($boardId);
			$boards = [$this->boards->find($boardId)];
		} else {
			foreach ($this->boards->findOwned($uid) as $b) {
				$boards[] = $b;
			}
			foreach ($this->boards->findSharedWith($uid) as $b) {
				$boards[] = $b;
			}
		}
		$name = [];
		$ids = [];
		foreach ($boards as $b) {
			$name[$b->getId()] = $b->getName();
			$ids[] = $b->getId();
		}
		$refs = $this->references->findByBoards($ids);
		$fileIds = array_values(array_filter(array_map(static fn (Reference $r) => $r->getFileId(), $refs), static fn ($v) => $v !== null));
		$tagsByFile = $this->tagService->tagsForFiles($fileIds);

		$fh = fopen('php://temp', 'r+');
		fputcsv($fh, ['board', 'title', 'type', 'source_url', 'description', 'note', 'tags', 'created']);
		foreach ($refs as $r) {
			$tags = ($r->getFileId() !== null) ? ($tagsByFile[$r->getFileId()] ?? []) : [];
			$tagNames = implode(',', array_map(static fn ($t) => $t['name'], $tags));
			fputcsv($fh, [
				$name[$r->getBoardId()] ?? '',
				(string)$r->getTitle(),
				(string)$r->getType(),
				(string)$r->getSourceUrl(),
				(string)$r->getDescription(),
				(string)$r->getNote(),
				$tagNames,
				date('c', $r->getCreated()),
			]);
		}
		rewind($fh);
		$csv = (string)stream_get_contents($fh);
		fclose($fh);
		return $csv;
	}

	/**
	 * Import a CSV into a board. Rows match a file in the board folder by title
	 * (metadata is merged onto it); rows with no matching file create a reference
	 * and try to re-download the media, else a placeholder-warning reference.
	 *
	 * @return array{imported:int,created:int,matched:int,missing:int}
	 */
	public function importCsv(int $boardId, string $content): array {
		$board = $this->boards->find($boardId);
		$this->assertBoardWrite($boardId, Constants::PERMISSION_CREATE);
		$this->reconcileBoard($board, $board->getOwner() === $this->uid());

		$existing = [];
		foreach ($this->references->findByBoards([$boardId]) as $r) {
			$existing[$this->titleKey((string)$r->getTitle())] = $r;
		}

		$imported = 0;
		$created = 0;
		$matched = 0;
		$missing = 0;
		foreach ($this->parseCsv($content) as $row) {
			$title = trim((string)($row['title'] ?? ''));
			if ($title === '') {
				continue;
			}
			$type = trim((string)($row['type'] ?? 'link'));
			$type = $type !== '' ? $type : 'link';
			$key = $this->titleKey($title);
			$r = $existing[$key] ?? null;
			$isNew = $r === null;

			if ($isNew) {
				$r = new Reference();
				$r->setBoardId($boardId);
				$r->setOwner($board->getOwner());
				$r->setType($type);
				$r->setTitle($title);
				$r->setSeed(random_int(1, 9999));
				$r->setCreated($this->parseDate((string)($row['created'] ?? '')));
			} elseif ($r->getType() === 'file') {
				$r->setType($type);
			}
			$r->setSourceUrl($this->blankToNull($row['source_url'] ?? null));
			$r->setDescription($this->blankToNull($row['description'] ?? null));
			$r->setNote($this->blankToNull($row['note'] ?? null));

			if ($isNew) {
				$r = $this->references->insert($r);
				$this->materializeReferenceFile($r, $board);
				if ($r->getFileId() === null) {
					$r->setImg(self::FILE_MISSING);
					$this->references->update($r);
					$missing++;
				}
				$created++;
			} else {
				$this->references->update($r);
				$matched++;
			}

			$tagNames = array_values(array_filter(array_map('trim', explode(',', (string)($row['tags'] ?? '')))));
			if ($r->getFileId() !== null && count($tagNames) > 0) {
				$ids = [];
				foreach ($tagNames as $tn) {
					$ids[] = $this->tagService->createOrGetTag($tn, null, null, $this->uid())['id'];
				}
				$this->tagService->setFileTags($r->getFileId(), $ids);
			}
			$existing[$key] = $r;
			$imported++;
		}
		return ['imported' => $imported, 'created' => $created, 'matched' => $matched, 'missing' => $missing];
	}

	private function titleKey(string $title): string {
		return mb_strtolower(trim($title));
	}

	private function blankToNull(?string $v): ?string {
		$v = $v !== null ? trim($v) : '';
		return $v === '' ? null : $v;
	}

	private function parseDate(string $v): int {
		$v = trim($v);
		if ($v === '') {
			return time();
		}
		if (ctype_digit($v)) {
			return (int)$v;
		}
		$ts = strtotime($v);
		return $ts !== false ? $ts : time();
	}

	/** @return array<int,array<string,?string>> */
	private function parseCsv(string $content): array {
		$fh = fopen('php://temp', 'r+');
		fwrite($fh, $content);
		rewind($fh);
		$header = fgetcsv($fh);
		if ($header === false || $header === [null]) {
			fclose($fh);
			return [];
		}
		$header = array_map(static fn ($h) => strtolower(trim((string)$h)), $header);
		$rows = [];
		while (($line = fgetcsv($fh)) !== false) {
			if ($line === [null]) {
				continue;
			}
			$row = [];
			foreach ($header as $i => $h) {
				$row[$h] = $line[$i] ?? null;
			}
			$rows[] = $row;
		}
		fclose($fh);
		return $rows;
	}

	/**
	 * Store an uploaded image and return the img marker to save on a reference.
	 *
	 * @return array{img:string}
	 */
	public function uploadImage(string $content, ?string $mime): array {
		$res = $this->fetcher->storeUpload($content, $mime);
		return ['img' => self::UPLOAD_PREFIX . $res['key']];
	}

	/* ===================== COMMENTS ===================== */

	public function addComment(int $refId, string $message): array {
		$r = $this->references->find($refId);
		$this->assertBoardRead($r->getBoardId());
		$c = new Comment();
		$c->setRefId($refId);
		$c->setActor($this->uid());
		$c->setMessage($message);
		$c->setCreated(time());
		return $this->comments->insert($c)->jsonSerialize();
	}

	public function deleteComment(int $id): void {
		$c = $this->comments->find($id);
		if ($c->getActor() !== $this->uid()) {
			throw new \RuntimeException('Not your comment');
		}
		$this->comments->delete($c);
	}

	/* ===================== TAGS (NC system tags) ===================== */

	public function createTag(string $name, ?string $color, ?int $folderId): array {
		return $this->tagService->createOrGetTag($name, $color, $folderId, $this->uid());
	}

	public function updateTag(int $id, ?string $name, ?string $color, ?int $folderId, bool $folderProvided): array {
		return $this->tagService->updateTag($id, $name, $color, $folderId, $folderProvided, $this->uid());
	}

	public function deleteTag(int $id): void {
		$this->tagService->deleteTag($id, $this->uid());
	}

	/* ===================== FOLDERS ===================== */

	public function createFolder(string $name): array {
		$f = new Folder();
		$f->setName($name);
		$f->setOwner($this->uid());
		$f->setSort(count($this->folders->findOwned($this->uid())));
		$f->setExpanded(true);
		return $this->folders->insert($f)->jsonSerialize();
	}

	public function updateFolder(int $id, ?string $name, ?bool $expanded): array {
		$f = $this->folders->find($id);
		$this->assertOwner($f->getOwner());
		if ($name !== null) {
			$f->setName($name);
		}
		if ($expanded !== null) {
			$f->setExpanded($expanded);
		}
		return $this->folders->update($f)->jsonSerialize();
	}

	public function deleteFolder(int $id): void {
		$f = $this->folders->find($id);
		$this->assertOwner($f->getOwner());
		$this->tagService->clearFolder($f->getId(), $this->uid());
		$this->folders->delete($f);
	}

	/* ===================== SETTINGS ===================== */

	public function getSettings(): array {
		$uid = $this->uid();
		$s = $this->settings->findByUid($uid);
		if ($s === null) {
			return ['theme' => 'system', 'layout' => 'square', 'labels' => false, 'sort' => 'created_desc', 'dateFormat' => 'auto', 'tagTranslate' => false, 'baseFolder' => null];
		}
		return $s->jsonSerialize();
	}

	public function updateSettings(?string $theme, ?string $layout, ?bool $labels, ?string $sort = null, ?string $dateFormat = null): array {
		$uid = $this->uid();
		$s = $this->settings->findByUid($uid);
		$isNew = $s === null;
		if ($isNew) {
			$s = new Setting();
			$s->setUid($uid);
			$s->setTheme('system');
			$s->setLayout('square');
			$s->setLabels(false);
			$s->setSort('created_desc');
			$s->setDateFormat('auto');
			$s->setTagTranslate(false);
		}
		if ($theme !== null) {
			$s->setTheme($theme);
		}
		if ($layout !== null) {
			$s->setLayout($layout);
		}
		if ($labels !== null) {
			$s->setLabels($labels);
		}
		if ($sort !== null) {
			$s->setSort($sort);
		}
		if ($dateFormat !== null) {
			$s->setDateFormat($dateFormat);
		}
		$s = $isNew ? $this->settings->insert($s) : $this->settings->update($s);
		return $s->jsonSerialize();
	}

	/* ===================== BASE FOLDER (first run) ===================== */

	/**
	 * Set the user's base folder on first launch. mode 'create' makes a new folder
	 * named $name at the Files root; mode 'existing' adopts the folder at $path.
	 * Returns the full fresh state so the frontend can drop straight into the app.
	 */
	public function setBaseFolder(string $mode, ?string $name = null, ?string $path = null): array {
		$uid = $this->uid();
		if ($uid === '') {
			throw new \RuntimeException('Not signed in');
		}
		if ($mode === 'existing') {
			$rel = trim(str_replace('\\', '/', (string)$path), '/');
			if ($rel === '' || !$this->storage->isUserFolder($uid, $rel)) {
				throw new \InvalidArgumentException('Choose an existing folder');
			}
			$base = $rel;
		} else {
			$nm = trim((string)$name);
			if ($nm === '') {
				$nm = StorageService::DEFAULT_BASE;
			}
			$safe = $this->storage->sanitizeBase($nm);
			$this->storage->ensureBase($uid, $safe);
			$base = $safe;
		}
		$this->persistBaseFolder($uid, $base);
		return $this->getState();
	}

	/** List the immediate subfolders of $path (root when empty) for the folder picker. */
	public function browseFolders(string $path = ''): array {
		return $this->storage->browseFolders($this->uid(), $path);
	}

	private function persistBaseFolder(string $uid, string $base): void {
		$s = $this->settings->findByUid($uid);
		$isNew = $s === null;
		if ($isNew) {
			$s = new Setting();
			$s->setUid($uid);
			$s->setTheme('system');
			$s->setLayout('square');
			$s->setLabels(false);
			$s->setSort('created_desc');
			$s->setDateFormat('auto');
			$s->setTagTranslate(false);
		}
		$s->setBaseFolder($base);
		$isNew ? $this->settings->insert($s) : $this->settings->update($s);
	}

	/* ===================== file materialisation / reconcile ===================== */

	/** Write the file that backs a reference and record its node id + extension. */
	private function materializeReferenceFile(Reference $r, Board $board): void {
		try {
			[$content, $ext] = $this->referenceFileContent($r);
			if ($content === null) {
				return;
			}
			$actingUid = $this->uid();
			if ($actingUid === $board->getOwner()) {
				// Owner: ensure/create the board folder in their own Files.
				$ens = $this->storage->ensureBoardFolder($board);
				if ($board->getLocation() !== $ens['path']) {
					$board->setLocation($ens['path']);
					$this->boards->update($board);
				}
				$folder = $ens['folder'];
			} else {
				// Collaborator: write through their mounted view of the shared folder so
				// Nextcloud enforces their create permission and attributes the file.
				$folder = $this->storage->boardFolderAs($board, $actingUid);
				if ($folder === null) {
					throw new \RuntimeException('You do not have write access to this board folder');
				}
			}
			$fileId = $this->storage->writeFile($folder, (string)$r->getTitle(), $ext, $content);
			$r->setFileId($fileId);
			$r->setExt($ext);
			// Stamp the file mtime the app just wrote, so reconcile doesn't mistake this
			// freshly-materialised ref for an external edit and re-sync it (which would, for
			// images, re-read the EXIF-stripped WebP and lose the geo read from the original).
			$r->setSyncedMtime($this->storage->mtimeById((string)$actingUid, (int)$fileId));
			$storedImage = in_array(strtolower($ext), ['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif'], true);
			if (in_array($r->getType(), ['image', 'image_url', 'pdf'], true) || $storedImage) {
				$img = (string)$r->getImg();
				if (str_starts_with($img, self::UPLOAD_PREFIX)) {
					// The file now lives in the board folder; drop the appdata copy.
					$this->fetcher->deleteUpload(substr($img, strlen(self::UPLOAD_PREFIX)));
				}
				// A local file was just written (image_url downloads + converts to WebP, and
				// type=link now saves its picture too), so it is the source of truth: mark
				// FILE_MARKER so the grid reads its real dimensions (native masonry, no crop).
				$r->setImg(self::FILE_MARKER);
			}
			$this->references->update($r);
		} catch (\InvalidArgumentException $e) {
			throw $e;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio materialise failed: ' . $e->getMessage());
		}
	}

	/**
	 * Decide the file bytes + extension for a reference. Returns [null, ''] when
	 * there is nothing to store yet (e.g. a download failed), leaving the reference
	 * to be retried on the next load.
	 *
	 * @return array{0:?string,1:string}
	 */
	/**
	 * Prepare an imported image for storage: read its GPS from the ORIGINAL bytes
	 * first (a WebP re-encode strips EXIF), then convert to WebP to shrink it. If the
	 * image can't be converted (SVG / animated GIF / unsupported), keep the original.
	 * Resolves geo_source so it isn't re-checked later.
	 *
	 * @return array{0:string,1:string} [content, ext]
	 */
	private function prepareImageForStore(Reference $r, string $bytes, string $mime, string $fallbackExt): array {
		if ($r->getGeoSource() === null) {
			$gps = $this->fetcher->extractImageGps($bytes);
			if ($gps !== null) {
				$r->setLat($gps['lat']);
				$r->setLng($gps['lng']);
				$r->setGeoSource('exif');
			} else {
				// No embedded GPS, and the WebP copy won't carry any, so mark it checked.
				$r->setGeoSource('none');
			}
		}
		$webp = $this->fetcher->toWebp($bytes, $mime);
		if ($webp !== null) {
			return [$webp['content'], 'webp'];
		}
		return [$bytes, $fallbackExt];
	}

	/** Apply geo supplied by the add dialog (nested `geo` object) to a new reference. */
	private function applyGeoInput(Reference $r, array $data): void {
		$geo = $data['geo'] ?? null;
		if (!is_array($geo)) {
			return;
		}
		$lat = $geo['lat'] ?? null;
		$lng = $geo['lng'] ?? null;
		if ($lat === null || $lng === null || !is_numeric($lat) || !is_numeric($lng)) {
			return;
		}
		$latf = (float)$lat;
		$lngf = (float)$lng;
		if ($latf < -90 || $latf > 90 || $lngf < -180 || $lngf > 180) {
			return;
		}
		$r->setLat($latf);
		$r->setLng($lngf);
		$place = $geo['place'] ?? null;
		$r->setPlace(($place !== null && $place !== '') ? (string)$place : null);
		$source = $geo['source'] ?? null;
		$r->setGeoSource(in_array($source, ['page', 'geocoded', 'manual', 'exif', 'video'], true) ? $source : 'page');
	}

	/**
	 * Write the reference's location into its IMAGE file (EXIF), so the geo travels with
	 * the file to other environments (owner's request). Images only - links keep their geo
	 * in the DB (in-app), videos/pdf/text don't carry geo. No-op when the format can't hold
	 * EXIF or geo isn't set; updates synced_mtime + geo_updated so our own write is not then
	 * re-read as an external change (and sets the newest-wins baseline).
	 */
	private function writeGeoToFile(Reference $r): void {
		if (!in_array($r->getType(), ['image', 'image_url'], true)) {
			return;
		}
		if ($r->getImg() !== self::FILE_MARKER || $r->getFileId() === null) {
			return;
		}
		if ($r->getLat() === null || $r->getLng() === null) {
			return;
		}
		try {
			$actingUid = $this->uid();
			$file = $this->storage->readFile($actingUid, (int)$r->getFileId());
			if ($file === null) {
				return;
			}
			$embedded = $this->fetcher->embedGps($file['content'], (string)$r->getExt(), (float)$r->getLat(), (float)$r->getLng());
			if ($embedded === null || $embedded === $file['content']) {
				return;
			}
			$this->storage->overwriteFile($actingUid, (int)$r->getFileId(), $embedded);
			$m = $this->storage->mtimeById($actingUid, (int)$r->getFileId());
			$r->setSyncedMtime($m > 0 ? $m : time());
			$r->setGeoUpdated($m > 0 ? $m : time());
			$this->references->update($r);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio writeGeoToFile failed: ' . $e->getMessage());
		}
	}

	/** Geocode free text to a suggested location (OpenStreetMap Nominatim). */
	public function geocode(string $query, ?string $lang = null): ?array {
		return $this->fetcher->geocode($query, $lang);
	}

	/**
	 * Geocode free text to several suggestions for a typeahead dropdown.
	 *
	 * @return array<int,array{lat:float,lng:float,place:string}>
	 */
	public function geocodeSuggest(string $query, ?string $lang = null, int $limit = 5): array {
		return $this->fetcher->geocodeSearch($query, $lang, $limit);
	}

	/** Detect + geocode a likely location from a reference's text (add-dialog suggestion). */
	public function detectLocation(string $title, string $desc, string $hashtags = '', ?string $placename = null, ?string $lang = null): ?array {
		return $this->fetcher->detectLocation($title, $desc, $hashtags, $placename, $lang);
	}

	/** Detect ALL distinct locations named in a reference's text (add-dialog suggestions). */
	public function detectLocations(string $title, string $desc, string $hashtags = '', ?string $placename = null, ?string $lang = null): array {
		return $this->fetcher->detectLocations($title, $desc, $hashtags, $placename, $lang);
	}

	/**
	 * Crop an image chosen in the add dialog. $src is an upload marker (uploaded
	 * file) or a remote URL (fetched image). Returns a new upload marker for the
	 * cropped image plus a data-URL preview.
	 *
	 * @return array{img:string,preview:string}
	 */
	public function cropImage(string $src, float $x, float $y, float $w, float $h): array {
		$bytes = null;
		if (str_starts_with($src, self::UPLOAD_PREFIX)) {
			$up = $this->fetcher->getUpload(substr($src, strlen(self::UPLOAD_PREFIX)));
			if ($up !== null) {
				$bytes = $up['content'];
			}
		} elseif ($this->looksHttp($src)) {
			$dl = $this->fetcher->fetchImage($src);
			if ($dl !== null) {
				$bytes = $dl['content'];
			}
		}
		if ($bytes === null) {
			throw new \InvalidArgumentException('Could not load the image to crop');
		}
		$cropped = $this->fetcher->cropImage($bytes, $x, $y, $w, $h);
		if ($cropped === null) {
			throw new \RuntimeException('Could not crop the image');
		}
		$res = $this->fetcher->storeUpload($cropped['content'], $cropped['mime']);
		return [
			'img' => self::UPLOAD_PREFIX . $res['key'],
			'preview' => 'data:' . $cropped['mime'] . ';base64,' . base64_encode($cropped['content']),
		];
	}

	private function referenceFileContent(Reference $r): array {
		$type = $r->getType();
		$img = (string)$r->getImg();
		$video = $r->getVideo() ? json_decode((string)$r->getVideo(), true) : null;

		// Any uploaded file (image or PDF) is materialised from its appdata blob.
		if (str_starts_with($img, self::UPLOAD_PREFIX)) {
			$up = $this->fetcher->getUpload(substr($img, strlen(self::UPLOAD_PREFIX)));
			if ($up === null) {
				return [null, ''];
			}
			if ($type === 'pdf') {
				return [$up['content'], StorageService::extForMime($up['mime'], 'pdf')];
			}
			return $this->prepareImageForStore($r, $up['content'], $up['mime'], StorageService::extForMime($up['mime'], 'png'));
		}

		switch ($type) {
			case 'text':
				return [(string)$r->getBody(), 'md'];

			case 'pdf':
				$psrc = (string)$r->getSourceUrl();
				if ($this->looksHttp($psrc)) {
					$dl = $this->fetcher->downloadFile($psrc, 'application/pdf');
					if ($dl !== null) {
						return [$dl['content'], 'pdf'];
					}
				}
				return [null, ''];

			case 'image':
				if ($this->looksHttp($img)) {
					$dl = $this->fetcher->fetchImage($img);
					if ($dl !== null) {
						return $this->prepareImageForStore($r, $dl['content'], $dl['mime'], StorageService::extForMime($dl['mime'], 'jpg'));
					}
				}
				return [null, ''];

			case 'image_url':
				$srcImg = $this->looksHttp($img) ? $img : (string)$r->getSourceUrl();
				$dl = $this->fetcher->fetchImage($srcImg);
				if ($dl !== null) {
					$ext = StorageService::extForMime($dl['mime'], StorageService::extForUrl($srcImg));
					return $this->prepareImageForStore($r, $dl['content'], $dl['mime'], $ext !== '' ? $ext : 'jpg');
				}
				return [null, ''];

			case 'video':
				$src = (string)$r->getSourceUrl();
				if (is_array($video) && ($video['provider'] ?? '') === 'file') {
					$fileUrl = (string)($video['src'] ?? $src);
					$dl = $this->fetcher->downloadFile($fileUrl);
					if ($dl !== null) {
						if ($r->getGeoSource() === null) {
							$g = $this->fetcher->extractVideoGps($dl['content']);
							if ($g !== null) { $r->setLat($g['lat']); $r->setLng($g['lng']); $r->setGeoSource('video'); }
						}
						$ext = StorageService::extForMime($dl['mime'], StorageService::extForUrl($fileUrl));
						return [$dl['content'], $ext !== '' ? $ext : 'mp4'];
					}
				}
				$poster = $this->looksHttp($img) ? $img : (is_array($video) ? ($video['thumb'] ?? null) : null);
				return [$this->fetcher->buildVideoStubHtml(is_array($video) ? $video : [], $src, $r->getTitle(), $poster), 'html'];

			case 'link':
			default:
				$src = (string)$r->getSourceUrl();
				// Web pages no longer store an HTML snapshot. Save the selected picture
				// (og:image / chooser pick) as a local WebP so the card shows the image,
				// while keeping type=link + source_url so "Open link" opens the real page.
				if ($this->looksHttp($img)) {
					$dl = $this->fetcher->fetchImage($img);
					if ($dl !== null) {
						$ext = StorageService::extForMime($dl['mime'], StorageService::extForUrl($img));
						return $this->prepareImageForStore($r, $dl['content'], $dl['mime'], $ext !== '' ? $ext : 'jpg');
					}
				}
				// No importable image: keep a lightweight stub so every ref still = one file.
				$poster = $this->looksHttp($img) ? $img : null;
				return [$this->fetcher->buildLinkStubHtml($src !== '' ? $src : (string)$r->getTitle(), (string)$r->getTitle(), $poster, $r->getDescription()), 'html'];
		}
	}

	/**
	 * Reconcile ALL of the owner's boards together, so an outside Nextcloud file
	 * intervention is handled without losing app data:
	 *  - a board folder RENAMED/MOVED in Files is followed by file id (location repaired,
	 *    refs kept) instead of being dropped + re-adopted as a new board;
	 *  - a file MOVED between the owner's board folders MIGRATES its reference (comments,
	 *    description, note, tags all kept) instead of drop + recreate;
	 *  - a file whose content was EDITED/REPLACED is re-synced (text body, image dims, and
	 *    auto-extracted geo) via its modification time;
	 *  - a reference is only dropped when its file is present in NONE of the owner's boards.
	 */
	private function reconcileOwnedBoards(array $owned): void {
		try {
			// 1. Resolve + repair each board's folder (id-first, so Files-side renames stick).
			$folders = [];
			$boardMap = [];
			foreach ($owned as $b) {
				$boardMap[$b->getId()] = $b;
				$info = $this->storage->boardFolderInfo($b);
				if ($info === null) {
					$info = $this->storage->ensureBoardFolder($b);
				}
				$dirty = false;
				if ($b->getLocation() !== $info['path']) {
					$b->setLocation($info['path']);
					$dirty = true;
				}
				if ((int)$b->getFolderId() !== (int)$info['id']) {
					$b->setFolderId((int)$info['id']);
					$dirty = true;
				}
				if ($dirty) {
					$this->boards->update($b);
				}
				$folders[$b->getId()] = $info['folder'];
			}

			// 2. Every present file across the owner's boards: fileId -> board + file info.
			$fileBoard = [];
			$fileInfo = [];
			foreach ($owned as $b) {
				foreach ($this->storage->listFiles($folders[$b->getId()]) as $f) {
					if (!isset($fileBoard[$f['fileId']])) {
						$fileBoard[$f['fileId']] = $b->getId();
						$fileInfo[$f['fileId']] = $f;
					}
				}
			}

			// 3. All owned refs, de-duped by file id (and stale title-only rows).
			$ownedIds = array_map(static fn (Board $b) => $b->getId(), $owned);
			$refByFileId = [];
			$seenTitle = [];
			$refs = [];
			foreach ($this->references->findByBoards($ownedIds) as $r) {
				$fid = $r->getFileId();
				$tkey = mb_strtolower(trim((string)$r->getTitle()));
				$dupFile = $fid !== null && isset($refByFileId[$fid]);
				$dupTitle = $fid === null && $tkey !== '' && isset($seenTitle[$tkey]);
				if ($dupFile || $dupTitle) {
					$this->comments->deleteByRef($r->getId());
					$this->references->delete($r);
					continue;
				}
				if ($fid !== null) {
					$refByFileId[$fid] = $r;
				}
				if ($tkey !== '') {
					$seenTitle[$tkey] = true;
				}
				$refs[] = $r;
			}

			// 4. Reconcile each ref against the present-files map.
			foreach ($refs as $r) {
				$fid = $r->getFileId();
				if ($fid === null) {
					continue; // back-filled below
				}
				if (isset($fileBoard[$fid])) {
					$f = $fileInfo[$fid];
					$update = false;
					if ($r->getBoardId() !== $fileBoard[$fid]) { // moved between my boards
						$r->setBoardId($fileBoard[$fid]);
						$update = true;
					}
					if ((string)$r->getTitle() !== $f['base'] || (string)$r->getExt() !== $f['ext']) { // renamed
						$r->setTitle($f['base']);
						$r->setExt($f['ext']);
						$update = true;
					}
					if ($this->resyncOnMtime($r, $f)) { // content edited/replaced
						$update = true;
					}
					if ($update) {
						$this->references->update($r);
					}
				} else {
					$this->tags->deleteRefTagsByRef($r->getId());
					$this->comments->deleteByRef($r->getId());
					$this->references->delete($r);
				}
			}

			// 5. Adopt present files that no ref owns yet.
			$claimed = [];
			foreach ($refs as $r) {
				if ($r->getFileId() !== null) {
					$claimed[$r->getFileId()] = true;
				}
			}
			foreach ($fileBoard as $fid => $bid) {
				if (!isset($claimed[$fid]) && isset($boardMap[$bid])) {
					$this->createBareReference($boardMap[$bid], $fileInfo[$fid]);
				}
			}

			// 6. Back-fill files for refs that still have none.
			foreach ($refs as $r) {
				if ($r->getFileId() === null && isset($boardMap[$r->getBoardId()])) {
					$this->materializeReferenceFile($r, $boardMap[$r->getBoardId()]);
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio reconcile(owned) failed: ' . $e->getMessage());
		}
	}

	/**
	 * Re-sync a reference from its file when the file changed since the app last read it
	 * (external edit/replace in Files). Returns true if anything (incl. synced_mtime) was
	 * touched, so the caller persists. Never clobbers a user's MANUAL/geocoded geo.
	 */
	private function resyncOnMtime(Reference $r, array $f): bool {
		$mtime = (int)($f['mtime'] ?? 0);
		$synced = $r->getSyncedMtime();
		if ($synced !== null && $mtime <= (int)$synced) {
			return false; // unchanged since last read
		}
		$type = (string)$r->getType();
		if ($type === 'text' && $r->getFileId() !== null) {
			$file = $this->storage->readFile((string)$r->getOwner(), (int)$r->getFileId());
			if ($file !== null && (string)$r->getBody() !== $file['content']) {
				$r->setBody($file['content']);
			}
		}
		if (in_array($type, ['image', 'image_url'], true) && $r->getImg() === self::FILE_MARKER) {
			// Force ensureImageDims to re-measure the (possibly new) bytes this load.
			$r->setImgW(null);
			$r->setImgH(null);
		}
		// Only re-check AUTO geo; a manual/geocoded value the user set in-app is authoritative
		// unless the file itself changed more recently (newest-wins).
		$gs = $r->getGeoSource();
		$auto = in_array($gs, [null, 'none', 'exif', 'video'], true);
		if ($auto && $mtime > (int)($r->getGeoUpdated() ?? 0)) {
			$r->setGeoSource(null); // ensureGeo re-extracts from the file this load
		}
		$r->setSyncedMtime($mtime);
		return true;
	}

	/**
	 * Reconcile a board's folder with the database: adopt new files, drop
	 * references whose file was removed, sync titles renamed in Files, and back-fill
	 * files for references that do not have one yet ($canEnsure = owner boards).
	 */
	private function reconcileBoard(Board $b, bool $canEnsure): void {
		try {
			$folder = $this->storage->boardFolder($b);
			if ($folder === null) {
				if (!$canEnsure) {
					return;
				}
				$ens = $this->storage->ensureBoardFolder($b);
				$folder = $ens['folder'];
				if ($b->getLocation() !== $ens['path']) {
					$b->setLocation($ens['path']);
					$this->boards->update($b);
				}
			}
			$files = $this->storage->listFiles($folder);
			$allRefs = $this->references->findByBoards([$b->getId()]);

			// Dedupe: drop references that point at the same file, or duplicate
			// title-only (no file) rows left by earlier same-title adds.
			$refByFileId = [];
			$seenTitle = [];
			$refs = [];
			foreach ($allRefs as $r) {
				$fid = $r->getFileId();
				$tkey = mb_strtolower(trim((string)$r->getTitle()));
				$dupFile = $fid !== null && isset($refByFileId[$fid]);
				$dupTitle = $fid === null && $tkey !== '' && isset($seenTitle[$tkey]);
				if ($dupFile || $dupTitle) {
					$this->comments->deleteByRef($r->getId());
					$this->references->delete($r);
					continue;
				}
				if ($fid !== null) {
					$refByFileId[$fid] = $r;
				}
				if ($tkey !== '') {
					$seenTitle[$tkey] = true;
				}
				$refs[] = $r;
			}

			$present = [];
			foreach ($files as $f) {
				$present[$f['fileId']] = true;
				if (isset($refByFileId[$f['fileId']])) {
					$r = $refByFileId[$f['fileId']];
					if ((string)$r->getTitle() !== $f['base'] || (string)$r->getExt() !== $f['ext']) {
						$r->setTitle($f['base']);
						$r->setExt($f['ext']);
						$this->references->update($r);
					}
					continue;
				}
				$this->createBareReference($b, $f);
			}

			foreach ($refs as $r) {
				if ($r->getFileId() !== null && !isset($present[$r->getFileId()])) {
					$this->tags->deleteRefTagsByRef($r->getId());
					$this->comments->deleteByRef($r->getId());
					$this->references->delete($r);
				}
			}

			if ($canEnsure) {
				foreach ($refs as $r) {
					if ($r->getFileId() === null) {
						$this->materializeReferenceFile($r, $b);
					}
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio reconcile failed: ' . $e->getMessage());
		}
	}

	/**
	 * Cache an image reference's intrinsic pixel dimensions the first time it is
	 * served, so the frontend can reserve the card's size before the image loads
	 * (no grid reflow on later loads). Only for real raster files in the board
	 * folder; skipped once populated, and for remote-poster/pdf/video/text types.
	 */
	private function ensureImageDims(Reference $r): void {
		if ($r->getImgW() !== null && $r->getImgH() !== null) {
			return;
		}
		$type = (string)$r->getType();
		if ($type !== 'image' && $type !== 'image_url' && $type !== 'link') {
			return;
		}
		// Only image-backed refs carry FILE_MARKER; a link stub keeps a remote/blank img
		// and is skipped here.
		if ($r->getImg() !== self::FILE_MARKER || $r->getFileId() === null) {
			return;
		}
		try {
			$file = $this->storage->readFile((string)$r->getOwner(), (int)$r->getFileId());
			if ($file === null) {
				return;
			}
			$info = @getimagesizefromstring($file['content']);
			if (is_array($info) && (int)($info[0] ?? 0) > 0 && (int)($info[1] ?? 0) > 0) {
				$r->setImgW((int)$info[0]);
				$r->setImgH((int)$info[1]);
			} else {
				// File read but not a sizable image: mark 0/0 so we don't re-read it
				// every load. The frontend treats 0 as "unknown" and uses the fallback.
				$r->setImgW(0);
				$r->setImgH(0);
			}
			$this->references->update($r);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio image dims failed: ' . $e->getMessage());
		}
	}

	/**
	 * Back-fill geolocation for references that were never checked (drop-ins adopted
	 * from Files, or references created before geo existed). Runs once per reference:
	 * reads embedded GPS from the stored image (EXIF) or video (ffprobe), else marks
	 * 'none'. Only images/videos/links carry geo; pdf/text are skipped entirely.
	 */
	private function ensureGeo(Reference $r): void {
		if ($r->getGeoSource() !== null) {
			return;
		}
		$type = (string)$r->getType();
		if (!in_array($type, ['image', 'image_url', 'video', 'link'], true)) {
			return;
		}
		$fid = $r->getFileId();
		if ($fid === null) {
			return; // no file yet; try again once materialised
		}
		try {
			$g = null;
			if ($type === 'video') {
				$file = $this->storage->readFile((string)$r->getOwner(), (int)$fid);
				$g = $file !== null ? $this->fetcher->extractVideoGps($file['content']) : null;
			} elseif ($type !== 'link') {
				$file = $this->storage->readFile((string)$r->getOwner(), (int)$fid);
				$g = $file !== null ? $this->fetcher->extractImageGps($file['content']) : null;
			}
			// 'link' snapshots carry no reliable embedded geo -> just mark checked.
			if ($g !== null) {
				$r->setLat($g['lat']);
				$r->setLng($g['lng']);
				$r->setGeoSource($type === 'video' ? 'video' : 'exif');
			} else {
				$r->setGeoSource('none');
			}
			$this->references->update($r);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio ensureGeo failed: ' . $e->getMessage());
		}
	}

	/** Create a reference for a file that appeared in the folder outside the app. */
	private function createBareReference(Board $b, array $f): void {
		$r = new Reference();
		$r->setBoardId($b->getId());
		$r->setOwner($b->getOwner());
		$r->setType($f['type']);
		$r->setTitle($f['base']);
		$r->setExt($f['ext']);
		$r->setFileId($f['fileId']);
		$r->setSeed(random_int(1, 9999));
		$r->setCreated($f['mtime'] > 0 ? $f['mtime'] : time());
		$r->setSyncedMtime((int)($f['mtime'] ?? 0));
		if ($f['type'] === 'image') {
			$r->setImg(self::FILE_MARKER);
		}
		if ($f['type'] === 'text') {
			$content = $this->storage->readFile($b->getOwner(), $f['fileId']);
			if ($content !== null) {
				$r->setBody($content['content']);
			}
		}
		$this->references->insert($r);
	}

	private function looksHttp(string $url): bool {
		return $url !== '' && (str_starts_with($url, 'http://') || str_starts_with($url, 'https://'));
	}

	/**
	 * One-time per user: convert legacy app tags (oc_curio_tags + ref_tags) into
	 * NC system tags assigned to each reference's file, then flag it done.
	 *
	 * @param Board[] $ownedBoards
	 */
	private function migrateTagsForUser(string $uid, array $ownedBoards): void {
		if ($this->config->getUserValue($uid, 'curio', 'tags_migrated', '') === '1') {
			return;
		}
		try {
			$legacy = $this->tags->findOwned($uid);
			$idMap = [];
			foreach ($legacy as $lt) {
				$arr = $this->tagService->createOrGetTag($lt->getName(), $lt->getColor(), $lt->getFolderId(), $uid);
				$idMap[$lt->getId()] = $arr['id'];
			}
			$ownedIds = array_map(static fn (Board $b) => $b->getId(), $ownedBoards);
			if (count($idMap) > 0 && count($ownedIds) > 0) {
				foreach ($this->references->findByBoards($ownedIds) as $r) {
					if ($r->getFileId() === null) {
						continue;
					}
					$legacyTags = $this->tags->tagsForRefs([$r->getId()])[$r->getId()] ?? [];
					$sysIds = [];
					foreach ($legacyTags as $lt) {
						if (isset($idMap[$lt['id']])) {
							$sysIds[] = $idMap[$lt['id']];
						}
					}
					if (count($sysIds) > 0) {
						$this->tagService->setFileTags($r->getFileId(), $sysIds);
					}
				}
			}
			$this->config->setUserValue($uid, 'curio', 'tags_migrated', '1');
		} catch (\Throwable $e) {
			$this->logger->warning('Curio tag migration failed: ' . $e->getMessage());
		}
	}

	/* ===================== helpers ===================== */

	private function assertOwner(string $owner): void {
		if ($owner !== $this->uid()) {
			throw new \RuntimeException('Not the owner');
		}
	}

	/** Titles are unique per board (they are filenames). Throws on a collision. */
	private function assertUniqueTitle(int $boardId, string $title, ?int $excludeId): void {
		$key = mb_strtolower(trim($title));
		if ($key === '') {
			return;
		}
		foreach ($this->references->findByBoards([$boardId]) as $r) {
			if ($excludeId !== null && $r->getId() === $excludeId) {
				continue;
			}
			if (mb_strtolower(trim((string)$r->getTitle())) === $key) {
				throw new \InvalidArgumentException('A reference titled "' . $title . '" already exists in this board.');
			}
		}
	}
}
