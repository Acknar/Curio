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
 * @method string|null getColor()
 * @method void setColor(?string $color)
 * @method string|null getLocation()
 * @method void setLocation(?string $location)
 * @method int getCreated()
 * @method void setCreated(int $created)
 * @method int|null getFolderId()
 * @method void setFolderId(?int $folderId)
 */
class Board extends Entity implements JsonSerializable {
	protected $name;
	protected $owner;
	protected $color;
	protected $location;
	protected $created;
	protected $folderId;

	public function __construct() {
		$this->addType('created', 'integer');
		$this->addType('folderId', 'integer');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'name' => $this->name,
			'owner' => $this->owner,
			'color' => $this->color,
			'location' => $this->location,
			'created' => (int)$this->created,
		];
	}
}
