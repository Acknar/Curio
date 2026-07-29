<?php

declare(strict_types=1);

namespace OCA\Curio\Service;

use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\SystemTag\ISystemTag;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use OCP\SystemTag\TagNotFoundException;
use Psr\Log\LoggerInterface;

/**
 * Tags are Nextcloud SYSTEM tags attached to the file that backs each reference
 * (objecttype 'files', objectid = file_id). The system tag carries the identity
 * and the colour (native, @since NC 31). The only app-specific attribute is the
 * tag-folder grouping, kept in curio_tag_meta keyed by system tag id + owner.
 *
 * Tag ids are surfaced to the frontend as ints (system tag ids are numeric
 * strings); the payload shape {id,name,color,folder} is unchanged from before.
 */
class TagService {
	private const OBJ_TYPE = 'files';

	public function __construct(
		private ISystemTagManager $tagManager,
		private ISystemTagObjectMapper $tagObjectMapper,
		private IDBConnection $db,
		private LoggerInterface $logger,
	) {
	}

	/* ===================== reading ===================== */

	/**
	 * @param int[] $fileIds
	 * @return array<int,array<int,array{id:int,name:string,color:?string}>> fileId -> tags
	 */
	public function tagsForFiles(array $fileIds): array {
		$fileIds = array_values(array_unique(array_filter(array_map('intval', $fileIds))));
		if (count($fileIds) === 0) {
			return [];
		}
		try {
			$map = $this->tagObjectMapper->getTagIdsForObjects(array_map('strval', $fileIds), self::OBJ_TYPE);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio getTagIdsForObjects failed: ' . $e->getMessage());
			return [];
		}
		$allIds = [];
		foreach ($map as $tids) {
			foreach ($tids as $tid) {
				$allIds[$tid] = true;
			}
		}
		$byId = $this->tagsById(array_keys($allIds));
		$out = [];
		foreach ($map as $objId => $tids) {
			$arr = [];
			foreach ($tids as $tid) {
				if (isset($byId[(int)$tid])) {
					$arr[] = $byId[(int)$tid];
				}
			}
			$out[(int)$objId] = $arr;
		}
		return $out;
	}

	/**
	 * The tag list for a user: tags present on their board files plus tags they
	 * have grouped into a folder (kept in the overlay even when currently unused).
	 *
	 * @param int[] $fileIds
	 * @return array<int,array{id:int,name:string,color:?string,folder:?int}>
	 */
	public function listTags(array $fileIds, string $ownerUid): array {
		$ids = [];
		foreach ($this->tagsForFiles($fileIds) as $arr) {
			foreach ($arr as $t) {
				$ids[$t['id']] = true;
			}
		}
		$meta = $this->metaForOwner($ownerUid);
		foreach ($meta as $sysId => $folderId) {
			$ids[(int)$sysId] = true;
		}
		$byId = $this->tagsById(array_keys($ids));
		$out = [];
		foreach ($byId as $id => $t) {
			$t['folder'] = isset($meta[$id]) ? (int)$meta[$id] : null;
			$out[] = $t;
		}
		usort($out, static fn ($a, $b) => strcasecmp($a['name'], $b['name']));
		return $out;
	}

	/* ===================== tag CRUD ===================== */

	public function createOrGetTag(string $name, ?string $color, ?int $folderId, string $ownerUid): array {
		$tag = $this->getOrCreateSystemTag(trim($name));
		if ($color !== null && $color !== '') {
			$this->applyColor($tag, $color);
			$tag = $this->reload($tag->getId());
		}
		$this->upsertMeta((int)$tag->getId(), $ownerUid, $folderId);
		return $this->tagToArray($tag, $folderId);
	}

	public function updateTag(int $id, ?string $name, ?string $color, ?int $folderId, bool $folderProvided, string $ownerUid): array {
		$tag = $this->reload((string)$id);
		$newName = ($name !== null && trim($name) !== '') ? trim($name) : $tag->getName();
		$newColor = $color !== null ? $this->normalizeColor($color) : $tag->getColor();
		try {
			$this->tagManager->updateTag((string)$id, $newName, $tag->isUserVisible(), $tag->isUserAssignable(), $newColor);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio updateTag failed: ' . $e->getMessage());
		}
		if ($folderProvided) {
			$this->upsertMeta($id, $ownerUid, $folderId);
		}
		$tag = $this->reload((string)$id);
		$meta = $this->metaForOwner($ownerUid);
		$folder = $folderProvided ? $folderId : (isset($meta[$id]) ? (int)$meta[$id] : null);
		return $this->tagToArray($tag, $folder);
	}

	public function deleteTag(int $id, string $ownerUid): void {
		try {
			$this->tagManager->deleteTags([(string)$id]);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio deleteTag failed: ' . $e->getMessage());
		}
		$this->deleteMeta($id, $ownerUid);
	}

	/* ===================== file <-> tag assignment ===================== */

