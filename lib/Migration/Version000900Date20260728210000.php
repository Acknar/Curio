<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Geolocation per reference: lat/lng (decimal degrees), an optional human place
 * label, and geo_source marking where it came from. geo_source doubles as the
 * "already checked" sentinel so extraction runs once, not on every load:
 *   NULL  = not yet checked
 *   'none'= checked, nothing found
 *   'exif' | 'video' | 'page' | 'geocoded' | 'manual' = found (lat/lng set)
 * Only images / videos / web links ever carry geo (pdf + text never).
 */
class Version000900Date20260728210000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('curio_refs')) {
			$t = $schema->getTable('curio_refs');
			if (!$t->hasColumn('lat')) {
				$t->addColumn('lat', Types::FLOAT, ['notnull' => false]);
			}
			if (!$t->hasColumn('lng')) {
				$t->addColumn('lng', Types::FLOAT, ['notnull' => false]);
			}
			if (!$t->hasColumn('place')) {
				$t->addColumn('place', Types::STRING, ['notnull' => false, 'length' => 255]);
			}
			if (!$t->hasColumn('geo_source')) {
				$t->addColumn('geo_source', Types::STRING, ['notnull' => false, 'length' => 16]);
			}
		}

		return $schema;
	}
}
