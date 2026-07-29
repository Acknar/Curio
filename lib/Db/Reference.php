<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method int getBoardId()
 * @method void setBoardId(int $boardId)
 * @method string getOwner()
 * @method void setOwner(string $owner)
 * @method string getType()
 * @method void setType(string $type)
 * @method string|null getTitle()
 * @method void setTitle(?string $title)
 * @method string|null getDescription()
 * @method void setDescription(?string $description)
 * @method string|null getSourceUrl()
 * @method void setSourceUrl(?string $sourceUrl)
 * @method string|null getImg()
 * @method void setImg(?string $img)
 * @method string|null getVideo()
 * @method void setVideo(?string $video)
 * @method string|null getBody()
 * @method void setBody(?string $body)
 * @method string|null getNote()
 * @method void setNote(?string $note)
 * @method int getSeed()
 * @method void setSeed(int $seed)
 * @method int|null getFileId()
 * @method void setFileId(?int $fileId)
 * @method string|null getExt()
 * @method void setExt(?string $ext)
 * @method int getCreated()
 * @method void setCreated(int $created)
 * @method int|null getImgW()
 * @method void setImgW(?int $imgW)
 * @method int|null getImgH()
 * @method void setImgH(?int $imgH)
 * @method float|null getLat()
 * @method void setLat(?float $lat)
 * @method float|null getLng()
 * @method void setLng(?float $lng)
 * @method string|null getPlace()
 * @method void setPlace(?string $place)
 * @method string|null getGeoSource()
 * @method void setGeoSource(?string $geoSource)
 * @method int|null getSyncedMtime()
 * @method void setSyncedMtime(?int $syncedMtime)
 * @method int|null getGeoUpdated()
 * @method void setGeoUpdated(?int $geoUpdated)
 */
class Reference extends Entity implements JsonSerializable {
	protected $boardId;
	protected $owner;
	protected $type;
	protected $title;
	protected $description;
	protected $sourceUrl;
	protected $img;
	protected $video;
	protected $body;
	protected $note;
	protected $seed;
	protected $fileId;
	protected $ext;
	protected $created;
	protected $imgW;
	protected $imgH;
	protected $lat;
	protected $lng;
	protected $place;
	protected $geoSource;
	protected $syncedMtime;
	protected $geoUpdated;

	/** @var array<int,array{name:string,color:?string}> populated by the service */
	public array $tagList = [];

	public function __construct() {
		$this->addType('boardId', 'integer');
		$this->addType('seed', 'integer');
		$this->addType('fileId', 'integer');
		$this->addType('created', 'integer');
		$this->addType('imgW', 'integer');
		$this->addType('imgH', 'integer');
		$this->addType('lat', 'float');
		$this->addType('lng', 'float');
		$this->addType('syncedMtime', 'integer');
		$this->addType('geoUpdated', 'integer');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'board' => (int)$this->boardId,
			'owner' => $this->owner,
			'type' => $this->type,
			'title' => $this->title,
			'desc' => $this->description,
			'source_url' => $this->sourceUrl,
			'img' => $this->img,
			'video' => $this->video ? json_decode($this->video, true) : null,
			'body' => $this->body,
			'note' => $this->note,
			'seed' => (int)$this->seed,
			'file_id' => $this->fileId !== null ? (int)$this->fileId : null,
			'ext' => $this->ext,
			'created' => (int)$this->created,
			'w' => $this->imgW !== null ? (int)$this->imgW : null,
			'h' => $this->imgH !== null ? (int)$this->imgH : null,
			'lat' => $this->lat !== null ? (float)$this->lat : null,
			'lng' => $this->lng !== null ? (float)$this->lng : null,
			'place' => $this->place,
			'geoSource' => $this->geoSource,
			'tags' => $this->tagList,
		];
	}
}
