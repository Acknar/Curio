<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Add a per-user grid sort preference to curio_settings.
 */
class Version000200Date20260728100000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_settings')) {
			$t = $schema->getTable('curio_settings');
			if (!$t->hasColumn('sort')) {
				$t->addColumn('sort', Types::STRING, ['notnull' => false, 'length' => 16, 'default' => 'created_desc']);
			}
		}

		return $schema;
	}
}
