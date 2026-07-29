<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method string getName()
 * @method void setName(string $name)
 * @method string|null getColor()
 * @method void setColor(?string $color)
 * @method int|null getFolderId()
 * @method void setFolderId(?int $folderId)
 * @method string getOwner()
 * @method void setOwner(string $owner)
 */
class Tag extends Entity implements JsonSerializable {
	protected $name;
	protected $color;
	protected $folderId;
	protected $owner;

	public function __construct() {
		$this->addType('folderId', 'integer');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'name' => $this->name,
			'color' => $this->color,
			'folder' => $this->folderId !== null ? (int)$this->folderId : null,
		];
	}
}
