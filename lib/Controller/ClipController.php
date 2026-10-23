<?php

declare(strict_types=1);

namespace OCA\Curio\Controller;

use OCA\Curio\AppInfo\Application;
use OCA\Curio\Service\CurioService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\CORS;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * Web-clipper API. These endpoints are the only ones a browser extension (or any
 * external client) talks to. Every method delegates to the exact same
 * CurioService logic the in-app add dialog uses, so a clipped reference is
 * indistinguishable from one added inside the app.
 *
 * Security model (deliberately different from ApiController):
 *  - #[NoCSRFRequired]: the caller is not a Nextcloud page and has no request
 *    token. That is safe here ONLY because authentication is an explicit
 *    app-password sent in the Authorization header, never an ambient session
 *    cookie. CSRF attacks rely on ambient cookies; a bearer/app-password does
 *    not travel automatically, so there is nothing to forge.
 *  - #[CORS]: lets the extension call these from its own origin. Nextcloud's
 *    CORS middleware re-authenticates each CORS request from the Authorization
 *    header and refuses if the request instead carries a session cookie, so a
 *    logged-in browser cannot be tricked into cross-origin calls.
 *  - #[NoAdminRequired]: still requires a logged-in (app-password) user; all of
 *    Curio's board-write permission checks run server-side, unchanged.
 */
class ClipController extends Controller {
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

	/** Credential check for the extension's options page: confirms URL + app password reach a working Curio. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function ping(): JSONResponse {
		return $this->run(fn () => [
			'ok' => true,
			'app' => Application::APP_ID,
			'version' => '1.0.5',
			'user' => $this->service->uid(),
		]);
	}

	/** Boards + tags + folders + user language (no references), for the popup pickers. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function state(): JSONResponse {
		return $this->run(fn () => $this->service->clipState());
	}

	/** Server-side metadata fetch, used when the clipper only has a plain URL. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function fetch(string $url = ''): JSONResponse {
		return $this->run(fn () => $this->service->fetchMeta($url));
	}

	/** Detect one or more locations from a caption (title/desc/hashtags). */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function geocodeDetect(string $title = '', string $desc = '', string $hashtags = '', string $placename = '', string $lang = ''): JSONResponse {
		return $this->run(function () use ($title, $desc, $hashtags, $placename, $lang) {
			$results = $this->service->detectLocations($title, $desc, $hashtags, $placename !== '' ? $placename : null, $lang !== '' ? $lang : null);
			return ['result' => $results[0] ?? null, 'results' => $results];
		});
	}

	/** Location typeahead for the popup's place field. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function geocodeSuggest(string $q = '', string $lang = ''): JSONResponse {
		return $this->run(fn () => ['results' => $this->service->geocodeSuggest($q, $lang !== '' ? $lang : null, 5)]);
	}

	/**
	 * Accept media bytes fetched in the user's logged-in browser (the whole point
	 * of a clipper: Instagram and other login-walled media the server cannot fetch
	 * itself). Returns an upload marker to pass as `img` to reference().
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
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

	/**
	 * Accept video bytes fetched in the user's logged-in browser (an Instagram reel the
	 * server cannot download from a datacentre IP). Returns an upload marker to place in
	 * a video reference's video.src so it is stored as a local, playable file.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function uploadVideo(): JSONResponse {
		return $this->run(function () {
			$file = $_FILES['file'] ?? null;
			if (!is_array($file) || (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
				throw new \InvalidArgumentException('No file uploaded');
			}
			$content = file_get_contents($file['tmp_name']);
			if ($content === false) {
				throw new \RuntimeException('Could not read the uploaded file');
			}
			return $this->service->uploadVideo($content, isset($file['type']) ? (string)$file['type'] : null);
		});
	}

	/** Create a tag on the fly, so hashtag suggestions can become real tags like in the app. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function createTag(string $name = '', ?string $color = null, ?int $folder = null): JSONResponse {
		return $this->run(fn () => $this->service->createTag($name, $color, $folder));
	}

	/** Create the reference. Identical payload contract to POST /api/references. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[CORS]
	public function reference(): JSONResponse {
		$data = $this->request->getParams();
		return $this->run(fn () => $this->service->createReference($data));
	}
}
