<?php

declare(strict_types=1);

namespace OCA\Curio\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Initial Curio schema.
 */
class Version000100Date20260727120000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('curio_boards')) {
			$t = $schema->createTable('curio_boards');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('color', Types::STRING, ['notnull' => false, 'length' => 16]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['owner'], 'curio_boards_owner_idx');
		}

		if (!$schema->hasTable('curio_board_shares')) {
			$t = $schema->createTable('curio_board_shares');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('shared_with', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['board_id', 'shared_with'], 'curio_bshare_unq_idx');
			$t->addIndex(['shared_with'], 'curio_bshare_uid_idx');
		}

		if (!$schema->hasTable('curio_folders')) {
			$t = $schema->createTable('curio_folders');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('sort', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('expanded', Types::BOOLEAN, ['notnull' => false, 'default' => true]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['owner'], 'curio_folders_owner_idx');
		}

		if (!$schema->hasTable('curio_tags')) {
			$t = $schema->createTable('curio_tags');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 128]);
			$t->addColumn('color', Types::STRING, ['notnull' => false, 'length' => 16]);
			$t->addColumn('folder_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['owner'], 'curio_tags_owner_idx');
		}

		if (!$schema->hasTable('curio_refs')) {
			$t = $schema->createTable('curio_refs');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('board_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('title', Types::STRING, ['notnull' => false, 'length' => 512]);
			$t->addColumn('description', Types::TEXT, ['notnull' => false]);
			$t->addColumn('source_url', Types::STRING, ['notnull' => false, 'length' => 2048]);
			$t->addColumn('img', Types::STRING, ['notnull' => false, 'length' => 2048]);
			$t->addColumn('video', Types::TEXT, ['notnull' => false]);
			$t->addColumn('body', Types::TEXT, ['notnull' => false]);
			$t->addColumn('note', Types::TEXT, ['notnull' => false]);
			$t->addColumn('seed', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['board_id'], 'curio_refs_board_idx');
			$t->addIndex(['owner'], 'curio_refs_owner_idx');
		}

		if (!$schema->hasTable('curio_ref_tags')) {
			$t = $schema->createTable('curio_ref_tags');
			$t->addColumn('ref_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('tag_id', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['ref_id', 'tag_id']);
			$t->addIndex(['tag_id'], 'curio_reftags_tag_idx');
		}

		if (!$schema->hasTable('curio_comments')) {
			$t = $schema->createTable('curio_comments');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('ref_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('actor', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('message', Types::TEXT, ['notnull' => false]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['ref_id'], 'curio_comments_ref_idx');
		}

		if (!$schema->hasTable('curio_settings')) {
			$t = $schema->createTable('curio_settings');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('theme', Types::STRING, ['notnull' => false, 'length' => 16, 'default' => 'system']);
			$t->addColumn('layout', Types::STRING, ['notnull' => false, 'length' => 16, 'default' => 'square']);
			$t->addColumn('labels', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['uid'], 'curio_settings_uid_idx');
		}

		return $schema;
	}
}
