<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Robustness against outside Nextcloud file interventions (0.28.0):
 *  - curio_boards.folder_id : the board folder's NC file id, so a board follows a
 *    folder RENAME/MOVE done in Files (resolve by id, not by path) instead of being
 *    wiped + re-adopted as a new board.
 *  - curio_refs.synced_mtime : the file mtime the app last read, so an external edit
 *    (text body / replaced image bytes) is re-synced into the DB.
 *  - curio_refs.geo_updated : when the app last set geo, for newest-wins between the
 *    file's embedded GPS and the DB (file mtime > geo_updated => the file wins).
 */
class Version001000Date20260729120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_boards')) {
			$t = $schema->getTable('curio_boards');
			if (!$t->hasColumn('folder_id')) {
				$t->addColumn('folder_id', Types::BIGINT, ['notnull' => false]);
			}
		}
		if ($schema->hasTable('curio_refs')) {
			$t = $schema->getTable('curio_refs');
			if (!$t->hasColumn('synced_mtime')) {
				$t->addColumn('synced_mtime', Types::BIGINT, ['notnull' => false]);
			}
			if (!$t->hasColumn('geo_updated')) {
				$t->addColumn('geo_updated', Types::BIGINT, ['notnull' => false]);
			}
		}

		return $schema;
	}
}
