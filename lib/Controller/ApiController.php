<?php

declare(strict_types=1);

namespace OCA\Curio\Controller;

use OCA\Curio\AppInfo\Application;
use OCA\Curio\Service\CurioService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;

class ApiController extends Controller {
	public function __construct(
		IRequest $request,
		private CurioService $service,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	private function run(callable $fn): JSONResponse {
		try {
			return new JSONResponse($fn());
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (\Throwable $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
	}

	#[NoAdminRequired]
	public function state(): JSONResponse {
		return $this->run(fn () => $this->service->getState());
	}

	/* boards */

	#[NoAdminRequired]
	public function createBoard(string $name = '', ?string $color = null, ?string $location = null): JSONResponse {
		return $this->run(fn () => $this->service->createBoard($name, $color, $location));
	}

	#[NoAdminRequired]
	public function updateBoard(int $id, ?string $name = null, ?string $color = null, ?string $location = null): JSONResponse {
		return $this->run(fn () => $this->service->updateBoard($id, $name, $color, $location));
	}

	#[NoAdminRequired]
	public function deleteBoard(int $id): JSONResponse {
		return $this->run(function () use ($id) {
			$this->service->deleteBoard($id);
			return ['status' => 'ok'];
		});
	}

	#[NoAdminRequired]
	public function shareBoard(int $id, string $shareWith, ?string $permissions = null): JSONResponse {
		return $this->run(fn () => $this->service->shareBoard($id, $shareWith, $permissions));
	}

	#[NoAdminRequired]
	public function unshareBoard(int $id, string $shareWith): JSONResponse {
		return $this->run(function () use ($id, $shareWith) {
			$this->service->unshareBoard($id, $shareWith);
			return ['status' => 'ok'];
		});
	}

	#[NoAdminRequired]
	public function exportBoard(int $id): Response {
		try {
			$csv = $this->service->exportCsv($id);
		} catch (\Throwable $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		}
		return new DataDownloadResponse($csv, 'curio-export.csv', 'text/csv');
	}

	#[NoAdminRequired]
	public function importBoard(int $id, string $csv = ''): JSONResponse {
		return $this->run(fn () => $this->service->importCsv($id, $csv));
	}

	/* references */

	#[NoAdminRequired]
	public function createReference(): JSONResponse {
		$data = $this->request->getParams();
		return $this->run(fn () => $this->service->createReference($data));
	}

	#[NoAdminRequired]
	public function fetch(string $url = ''): JSONResponse {
		return $this->run(fn () => $this->service->fetchMeta($url));
	}

	#[NoAdminRequired]
	public function geocode(string $q = '', string $lang = ''): JSONResponse {
		return $this->run(fn () => ['result' => $this->service->geocode($q, $lang !== '' ? $lang : null)]);
	}

	#[NoAdminRequired]
	public function geocodeSuggest(string $q = '', string $lang = ''): JSONResponse {
		return $this->run(fn () => ['results' => $this->service->geocodeSuggest($q, $lang !== '' ? $lang : null, 5)]);
	}

	#[NoAdminRequired]
	public function geocodeDetect(string $title = '', string $desc = '', string $hashtags = '', string $placename = '', string $lang = ''): JSONResponse {
		return $this->run(function () use ($title, $desc, $hashtags, $placename, $lang) {
			$results = $this->service->detectLocations($title, $desc, $hashtags, $placename !== '' ? $placename : null, $lang !== '' ? $lang : null);
			// `result` (first) kept for backward compatibility; `results` is the full distinct set.
			return ['result' => $results[0] ?? null, 'results' => $results];
		});
	}

	#[NoAdminRequired]
	public function crop(string $src = '', float $x = 0.0, float $y = 0.0, float $w = 1.0, float $h = 1.0): JSONResponse {
		return $this->run(fn () => $this->service->cropImage($src, $x, $y, $w, $h));
	}

	#[NoAdminRequired]
	public function upload(): JSONResponse {
		return $this->run(function () {
			$file = $_FILES['file'] ?? null;
			if (!is_array($file) || (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
				throw new \InvalidArgumentException('No file uploaded');
			}
			$content = file_get_contents($file['tmp_name']);
			if ($content === false) {
				throw new \RuntimeException('Could not read the uploaded file');
			}
			return $this->service->uploadImage($content, isset($file['type']) ? (string)$file['type'] : null);
		});
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function thumbnail(int $id): Response {
		try {
			$thumb = $this->service->getReferenceThumbnail($id);
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		} catch (\Throwable $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		}
		if ($thumb === null) {
			return new JSONResponse(['error' => 'No image'], Http::STATUS_NOT_FOUND);
		}
		$response = new DataDisplayResponse($thumb['content'], Http::STATUS_OK, ['Content-Type' => $thumb['mime']]);
		$response->cacheFor(86400, false, true);
		return $response;
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function file(int $id): Response {
		try {
			$file = $this->service->getReferenceFile($id);
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		} catch (\Throwable $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		}
		if ($file === null) {
			return new JSONResponse(['error' => 'No file'], Http::STATUS_NOT_FOUND);
		}
		$response = new DataDisplayResponse($file['content'], Http::STATUS_OK, ['Content-Type' => $file['mime']]);
		$response->cacheFor(3600, false, true);
		return $response;
	}

	#[NoAdminRequired]
	public function updateReference(int $id): JSONResponse {
		$data = $this->request->getParams();
		return $this->run(fn () => $this->service->updateReference($id, $data));
	}

	#[NoAdminRequired]
	public function deleteReference(int $id): JSONResponse {
		return $this->run(function () use ($id) {
			$this->service->deleteReference($id);
			return ['status' => 'ok'];
		});
	}

	#[NoAdminRequired]
	public function bulkTag(array $refIds = [], array $addTagIds = [], array $removeTagIds = []): JSONResponse {
		return $this->run(function () use ($refIds, $addTagIds, $removeTagIds) {
			$this->service->bulkTag($refIds, $addTagIds, $removeTagIds);
			return ['status' => 'ok'];
		});
	}

	/* comments */

	#[NoAdminRequired]
	public function addComment(int $id, string $message): JSONResponse {
		return $this->run(fn () => $this->service->addComment($id, $message));
	}

	#[NoAdminRequired]
	public function deleteComment(int $id): JSONResponse {
		return $this->run(function () use ($id) {
			$this->service->deleteComment($id);
			return ['status' => 'ok'];
		});
	}

	/* tags */

	#[NoAdminRequired]
	public function createTag(string $name, ?string $color = null, ?int $folder = null): JSONResponse {
		return $this->run(fn () => $this->service->createTag($name, $color, $folder));
	}

	#[NoAdminRequired]
	public function updateTag(int $id, ?string $name = null, ?string $color = null, ?int $folder = null): JSONResponse {
		$folderProvided = $this->request->getParam('folder', '__missing__') !== '__missing__';
		return $this->run(fn () => $this->service->updateTag($id, $name, $color, $folder, $folderProvided));
	}

	#[NoAdminRequired]
	public function deleteTag(int $id): JSONResponse {
		return $this->run(function () use ($id) {
			$this->service->deleteTag($id);
			return ['status' => 'ok'];
		});
	}

	/* folders */

	#[NoAdminRequired]
	public function createFolder(string $name): JSONResponse {
		return $this->run(fn () => $this->service->createFolder($name));
	}

	#[NoAdminRequired]
	public function updateFolder(int $id, ?string $name = null, ?bool $expanded = null): JSONResponse {
		return $this->run(fn () => $this->service->updateFolder($id, $name, $expanded));
	}

	#[NoAdminRequired]
	public function deleteFolder(int $id): JSONResponse {
		return $this->run(function () use ($id) {
			$this->service->deleteFolder($id);
			return ['status' => 'ok'];
		});
	}

	/* settings */

	#[NoAdminRequired]
	public function getSettings(): JSONResponse {
		return $this->run(fn () => $this->service->getSettings());
	}

	#[NoAdminRequired]
	public function updateSettings(?string $theme = null, ?string $layout = null, ?bool $labels = null, ?string $sort = null, ?string $dateFormat = null): JSONResponse {
		return $this->run(fn () => $this->service->updateSettings($theme, $layout, $labels, $sort, $dateFormat));
	}

	/* base folder (first-run setup) */

	#[NoAdminRequired]
	public function setBaseFolder(string $mode = 'create', ?string $name = null, ?string $path = null): JSONResponse {
		return $this->run(fn () => $this->service->setBaseFolder($mode, $name, $path));
	}

	#[NoAdminRequired]
	public function browseFolders(string $path = ''): JSONResponse {
		return $this->run(fn () => $this->service->browseFolders($path));
	}
}
