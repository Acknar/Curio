<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Cache each reference image's intrinsic pixel size so the grid can reserve the
 * correct card size before the image loads (no layout reflow on every load).
 */
class Version000700Date20260728190000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_refs')) {
			$t = $schema->getTable('curio_refs');
			if (!$t->hasColumn('img_w')) {
				$t->addColumn('img_w', Types::INTEGER, ['notnull' => false, 'default' => null]);
			}
			if (!$t->hasColumn('img_h')) {
				$t->addColumn('img_h', Types::INTEGER, ['notnull' => false, 'default' => null]);
			}
		}

		return $schema;
	}
}
