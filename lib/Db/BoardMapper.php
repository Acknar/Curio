<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Board>
 */
class BoardMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'curio_boards', Board::class);
	}

	public function find(int $id): Board {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, \OCP\DB\QueryBuilder\IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/** @return Board[] */
	public function findOwned(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner', $qb->createNamedParameter($uid)))
			->orderBy('created', 'ASC');
		return $this->findEntities($qb);
	}

	/** @return Board[] boards shared with the user (owned by others) */
	public function findSharedWith(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('b.*')->from($this->getTableName(), 'b')
			->innerJoin('b', 'curio_board_shares', 's', 'b.id = s.board_id')
			->where($qb->expr()->eq('s.shared_with', $qb->createNamedParameter($uid)));
		return $this->findEntities($qb);
	}
}
