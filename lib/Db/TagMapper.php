<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Tag>
 */
class TagMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'curio_tags', Tag::class);
	}

	public function find(int $id): Tag {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/** @return Tag[] */
	public function findOwned(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner', $qb->createNamedParameter($uid)))
			->orderBy('name', 'ASC');
		return $this->findEntities($qb);
	}

	/* ----- ref_tags link table helpers ----- */

	/**
	 * Return a map of ref_id => list of {name,color} for the given references.
	 * @param int[] $refIds
	 * @return array<int,array<int,array{name:string,color:?string}>>
	 */
	public function tagsForRefs(array $refIds): array {
		$out = [];
		if (count($refIds) === 0) {
			return $out;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('rt.ref_id', 't.id', 't.name', 't.color')
			->from('curio_ref_tags', 'rt')
			->innerJoin('rt', 'curio_tags', 't', 'rt.tag_id = t.id')
			->where($qb->expr()->in('rt.ref_id', $qb->createNamedParameter($refIds, IQueryBuilder::PARAM_INT_ARRAY)));
		$result = $qb->executeQuery();
		while ($row = $result->fetch()) {
			$rid = (int)$row['ref_id'];
			$out[$rid][] = ['id' => (int)$row['id'], 'name' => $row['name'], 'color' => $row['color']];
		}
		$result->closeCursor();
		return $out;
	}

	/** @param int[] $tagIds */
	public function setRefTags(int $refId, array $tagIds): void {
		$del = $this->db->getQueryBuilder();
		$del->delete('curio_ref_tags')
			->where($del->expr()->eq('ref_id', $del->createNamedParameter($refId, IQueryBuilder::PARAM_INT)));
		$del->executeStatement();
		foreach (array_unique($tagIds) as $tagId) {
			$ins = $this->db->getQueryBuilder();
			$ins->insert('curio_ref_tags')->values([
				'ref_id' => $ins->createNamedParameter($refId, IQueryBuilder::PARAM_INT),
				'tag_id' => $ins->createNamedParameter((int)$tagId, IQueryBuilder::PARAM_INT),
			]);
			$ins->executeStatement();
		}
	}

	public function addRefTag(int $refId, int $tagId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('ref_id')->from('curio_ref_tags')
			->where($qb->expr()->eq('ref_id', $qb->createNamedParameter($refId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('tag_id', $qb->createNamedParameter($tagId, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$exists = $res->fetch();
		$res->closeCursor();
		if ($exists) {
			return;
		}
		$ins = $this->db->getQueryBuilder();
		$ins->insert('curio_ref_tags')->values([
			'ref_id' => $ins->createNamedParameter($refId, IQueryBuilder::PARAM_INT),
			'tag_id' => $ins->createNamedParameter($tagId, IQueryBuilder::PARAM_INT),
		]);
		$ins->executeStatement();
	}

	public function removeRefTag(int $refId, int $tagId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_ref_tags')
			->where($qb->expr()->eq('ref_id', $qb->createNamedParameter($refId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('tag_id', $qb->createNamedParameter($tagId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteRefTagsByTag(int $tagId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_ref_tags')
			->where($qb->expr()->eq('tag_id', $qb->createNamedParameter($tagId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteRefTagsByRef(int $refId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('curio_ref_tags')
			->where($qb->expr()->eq('ref_id', $qb->createNamedParameter($refId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
