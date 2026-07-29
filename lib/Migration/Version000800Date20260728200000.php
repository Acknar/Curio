<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Security tighten: board shares carry Nextcloud-style permissions (READ / UPDATE
 * / CREATE / DELETE bitmask). A board share is now backed by a real NC folder
 * share; this column mirrors the permissions granted on that share so the app can
 * gate read vs write without a lookup on every request. Default 1 (READ = view
 * only) so any pre-existing share degrades to the safe, least-privilege state
 * until the owner re-grants edit.
 */
class Version000800Date20260728200000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_board_shares')) {
			$t = $schema->getTable('curio_board_shares');
			if (!$t->hasColumn('permissions')) {
				$t->addColumn('permissions', Types::INTEGER, ['notnull' => true, 'default' => 1]);
			}
		}

		return $schema;
	}
}
