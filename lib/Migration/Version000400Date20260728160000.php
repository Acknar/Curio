<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Tags become Nextcloud system tags (v0.13.0). The system tag carries the tag
 * identity + colour (native, @since NC 31); this overlay keeps only the
 * app-specific tag-folder grouping, keyed by the system tag id. The legacy
 * oc_curio_tags / oc_curio_ref_tags tables are kept for the one-time
 * migration and are no longer written to afterwards.
 */
class Version000400Date20260728160000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('curio_tag_meta')) {
			$t = $schema->createTable('curio_tag_meta');
			// system_tag_id = the Nextcloud system tag id this grouping applies to.
			$t->addColumn('system_tag_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('folder_id', Types::BIGINT, ['notnull' => false]);
			$t->setPrimaryKey(['system_tag_id', 'owner']);
			$t->addIndex(['owner'], 'curio_tagmeta_owner_idx');
		}

		return $schema;
	}
}
