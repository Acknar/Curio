<?php

declare(strict_types=1);

namespace OCA\Curio\Service;

use OCA\Curio\Db\Board;
use OCA\Curio\Db\SettingMapper;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\IPreview;
use Psr\Log\LoggerInterface;

/**
 * Maps each board to a real folder in the owner's Nextcloud Files and stores
 * every reference as one visible file in that folder, named by the reference
 * title. This is the source of truth for the file bytes; the database keeps the
 * metadata around each file plus its node id (file_id) and extension (ext).
 *
 * Files always live in the BOARD OWNER's Files (shared boards are served through
 * the app, never written into a collaborator's storage).
 */
class StorageService {
	public const DEFAULT_BASE = 'Curio';

	/** extension (no dot, lower-case) -> reference type */
	private const EXT_TYPE = [
		'jpg' => 'image', 'jpeg' => 'image', 'png' => 'image', 'gif' => 'image',
		'webp' => 'image', 'avif' => 'image', 'svg' => 'image', 'bmp' => 'image', 'heic' => 'image',
		'mp4' => 'video', 'webm' => 'video', 'ogv' => 'video', 'mov' => 'video', 'mkv' => 'video', 'm4v' => 'video',
		'md' => 'text', 'markdown' => 'text', 'txt' => 'text',
		'html' => 'link', 'htm' => 'link',
		'pdf' => 'pdf',
	];

	private const MIME_EXT = [
		'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp',
		'image/avif' => 'avif', 'image/svg+xml' => 'svg', 'image/bmp' => 'bmp', 'image/heic' => 'heic',
		'video/mp4' => 'mp4', 'video/webm' => 'webm', 'video/ogg' => 'ogv', 'video/quicktime' => 'mov',
		'text/html' => 'html', 'text/markdown' => 'md', 'text/plain' => 'txt',
		'application/pdf' => 'pdf',
	];

	public function __construct(
		private IRootFolder $rootFolder,
		private IPreview $previewManager,
		private SettingMapper $settings,
		private LoggerInterface $logger,
	) {
	}

	/* ===================== base folder (per user) ===================== */

	/**
	 * The user's chosen base folder path (relative to their Files root) under which
	 * all boards live. Falls back to the default name when the user has not chosen
	 * one yet, so internal callers always have a concrete path to work with.
	 */
	public function baseFor(string $uid): string {
		try {
			$s = $this->settings->findByUid($uid);
			$b = $s !== null ? trim((string)$s->getBaseFolder()) : '';
		} catch (\Throwable $e) {
			$b = '';
		}
		$b = trim(str_replace('\\', '/', $b), '/');
		return $b !== '' ? $b : self::DEFAULT_BASE;
	}

	/** True once the user has explicitly chosen a base folder. */
	public function baseConfigured(string $uid): bool {
		try {
			$s = $this->settings->findByUid($uid);
			return $s !== null && trim((string)$s->getBaseFolder()) !== '';
		} catch (\Throwable $e) {
			return false;
		}
	}

	/** True when the user's configured base folder still exists in their Files. */
	public function baseExists(string $uid): bool {
		try {
			$base = $this->baseFor($uid);
			$user = $this->rootFolder->getUserFolder($uid);
			return $user->nodeExists($base) && $user->get($base) instanceof Folder;
		} catch (\Throwable $e) {
			return false;
		}
	}

	/** Create (or reuse) the base folder at $rel in the user's Files and return it. */
	public function ensureBase(string $uid, string $rel): Folder {
		$user = $this->rootFolder->getUserFolder($uid);
		return $this->ensurePath($user, trim(str_replace('\\', '/', $rel), '/'));
	}

	/** True when $rel points at an existing folder in the user's Files (never the root). */
	public function isUserFolder(string $uid, string $rel): bool {
		try {
			$rel = trim(str_replace('\\', '/', $rel), '/');
			if ($rel === '') {
				return false;
			}
			$user = $this->rootFolder->getUserFolder($uid);
			return $user->nodeExists($rel) && $user->get($rel) instanceof Folder;
		} catch (\Throwable $e) {
			return false;
		}
	}

