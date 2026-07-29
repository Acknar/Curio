<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Storage + files redesign (v0.12.0).
 *
 * Each board maps to a real Nextcloud Files folder (boards.location). Every
 * reference is one file in that folder named by the reference title; the DB
 * keeps only the metadata around the file plus the NC node id (refs.file_id)
 * and the file extension (refs.ext) so the title stays extension-free.
 */
class Version000300Date20260728140000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_boards')) {
			$t = $schema->getTable('curio_boards');
			if (!$t->hasColumn('location')) {
				// Path of the board's Files folder, relative to the owner's user root.
				$t->addColumn('location', Types::STRING, ['notnull' => false, 'length' => 4000]);
			}
		}

		if ($schema->hasTable('curio_refs')) {
			$t = $schema->getTable('curio_refs');
			if (!$t->hasColumn('file_id')) {
				// NC node id of the file backing this reference (null until materialised).
				$t->addColumn('file_id', Types::BIGINT, ['notnull' => false]);
			}
			if (!$t->hasColumn('ext')) {
				// Lower-case extension without the dot; title = filename minus ".ext".
				$t->addColumn('ext', Types::STRING, ['notnull' => false, 'length' => 32]);
			}
			if (!$t->hasIndex('curio_refs_file_idx')) {
				$t->addIndex(['file_id'], 'curio_refs_file_idx');
			}
		}

		return $schema;
	}
}
