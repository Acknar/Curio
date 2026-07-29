<?php

declare(strict_types=1);

namespace OCA\Curio\Controller;

use OCA\Curio\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IRequest;
use OCP\Util;
use Psr\Log\LoggerInterface;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IEventDispatcher $eventDispatcher,
		private IAppManager $appManager,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		// Vue bundle; styles are injected by the bundle itself (style-loader).
		Util::addScript(Application::APP_ID, 'curio-main');

		// Load Nextcloud Text's editor bundle so the frontend can mount the real
		// Text editor for markdown notes (window.OCA.Text.createEditor). Guarded:
		// if the Text app is absent/disabled the app simply falls back to the
		// built-in textarea editor, so this must never break the page.
		$this->loadTextEditor();

		$response = new TemplateResponse(Application::APP_ID, 'main');

		// Allow the thumbnails/og-images and video providers we will fetch later.
		$csp = new ContentSecurityPolicy();
		$csp->addAllowedImageDomain('*');
		$csp->addAllowedMediaDomain('*');
		$csp->addAllowedFrameDomain("'self'");
		$csp->addAllowedFrameDomain('blob:'); // inline PDF preview (served as a blob URL, no X-Frame-Options)
		$csp->addAllowedFrameDomain('https://www.youtube.com');
		$csp->addAllowedFrameDomain('https://player.vimeo.com');
		$csp->addAllowedFrameDomain('https://www.instagram.com'); // Instagram reel/tv embeds
		$csp->addAllowedFrameDomain('https://instagram.com');
		$response->setContentSecurityPolicy($csp);

		return $response;
	}

	/**
	 * Dispatch the Text app's LoadEditor event so its editor assets are added to
	 * this page. No-op (and never fatal) when the Text app is not installed.
	 */
	private function loadTextEditor(): void {
		try {
			if (!$this->appManager->isEnabledForUser('text')) {
				return;
			}
			if (!class_exists(\OCA\Text\Event\LoadEditor::class)) {
				return;
			}
			$this->eventDispatcher->dispatchTyped(new \OCA\Text\Event\LoadEditor());
		} catch (\Throwable $e) {
			// Text integration is optional; log and continue with the fallback editor.
			$this->logger->debug('Curio: could not load Text editor: ' . $e->getMessage());
		}
	}
}
