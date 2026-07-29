<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * First-run folder setup (1.0.0): curio_settings.base_folder holds the per-user
 * path, relative to the user's Files root, under which Curio keeps its boards.
 * Null/empty means the user has not chosen one yet, so the app asks them to
 * create or pick a folder on first launch (or if the chosen folder goes missing).
 */
class Version001100Date20260729130000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_settings')) {
			$t = $schema->getTable('curio_settings');
			if (!$t->hasColumn('base_folder')) {
				$t->addColumn('base_folder', Types::STRING, ['notnull' => false, 'length' => 4000]);
			}
		}

		return $schema;
	}
}
