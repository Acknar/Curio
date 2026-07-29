<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Comment>
 */
class CommentMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'curio_comments', Comment::class);
	}

	public function find(int $id): Comment {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/**
	 * @param int[] $refIds
	 * @return array<int,array> map ref_id => list of comment arrays
	 */
	public function commentsForRefs(array $refIds): array {
		$out = [];
		if (count($refIds) === 0) {
			return $out;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('ref_id', $qb->createNamedParameter($refIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->orderBy('created', 'ASC');
		foreach ($this->findEntities($qb) as $c) {
			$out[$c->getRefId()][] = $c->jsonSerialize();
		}
		return $out;
	}

	public function deleteByRef(int $refId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('ref_id', $qb->createNamedParameter($refId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
