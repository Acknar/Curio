<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Add a per-user date format preference to curio_settings.
 */
class Version000500Date20260728170000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_settings')) {
			$t = $schema->getTable('curio_settings');
			if (!$t->hasColumn('date_format')) {
				$t->addColumn('date_format', Types::STRING, ['notnull' => false, 'length' => 8, 'default' => 'auto']);
			}
		}

		return $schema;
	}
}
