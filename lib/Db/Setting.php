<?php

declare(strict_types=1);

namespace OCA\Curio\Db;

use JsonSerializable;
use OCP\AppFramework\Db\Entity;

/**
 * @method string getUid()
 * @method void setUid(string $uid)
 * @method string getTheme()
 * @method void setTheme(string $theme)
 * @method string getLayout()
 * @method void setLayout(string $layout)
 * @method bool getLabels()
 * @method void setLabels(bool $labels)
 * @method string|null getSort()
 * @method void setSort(?string $sort)
 * @method string|null getDateFormat()
 * @method void setDateFormat(?string $dateFormat)
 * @method bool getTagTranslate()
 * @method void setTagTranslate(bool $tagTranslate)
 * @method string|null getBaseFolder()
 * @method void setBaseFolder(?string $baseFolder)
 */
class Setting extends Entity implements JsonSerializable {
	protected $uid;
	protected $theme;
	protected $layout;
	protected $labels;
	protected $sort;
	protected $dateFormat;
	protected $tagTranslate;
	protected $baseFolder;

	public function __construct() {
		$this->addType('labels', 'boolean');
		$this->addType('tagTranslate', 'boolean');
	}

	public function jsonSerialize(): array {
		return [
			'theme' => $this->theme ?? 'system',
			'layout' => $this->layout ?? 'square',
			'labels' => (bool)$this->labels,
			'sort' => $this->sort ?? 'created_desc',
			'dateFormat' => $this->dateFormat ?? 'auto',
			'tagTranslate' => (bool)$this->tagTranslate,
			'baseFolder' => $this->baseFolder ?? null,
		];
	}
}
