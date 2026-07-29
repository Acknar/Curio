<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Folder>
 */
class FolderMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'curio_folders', Folder::class);
	}

	public function find(int $id): Folder {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/** @return Folder[] */
	public function findOwned(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('owner', $qb->createNamedParameter($uid)))
			->orderBy('sort', 'ASC');
		return $this->findEntities($qb);
	}
}
