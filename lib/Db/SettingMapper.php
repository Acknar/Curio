<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\IDBConnection;

/**
 * @extends QBMapper<Setting>
 */
class SettingMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'curio_settings', Setting::class);
	}

	public function findByUid(string $uid): ?Setting {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('uid', $qb->createNamedParameter($uid)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException $e) {
			return null;
		}
	}
}
