<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method int getRefId()
 * @method void setRefId(int $refId)
 * @method string getActor()
 * @method void setActor(string $actor)
 * @method string|null getMessage()
 * @method void setMessage(?string $message)
 * @method int getCreated()
 * @method void setCreated(int $created)
 */
class Comment extends Entity implements JsonSerializable {
	protected $refId;
	protected $actor;
	protected $message;
	protected $created;

	public function __construct() {
		$this->addType('refId', 'integer');
		$this->addType('created', 'integer');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'ref' => (int)$this->refId,
			'actor' => $this->actor,
			'message' => $this->message,
			'created' => (int)$this->created,
		];
	}
}
