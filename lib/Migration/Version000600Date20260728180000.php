<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Add a per-user "translate tags for matching" preference to curio_settings.
 */
class Version000600Date20260728180000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_settings')) {
			$t = $schema->getTable('curio_settings');
			if (!$t->hasColumn('tag_translate')) {
				$t->addColumn('tag_translate', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			}
		}

		return $schema;
	}
}