	/**
	 * List the immediate subfolders of $rel (or the Files root when empty) for the
	 * first-run folder picker.
	 *
	 * @return array{path:string,parent:?string,folders:array<int,array{name:string,path:string}>}
	 */
	public function browseFolders(string $uid, string $rel): array {
		$rel = trim(str_replace('\\', '/', $rel), '/');
		try {
			$user = $this->rootFolder->getUserFolder($uid);
			$node = $rel === '' ? $user : ($user->nodeExists($rel) ? $user->get($rel) : null);
			if (!($node instanceof Folder)) {
				$node = $user;
				$rel = '';
			}
			$folders = [];
			foreach ($node->getDirectoryListing() as $child) {
				if (!($child instanceof Folder)) {
					continue;
				}
				$name = $child->getName();
				if ($name === '' || $name[0] === '.') {
					continue;
				}
				$folders[] = ['name' => $name, 'path' => $rel === '' ? $name : $rel . '/' . $name];
			}
			usort($folders, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));
		} catch (\Throwable $e) {
			$this->logger->debug('Curio browseFolders failed: ' . $e->getMessage());
			$folders = [];
			$rel = '';
		}
		$parent = null;
		if ($rel !== '') {
			$up = trim(dirname($rel), '/');
			$parent = ($up === '' || $up === '.') ? '' : $up;
		}
		return ['path' => $rel, 'parent' => $parent, 'folders' => $folders];
	}

	/**
	 * Render a preview image for a stored file (e.g. a PDF's first page) via NC's
	 * preview system. Returns null when no preview provider is available.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function preview(string $ownerUid, int $fileId, int $w = 768, int $h = 1024): ?array {
		try {
			$node = $this->nodeById($ownerUid, $fileId);
			if (!($node instanceof File) || !$this->previewManager->isAvailable($node)) {
				return null;
			}
			$prev = $this->previewManager->getPreview($node, $w, $h, false);
			return ['content' => $prev->getContent(), 'mime' => (string)$prev->getMimeType()];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio preview failed: ' . $e->getMessage());
			return null;
		}
	}

	/* ===================== board folders ===================== */

	/**
	 * Ensure the board's folder exists in the owner's Files and return the folder
	 * node plus its normalised path (relative to the owner's user root).
	 *
	 * @return array{folder:Folder,path:string}
	 */
	public function ensureBoardFolder(Board $board): array {
		$rel = $this->normalizeLocation($board->getLocation(), $board->getName(), $this->baseFor($board->getOwner()));
		$user = $this->rootFolder->getUserFolder($board->getOwner());
		$folder = $this->ensurePath($user, $rel);
		return ['folder' => $folder, 'path' => $rel, 'id' => $folder->getId()];
	}

	/**
	 * Move a board's whole folder to a new location so every reference's file_id
	 * stays valid. Returns the normalised new path. Throws if the target exists.
	 */
	public function moveBoardFolder(Board $board, string $newLocation): string {
		$user = $this->rootFolder->getUserFolder($board->getOwner());
		$base = $this->baseFor($board->getOwner());
		$oldRel = $this->normalizeLocation($board->getLocation(), $board->getName(), $base);
		$newRel = trim(str_replace('\\', '/', $newLocation), '/');
		if ($newRel === '') {
			$newRel = trim($base, '/') . '/' . $this->sanitizeBase($board->getName());
		}
		if ($newRel === $oldRel) {
			$this->ensurePath($user, $newRel);
			return $newRel;
		}
		if ($user->nodeExists($newRel)) {
			throw new \InvalidArgumentException('That folder already exists; choose a new path');
		}
		$parent = trim(dirname($newRel), '/');
		if ($parent !== '' && $parent !== '.') {
			$this->ensurePath($user, $parent);
		}
		if ($user->nodeExists($oldRel)) {
			$old = $user->get($oldRel);
			if ($old instanceof Folder) {
				$old->move($user->getPath() . '/' . $newRel);
				return $newRel;
			}
		}
		$this->ensurePath($user, $newRel);
		return $newRel;
	}

	/** Overwrite an existing file's bytes by node id. */
	public function overwriteFile(string $ownerUid, int $fileId, string $content): bool {
		try {
			$node = $this->nodeById($ownerUid, $fileId);
			if ($node instanceof File) {
				$node->putContent($content);
				return true;
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio overwriteFile failed: ' . $e->getMessage());
		}
		return false;
	}

	/** The default folder path for a board with this name (under the user's base folder). */
	public function defaultBoardPath(string $ownerUid, string $boardName): string {
		return trim($this->baseFor($ownerUid), '/') . '/' . $this->sanitizeBase($boardName);
	}

	/**
	 * List the immediate subfolders of the base "Curio" folder in the
	 * user's Files, so folders created there can be adopted as boards.
	 *
	 * @return array<int,array{name:string,path:string}>
	 */
	public function listBoardFolders(string $ownerUid): array {
		try {
			$basePath = $this->baseFor($ownerUid);
			$user = $this->rootFolder->getUserFolder($ownerUid);
			if (!$user->nodeExists($basePath)) {
				return [];
			}
			$base = $user->get($basePath);
			if (!($base instanceof Folder)) {
				return [];
			}
			$out = [];
			foreach ($base->getDirectoryListing() as $node) {
				$name = $node->getName();
				if ($node instanceof Folder && $name !== '' && $name[0] !== '.') {
					$out[] = ['name' => $name, 'path' => $basePath . '/' . $name, 'fileId' => $node->getId()];
				}
			}
			return $out;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio listBoardFolders failed: ' . $e->getMessage());
			return [];
		}
	}

	/**
	 * Resolve a board's folder, preferring its stored file id (so the board follows a
	 * folder RENAME/MOVE done in Nextcloud Files) and falling back to the stored path.
	 * Returns the folder node plus its CURRENT relative path and file id, or null.
	 *
	 * @return array{folder:Folder,path:string,id:int}|null
	 */
	public function boardFolderInfo(Board $board): ?array {
		try {
			$user = $this->rootFolder->getUserFolder($board->getOwner());
			$node = null;
			$fid = $board->getFolderId();
			if ($fid !== null) {
				foreach ($user->getById((int)$fid) as $n) {
					if ($n instanceof Folder) {
						$node = $n;
						break;
					}
				}
			}
			if ($node === null) {
				$rel = $this->normalizeLocation($board->getLocation(), $board->getName(), $this->baseFor($board->getOwner()));
				if ($user->nodeExists($rel)) {
					$n = $user->get($rel);
					if ($n instanceof Folder) {
						$node = $n;
					}
				}
			}
			if ($node === null) {
				return null;
			}
			return ['folder' => $node, 'path' => $this->relPath($user, $node), 'id' => $node->getId()];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio boardFolderInfo failed: ' . $e->getMessage());
			return null;
		}
	}

	/** Relative path of a node inside the user's Files root ("Curio/My Board"). */
	private function relPath(Folder $user, \OCP\Files\Node $node): string {
		$root = rtrim($user->getPath(), '/');
		$p = $node->getPath();
		return ltrim(str_starts_with($p, $root) ? substr($p, strlen($root)) : $p, '/');
	}

	/**
	 * Delete a board's own folder AND all its contents from the owner's Files, so a deleted
	 * board is not re-adopted by discoverBoards on the next reload (the reported "deleted board
	 * reappears" bug). Only ever deletes a folder that lives INSIDE the base "Curio"
	 * folder - never the base itself, the Files root, or an arbitrary external folder a board
	 * might point at. No-op when the folder cannot be resolved.
	 */
	public function deleteBoardFolder(Board $board): void {
		try {
			$info = $this->boardFolderInfo($board);
			if ($info === null) {
				return;
			}
			$path = trim((string)$info['path'], '/');
			$base = trim($this->baseFor($board->getOwner()), '/');
			if ($path === '' || $path === $base || !str_starts_with($path . '/', $base . '/')) {
				return; // outside the base folder: leave the user's files untouched
			}
			$info['folder']->delete();
		} catch (\Throwable $e) {
			$this->logger->warning('Curio deleteBoardFolder failed: ' . $e->getMessage());
		}
	}

	/** Resolve the board folder without creating it; null if it does not exist. */
	public function boardFolder(Board $board): ?Folder {
		$info = $this->boardFolderInfo($board);
		if ($info !== null) {
			return $info['folder'];
		}
		try {
			$rel = $this->normalizeLocation($board->getLocation(), $board->getName(), $this->baseFor($board->getOwner()));
			$user = $this->rootFolder->getUserFolder($board->getOwner());
			if (!$user->nodeExists($rel)) {
				return null;
			}
			$node = $user->get($rel);
			return $node instanceof Folder ? $node : null;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio boardFolder failed: ' . $e->getMessage());
			return null;
		}
	}

	/**
	 * Resolve the board folder as seen by the ACTING user, so writes by a
	 * collaborator go through their own mounted view of the shared folder and
	 * Nextcloud enforces (and attributes) the operation. For the owner this is the
	 * board folder in their Files; for a collaborator it is the same node reached by
	 * file id through the share mount. Returns null when the acting user cannot
	 * reach the folder (no share / removed), i.e. no writable access.
	 */
	public function boardFolderAs(Board $board, string $actingUid): ?Folder {
		try {
			$ownerFolder = $this->boardFolder($board);
			if ($ownerFolder === null) {
				return null;
			}
			if ($actingUid === $board->getOwner()) {
				return $ownerFolder;
			}
			$user = $this->rootFolder->getUserFolder($actingUid);
			$nodes = $user->getById($ownerFolder->getId());
			foreach ($nodes as $n) {
				if ($n instanceof Folder) {
					return $n;
				}
			}
			return null;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio boardFolderAs failed: ' . $e->getMessage());
			return null;
		}
	}

	private function normalizeLocation(?string $location, string $boardName, string $base): string {
		$loc = trim((string)$location);
		$loc = trim(str_replace('\\', '/', $loc), '/');
		if ($loc === '') {
			$loc = trim($base, '/') . '/' . $this->sanitizeBase($boardName);
		}
		return $loc;
	}

	private function ensurePath(Folder $user, string $rel): Folder {
		if ($rel === '') {
			return $user;
		}
		$cur = $user;
		foreach (explode('/', $rel) as $seg) {
			if ($seg === '' || $seg === '.') {
				continue;
			}
			if ($cur->nodeExists($seg)) {
				$n = $cur->get($seg);
				if (!($n instanceof Folder)) {
					throw new \RuntimeException('Board location conflicts with a file: ' . $seg);
				}
				$cur = $n;
			} else {
				$cur = $cur->newFolder($seg);
			}
		}
		return $cur;
	}

	/* ===================== reference files ===================== */

	/**
	 * Create or overwrite the file backing a reference. Returns its node id.
	 */
	public function writeFile(Folder $folder, string $title, string $ext, string $content): int {
		$name = $this->fileName($title, $ext);
		if ($folder->nodeExists($name)) {
			$node = $folder->get($name);
			if ($node instanceof File) {
				$node->putContent($content);
				return $node->getId();
			}
			throw new \RuntimeException('A folder already uses the name: ' . $name);
		}
		return $folder->newFile($name, $content)->getId();
	}

	/**
	 * Rename a reference's file to match a new title. Returns the (unchanged) node
	 * id, or null if the file is gone. Throws on a name collision so the caller can
	 * surface it (titles are unique per board).
	 */
	public function renameFile(string $ownerUid, int $fileId, string $newTitle, string $ext): ?int {
		$node = $this->nodeById($ownerUid, $fileId);
		if ($node === null) {
			return null;
		}
		$name = $this->fileName($newTitle, $ext);
		if ($node->getName() === $name) {
			return $fileId;
		}
		$parent = $node->getParent();
		if ($parent->nodeExists($name)) {
			throw new \InvalidArgumentException('A reference named "' . $name . '" already exists in this board');
		}
		$node->move($parent->getPath() . '/' . $name);
		return $node->getId();
	}

	/** Move a reference's file into another board folder (same owner). */
	public function moveFile(string $ownerUid, int $fileId, Folder $dest): ?int {
		$node = $this->nodeById($ownerUid, $fileId);
		if ($node === null) {
			return null;
		}
		$name = $node->getName();
		if ($dest->nodeExists($name)) {
			throw new \InvalidArgumentException('A reference named "' . $name . '" already exists in the target board');
		}
		$node->move($dest->getPath() . '/' . $name);
		return $node->getId();
	}

	/** Move a reference's file to the trash. Silent if already gone. */
	public function trashFile(string $ownerUid, int $fileId): void {
		try {
			$node = $this->nodeById($ownerUid, $fileId);
			if ($node !== null) {
				$node->delete();
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio trashFile failed: ' . $e->getMessage());
		}
	}

	/**
	 * Read a reference's file bytes.
	 *
	 * @return array{content:string,mime:string,name:string}|null
	 */
	public function readFile(string $ownerUid, int $fileId): ?array {
		try {
			$node = $this->nodeById($ownerUid, $fileId);
			if (!($node instanceof File)) {
				return null;
			}
			return ['content' => $node->getContent(), 'mime' => (string)$node->getMimeType(), 'name' => $node->getName()];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio readFile failed: ' . $e->getMessage());
			return null;
		}
	}

	/* ===================== reconciliation ===================== */

	/**
	 * List the real files in a board folder (skips subfolders and dotfiles).
	 *
	 * @return array<int,array{fileId:int,name:string,base:string,ext:string,type:string,size:int,mtime:int}>
	 */
	public function listFiles(Folder $folder): array {
		$out = [];
		foreach ($folder->getDirectoryListing() as $node) {
			if (!($node instanceof File)) {
				continue;
			}
			$name = $node->getName();
			if ($name === '' || $name[0] === '.') {
				continue;
			}
			$ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
			$base = $ext !== '' ? substr($name, 0, -(strlen($ext) + 1)) : $name;
			$out[] = [
				'fileId' => $node->getId(),
				'name' => $name,
				'base' => $base,
				'ext' => $ext,
				'type' => self::EXT_TYPE[$ext] ?? 'file',
				'size' => (int)$node->getSize(),
				'mtime' => (int)$node->getMTime(),
			];
		}
		return $out;
	}

	/* ===================== helpers ===================== */

	private function nodeById(string $ownerUid, int $fileId) {
		$user = $this->rootFolder->getUserFolder($ownerUid);
		$nodes = $user->getById($fileId);
		return count($nodes) > 0 ? $nodes[0] : null;
	}

	/** Current modification time of a file by node id (0 if unreadable). */
	public function mtimeById(string $ownerUid, int $fileId): int {
		try {
			$node = $this->nodeById($ownerUid, $fileId);
			return $node !== null ? (int)$node->getMTime() : 0;
		} catch (\Throwable $e) {
			return 0;
		}
	}

	public function fileName(string $title, string $ext): string {
		$base = $this->sanitizeBase($title);
		return $ext !== '' ? $base . '.' . strtolower($ext) : $base;
	}

	/** Turn a title into a safe file base name (no path/forbidden characters). */
	public function sanitizeBase(string $title): string {
		$t = str_replace(['/', '\\'], ' ', $title);
		$t = preg_replace('/[\x00-\x1F\x7F]/u', '', $t) ?? '';
		$t = preg_replace('/[:*?"<>|]/', '', $t) ?? '';
		$t = preg_replace('/\s+/u', ' ', $t) ?? '';
		$t = trim($t);
		$t = trim($t, '.');
		$t = trim($t);
		if ($t === '') {
			$t = 'untitled';
		}
		if (mb_strlen($t) > 200) {
			$t = rtrim(mb_substr($t, 0, 200));
		}
		return $t;
	}

	public static function typeForExt(string $ext): string {
		return self::EXT_TYPE[strtolower($ext)] ?? 'file';
	}

	public static function extForMime(string $mime, string $fallback = ''): string {
		$mime = strtolower(trim(explode(';', $mime)[0]));
		return self::MIME_EXT[$mime] ?? $fallback;
	}

	/** Best-effort extension from a URL path. */
	public static function extForUrl(string $url): string {
		$path = (string)parse_url($url, PHP_URL_PATH);
		$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
		return preg_match('/^[a-z0-9]{1,5}$/', $ext) ? $ext : '';
	}
}
