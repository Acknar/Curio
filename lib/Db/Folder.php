<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method string getName()
 * @method void setName(string $name)
 * @method string getOwner()
 * @method void setOwner(string $owner)
 * @method int getSort()
 * @method void setSort(int $sort)
 * @method bool getExpanded()
 * @method void setExpanded(bool $expanded)
 */
class Folder extends Entity implements JsonSerializable {
	protected $name;
	protected $owner;
	protected $sort;
	protected $expanded;

	public function __construct() {
		$this->addType('sort', 'integer');
		$this->addType('expanded', 'boolean');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'name' => $this->name,
			'sort' => (int)$this->sort,
			'expanded' => (bool)$this->expanded,
		];
	}
}