	/** Replace the full set of tags on a file. */
	public function setFileTags(int $fileId, array $tagIds): void {
		$want = $this->existingIds($tagIds);
		$current = [];
		try {
			$m = $this->tagObjectMapper->getTagIdsForObjects([(string)$fileId], self::OBJ_TYPE);
			$current = $m[(string)$fileId] ?? [];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio read tags for file failed: ' . $e->getMessage());
		}
		$toAdd = array_values(array_diff($want, $current));
		$toRemove = array_values(array_diff($current, $want));
		if (count($toAdd) > 0) {
			try {
				$this->tagObjectMapper->assignTags((string)$fileId, self::OBJ_TYPE, $toAdd);
			} catch (\Throwable $e) {
				$this->logger->debug('Curio assignTags failed: ' . $e->getMessage());
			}
		}
		if (count($toRemove) > 0) {
			try {
				$this->tagObjectMapper->unassignTags((string)$fileId, self::OBJ_TYPE, $toRemove);
			} catch (\Throwable $e) {
				$this->logger->debug('Curio unassignTags failed: ' . $e->getMessage());
			}
		}
	}

	public function addFileTag(int $fileId, int $tagId): void {
		$ids = $this->existingIds([$tagId]);
		if (count($ids) === 0) {
			return;
		}
		try {
			$this->tagObjectMapper->assignTags((string)$fileId, self::OBJ_TYPE, $ids);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio addFileTag failed: ' . $e->getMessage());
		}
	}

	public function removeFileTag(int $fileId, int $tagId): void {
		try {
			$this->tagObjectMapper->unassignTags((string)$fileId, self::OBJ_TYPE, [(string)$tagId]);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio removeFileTag failed: ' . $e->getMessage());
		}
	}

	/** Ungroup all of a user's tags that pointed at a deleted folder. */
	public function clearFolder(int $folderId, string $ownerUid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('curio_tag_meta')
			->set('folder_id', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('folder_id', $qb->createNamedParameter($folderId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('owner', $qb->createNamedParameter($ownerUid)));
		$qb->executeStatement();
	}

	/* ===================== helpers ===================== */

	private function getOrCreateSystemTag(string $name): ISystemTag {
		try {
			return $this->tagManager->getTag($name, true, true);
		} catch (TagNotFoundException $e) {
			return $this->tagManager->createTag($name, true, true);
		}
	}

	private function applyColor(ISystemTag $tag, string $color): void {
		try {
			$this->tagManager->updateTag($tag->getId(), $tag->getName(), $tag->isUserVisible(), $tag->isUserAssignable(), $this->normalizeColor($color));
		} catch (\Throwable $e) {
			$this->logger->debug('Curio applyColor failed: ' . $e->getMessage());
		}
	}

	private function reload(string $id): ISystemTag {
		$tags = $this->tagManager->getTagsByIds([$id]);
		if (isset($tags[$id])) {
			return $tags[$id];
		}
		return array_values($tags)[0];
	}

	/** @return array<int,array{id:int,name:string,color:?string}> id -> tag */
	private function tagsById(array $ids): array {
		$ids = array_values(array_unique(array_map('strval', $ids)));
		if (count($ids) === 0) {
			return [];
		}
		try {
			$tags = $this->tagManager->getTagsByIds($ids);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio getTagsByIds failed: ' . $e->getMessage());
			return [];
		}
		$out = [];
		foreach ($tags as $t) {
			if (!$t->isUserVisible()) {
				continue;
			}
			$out[(int)$t->getId()] = ['id' => (int)$t->getId(), 'name' => $t->getName(), 'color' => $this->hashColor($t->getColor())];
		}
		return $out;
	}

	/** @return string[] system tag ids (as strings) that actually exist */
	private function existingIds(array $ids): array {
		return array_map('strval', array_keys($this->tagsById($ids)));
	}

	private function tagToArray(ISystemTag $t, ?int $folder): array {
		return ['id' => (int)$t->getId(), 'name' => $t->getName(), 'color' => $this->hashColor($t->getColor()), 'folder' => $folder];
	}

	/** NC stores tag colour as bare hex; the app uses #rrggbb. */
	private function hashColor(?string $c): ?string {
		if ($c === null || $c === '') {
			return null;
		}
		return '#' . ltrim($c, '#');
	}

	private function normalizeColor(string $c): ?string {
		$c = ltrim(trim($c), '#');
		return $c === '' ? null : $c;
	}

	/** @return array<int,?int> system_tag_id -> folder_id for this owner */
	private function metaForOwner(string $ownerUid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('system_tag_id', 'folder_id')->from('curio_tag_meta')
			->where($qb->expr()->eq('owner', $qb->createNamedParameter($ownerUid)));
		$res = $qb->executeQuery();
		$out = [];
		while ($row = $res->fetch()) {
			$out[(int)$row['system_tag_id']] = $row['folder_id'] !== null ? (int)$row['folder_id'] : null;
		}
		$res->closeCursor();
		return $out;
	}

	private function upsertMeta(int $sysId, string $ownerUid, ?int $folderId): void {
		$this->deleteMeta($sysId, $ownerUid);
		$qb = $this->db->getQueryBuilder();
		$qb->insert('curio_tag_meta')->values([
			'system_tag_id' => $qb->createNamedParameter($sysId, IQueryBuilder::PARAM_INT),
			'owner' => $qb->createNamedParameter($ownerUid),
			'folder_id' => $folderId !== null ? $qb->createNamedParameter($folderId, IQueryBuilder::PARAM_INT) : $qb->createNamedParameter(null),
		]);
		$qb->executeStatement();
	}

	private function deleteMeta(int $sysId, string $ownerUid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_tag_meta')
			->where($qb->expr()->eq('system_tag_id', $qb->createNamedParameter($sysId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('owner', $qb->createNamedParameter($ownerUid)));
		$qb->executeStatement();
	}
}
