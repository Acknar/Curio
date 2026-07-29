<?php

declare(strict_types=1);

namespace OCA\Curio\Service;

use OCA\Curio\AppInfo\Application;
use OCP\Files\AppData\IAppDataFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\Http\Client\IClientService;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * Fetches link/video metadata (og: tags, oEmbed) and downloads + caches remote
 * images into the app's appdata so the board can show real thumbnails instead of
 * gradient placeholders.
 *
 * Network egress is subject to Nextcloud's built-in SSRF protection (local and
 * private addresses are blocked). For sandbox testing against a localhost fixture
 * set the app config flag `allow_local_fetch=yes`; production leaves it off.
 */
class FetcherService {
	private const UA = 'Mozilla/5.0 (compatible; Nextcloud-Curio/1.0; +https://nextcloud.com)';
	private const MAX_HTML = 2 * 1024 * 1024;   // 2 MB of HTML is plenty for <head>
	private const MAX_IMAGE = 12 * 1024 * 1024; // 12 MB image cap
	private const MAX_UPLOAD = 32 * 1024 * 1024; // 32 MB upload cap (images + PDFs)
	private const MAX_VIDEO = 64 * 1024 * 1024; // 64 MB direct-video cap (in-memory download)
	private const THUMB_DIR = 'thumbnails';
	private const UPLOAD_DIR = 'uploads';

	public function __construct(
		private IClientService $clientService,
		private IAppDataFactory $appDataFactory,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/* ===================== META FETCH ===================== */

	/**
	 * Fetch metadata for a URL the user is adding.
	 *
	 * @return array{type:string,title:?string,description:?string,image:?string,video:?array}
	 */
	public function fetchMeta(string $url): array {
		$url = trim($url);
		if (!$this->isHttpUrl($url)) {
			throw new \InvalidArgumentException('A valid http(s) URL is required');
		}

		// Video providers: derive embed/thumb offline; take the real title/description/
		// poster from the watch page's og tags (og:description is the video description,
		// NOT the channel name); fall back to oEmbed only if the page gives nothing.
		$video = $this->guessVideo($url);
		if ($video !== null) {
			$out = [
				'type' => 'video',
				'title' => null,
				'description' => null,
				'image' => $video['thumb'] ?? null,
				'video' => $video,
			];
			$html = $this->fetchText($url);
			if ($html !== null) {
				$meta = $this->parseHtmlMeta($html, $url);
				// Social VIDEOS (Instagram reels, TikTok, etc.) stuff the same engagement
				// prefix / @mentions / emoji into og:description as photo posts do - clean
				// them the same way. YouTube/Vimeo (not social hosts) are left untouched so
				// their real video title/description are kept.
				$vhost = strtolower((string)parse_url($url, PHP_URL_HOST));
				if (preg_match('/(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|threads\.net)$/', $vhost)) {
					$meta = $this->refineSocialMeta($meta, $url);
				}
				if ($meta['title'] !== null) {
					$out['title'] = $meta['title'];
				}
				if ($meta['description'] !== null) {
					$out['description'] = $meta['description'];
				}
				if ($meta['image'] !== null) {
					$out['image'] = $meta['image'];
					$out['video']['thumb'] = $meta['image'];
				}
			}
			if ($out['title'] === null || $out['image'] === null) {
				$this->enrichVideo($url, $out);
			}
			return $out;
		}

		// Direct PDF link: download + preview it like a file.
		if (preg_match('/\.pdf(\?|#|$)/i', $url)) {
			return ['type' => 'pdf', 'title' => null, 'description' => null, 'image' => null, 'video' => null];
		}

		// Otherwise treat it as a web page and parse og/meta tags.
		$html = $this->fetchText($url);
		if ($html === null) {
			// Could not fetch; still return the URL so the user can save it.
			return ['type' => 'link', 'title' => null, 'description' => null, 'image' => null, 'video' => null];
		}
		$meta = $this->parseHtmlMeta($html, $url);
		// Keep the RAW title/description BEFORE refineSocialMeta reshapes them, so location
		// detection runs against the untouched caption (place names can sit in an engagement
		// prefix, a sentence that becomes the title, or text that gets truncated away).
		$rawTitle = (string)($meta['title'] ?? '');
		$rawDesc = (string)($meta['description'] ?? '');
		$meta = $this->refineSocialMeta($meta, $url);
		$geo = $this->parsePageGeo($html);

		// For social posts and photo/video pages, grab the actual media (download
		// the og:image / og:video) instead of saving an HTML snapshot of the page.
		$host = strtolower((string)parse_url($url, PHP_URL_HOST));
		$isSocial = (bool)preg_match('/(^|\.)(instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|threads\.net|flickr\.com|imgur\.com|pinterest\.[a-z.]+|500px\.com)$/', $host);
		$ogType = strtolower((string)($meta['type'] ?? ''));
		if (!empty($meta['video']) && ($isSocial || str_contains($ogType, 'video'))) {
			return [
				'type' => 'video',
				'title' => $meta['title'],
				'description' => $meta['description'],
				'image' => $meta['image'],
				'video' => ['provider' => 'file', 'src' => $meta['video']],
			];
		}
		// All candidate images on the page (og/twitter images + content <img>), so the
		// user can pick which one to import - useful for photo galleries and social
		// posts that expose several images.
		$images = $this->collectImages($html, $url, $meta['image']);
		// Instagram: the main-page og:image is often a SQUARE crop, and carousels expose
		// only that one image. Pull better images from (a) the public embed page - its
		// EmbeddedMediaImage is the uncropped main photo (fixes the square crop for single
		// posts + a carousel cover), and (b) any display_url JSON in the page. Login-walled
		// posts expose neither -> falls back to og:image. Full carousels need the web clipper.
		if (preg_match('/(^|\.)instagram\.com$/', $host)) {
			$igImgs = array_values(array_unique(array_merge($this->instagramEmbedImages($url), $this->extractInstagramImages($html))));
			if (!empty($igImgs)) {
				// Use ONLY the uncropped IG images; the square og:image the page also
				// exposes is dropped so the chooser never offers the cropped thumbnail.
				$meta['image'] = $igImgs[0];
				$images = array_slice($igImgs, 0, 24);
			}
		}

		if ($meta['image'] !== null && ($isSocial || str_contains($ogType, 'photo') || str_contains($ogType, 'image'))) {
			return [
				'type' => 'image_url',
				'title' => $meta['title'],
				'description' => $meta['description'],
				'image' => $meta['image'],
				'images' => $images,
				'video' => null,
				'geo' => $geo,
				'raw_title' => $rawTitle,
				'raw_desc' => $rawDesc,
			];
		}

		// If the page itself is a direct image, present it as an image reference.
		$type = 'link';
		if ($meta['image'] === null && preg_match('/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i', $url)) {
			$type = 'image_url';
			$meta['image'] = $url;
			if (!in_array($url, $images, true)) {
				array_unshift($images, $url);
			}
		}
		return [
			'type' => $type,
			'title' => $meta['title'],
			'description' => $meta['description'],
			'image' => $meta['image'],
			'images' => $images,
			'video' => null,
			'geo' => $geo,
			'raw_title' => $rawTitle,
			'raw_desc' => $rawDesc,
		];
	}

	/**
	 * Collect candidate image URLs from a page so the user can choose which to
	 * import: the og/twitter images first (primary), then in-content <img> (largest
	 * srcset entry), filtered of icons/sprites/svg/tiny and deduped. Absolute URLs.
	 *
	 * @return string[]
	 */
	private function collectImages(string $html, string $baseUrl, ?string $primary): array {
		$out = [];
		$add = function (?string $u) use (&$out, $baseUrl): void {
			if ($u === null) {
				return;
			}
			$u = trim($u);
			if ($u === '' || str_starts_with(strtolower($u), 'data:')) {
				return;
			}
			$abs = $this->absoluteUrl($baseUrl, $u);
			if ($abs === null || $abs === '' || !preg_match('#^https?://#i', $abs)) {
				return;
			}
			if (preg_match('/\.svg(\?|#|$)/i', $abs)) {
				return;
			}
			if (preg_match('/(sprite|favicon|emoji|spacer|1x1|tracking|pixel\.)/i', $abs)) {
				return;
			}
			if (!in_array($abs, $out, true) && count($out) < 40) {
				$out[] = $abs;
			}
		};
		// Primary (og:image) first so it stays the default selection.
		$add($primary);
		try {
			$doc = new \DOMDocument();
			libxml_use_internal_errors(true);
			$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
			libxml_clear_errors();
			$xp = new \DOMXPath($doc);
			$lower = "translate(@%s,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
			// Every og:image / twitter:image (a page may declare several).
			$metaImg = $xp->query('//meta[' . sprintf($lower, 'property') . "='og:image' or " . sprintf($lower, 'property') . "='og:image:url' or " . sprintf($lower, 'property') . "='og:image:secure_url' or " . sprintf($lower, 'name') . "='twitter:image' or " . sprintf($lower, 'name') . "='twitter:image:src']/@content");
			if ($metaImg !== false) {
				foreach ($metaImg as $n) {
					$add((string)$n->nodeValue);
				}
			}
			$linkImg = $xp->query("//link[" . sprintf($lower, 'rel') . "='image_src']/@href");
			if ($linkImg !== false) {
				foreach ($linkImg as $n) {
					$add((string)$n->nodeValue);
				}
			}
			// In-content images: pick the largest srcset entry, skip tiny declared sizes.
			$imgs = $xp->query('//img');
			if ($imgs !== false) {
				foreach ($imgs as $img) {
					if (count($out) >= 40) {
						break;
					}
					$w = (int)$img->getAttribute('width');
					$h = (int)$img->getAttribute('height');
					if ($w > 0 && $h > 0 && max($w, $h) < 120) {
						continue;
					}
					$best = $this->largestSrcset($img->getAttribute('srcset'));
					$add($best ?? ($img->getAttribute('src') ?: $img->getAttribute('data-src')));
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('Curio collectImages failed: ' . $e->getMessage());
		}
		return array_slice($out, 0, 24);
	}

	/**
	 * Best-effort extraction of Instagram carousel image URLs from the embedded page
	 * JSON (display_url / display_src on edge_sidecar_to_children). Returns [] when the
	 * post is login-walled and exposes no media JSON - the durable fix is the web clipper.
	 *
	 * @return string[]
	 */
	private function extractInstagramImages(string $html): array {
		$out = [];
		foreach (['display_url', 'display_src'] as $key) {
			if (preg_match_all('/"' . $key . '":"([^"]+)"/', $html, $m)) {
				foreach ($m[1] as $u) {
					$out[] = $this->jsonUnescapeUrl($u);
				}
			}
		}
		$out = array_values(array_unique(array_filter($out, function ($u): bool {
			return is_string($u) && $u !== ''
				&& (bool)preg_match('#^https?://#i', $u)
				&& (bool)preg_match('/(cdninstagram|fbcdn|instagram)\./i', $u);
		})));
		return array_slice($out, 0, 20);
	}

	/**
	 * Fetch a public Instagram post's EMBED page and pull the uncropped main image
	 * (the `EmbeddedMediaImage`), which the square og:image on the main page loses.
	 * Works for public posts only (a login-walled post embed shows no media). Returns
	 * the main image (+ any display_url JSON in the embed), most-relevant first.
	 *
	 * @return string[]
	 */
	private function instagramEmbedImages(string $url): array {
		if (!preg_match('#instagram\.com/(p|reel|reels|tv)/([\w-]+)#i', $url, $m)) {
			return [];
		}
		$kind = strtolower($m[1]) === 'reels' ? 'reel' : strtolower($m[1]);
		$html = $this->fetchText('https://www.instagram.com/' . $kind . '/' . $m[2] . '/embed/captioned/');
		if ($html === null) {
			return [];
		}
		return $this->parseEmbedImages($html);
	}

	/**
	 * Parse image URLs out of an Instagram embed page: the main `EmbeddedMediaImage`
	 * (uncropped), a cdninstagram <img> fallback, and any display_url JSON.
	 *
	 * @return string[]
	 */
	private function parseEmbedImages(string $html): array {
		$out = [];
		// The embed card's main image (class="EmbeddedMediaImage", src may precede/follow it).
		if (preg_match_all('#<img[^>]*\bclass="[^"]*EmbeddedMediaImage[^"]*"[^>]*>#i', $html, $tags)) {
			foreach ($tags[0] as $tag) {
				if (preg_match('#\ssrc="([^"]+)"#i', $tag, $s)) {
					$out[] = html_entity_decode($s[1], ENT_QUOTES);
				}
			}
		}
		// Fallback: any cdninstagram <img> in the embed if the class match missed.
		if (empty($out) && preg_match_all('#<img[^>]+\ssrc="([^"]*cdninstagram[^"]+)"#i', $html, $mm)) {
			foreach ($mm[1] as $u) {
				$out[] = html_entity_decode($u, ENT_QUOTES);
			}
		}
		// Plus any display_url JSON the embed page carries.
		$out = array_merge($out, $this->extractInstagramImages($html));
		$out = array_values(array_unique(array_filter($out, function ($u): bool {
			return is_string($u) && $u !== '' && (bool)preg_match('#^https?://#i', $u);
		})));
		return array_slice($out, 0, 20);
	}

	/** Turn a JSON string fragment back into a URL (\/ -> /, & -> &). */
	private function jsonUnescapeUrl(string $u): string {
		$decoded = json_decode('"' . $u . '"');
		return is_string($decoded) ? $decoded : str_replace(['\\/', '\\u0026'], ['/', '&'], $u);
	}

	/** Largest-width URL from a srcset attribute, or null. */
	private function largestSrcset(string $srcset): ?string {
		$srcset = trim($srcset);
		if ($srcset === '') {
			return null;
		}
		$best = null;
		$bestW = -1;
		foreach (explode(',', $srcset) as $part) {
			$part = trim($part);
			if ($part === '') {
				continue;
			}
			$bits = preg_split('/\s+/', $part);
			$url = $bits[0] ?? '';
			$w = 0;
			if (isset($bits[1]) && preg_match('/^(\d+)w$/', $bits[1], $m)) {
				$w = (int)$m[1];
			}
			if ($url !== '' && $w >= $bestW) {
				$bestW = $w;
				$best = $url;
			}
		}
		return $best;
	}

	/**
	 * @return array{title:?string,description:?string,image:?string}
	 */
	private function parseHtmlMeta(string $html, string $baseUrl): array {
		$doc = new \DOMDocument();
		libxml_use_internal_errors(true);
		// Force UTF-8 handling; loadHTML assumes ISO-8859-1 otherwise.
		$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
		libxml_clear_errors();
		$xp = new \DOMXPath($doc);

		$metaContent = function (array $keys) use ($xp): ?string {
			foreach ($keys as $key) {
				[$attr, $val] = $key;
				$nodes = $xp->query("//meta[translate(@$attr,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='" . strtolower($val) . "']/@content");
				if ($nodes !== false && $nodes->length > 0) {
					$c = trim((string)$nodes->item(0)->nodeValue);
					if ($c !== '') {
						return $c;
					}
				}
			}
			return null;
		};

		$title = $metaContent([['property', 'og:title'], ['name', 'twitter:title']]);
		if ($title === null) {
			$t = $xp->query('//title');
			if ($t !== false && $t->length > 0) {
				$title = trim((string)$t->item(0)->textContent) ?: null;
			}
		}
		$description = $metaContent([['property', 'og:description'], ['name', 'twitter:description'], ['name', 'description']]);
		$image = $metaContent([['property', 'og:image'], ['property', 'og:image:url'], ['property', 'og:image:secure_url'], ['name', 'twitter:image'], ['name', 'twitter:image:src']]);
		if ($image !== null) {
			$image = $this->absoluteUrl($baseUrl, $image);
		}
		$video = $metaContent([['property', 'og:video:secure_url'], ['property', 'og:video:url'], ['property', 'og:video'], ['name', 'twitter:player:stream']]);
		if ($video !== null) {
			$video = $this->absoluteUrl($baseUrl, $video);
		}
		$type = $metaContent([['property', 'og:type']]);

		return ['title' => $title, 'description' => $description, 'image' => $image, 'video' => $video, 'type' => $type];
	}

	/**
	 * Social posts (Instagram, Facebook, TikTok, X, Threads) stuff engagement noise
	 * into og:description: "1,234 likes, 56 comments - author on <date>: <caption>".
	 * Keep only the caption as the description, and use its first sentence as the
	 * title.
	 *
	 * @param array{title:?string,description:?string,image:?string} $meta
	 * @return array{title:?string,description:?string,image:?string}
	 */
	private function refineSocialMeta(array $meta, string $url): array {
		$desc = trim((string)($meta['description'] ?? ''));
		if ($desc === '') {
			return $meta;
		}
		$host = strtolower((string)parse_url($url, PHP_URL_HOST));
		$isSocial = (bool)preg_match('/(^|\.)(instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|threads\.net)$/', $host);

		// Instagram/FB/TikTok stuff engagement noise before the caption, e.g.
		// "469K likes, 1,234 comments - author on March 5, 2023: <caption>" (counts may
		// carry K/M/B suffixes; dash may be -, en or em). Drop everything up to the first
		// colon when the pre-colon segment clearly looks like that prefix (engagement
		// count, "on <platform>", or "on <Month>/<date>"), so real captions like
		// "Reflecting on life: ..." are left alone.
		$cleaned = $desc;
		$colon = mb_strpos($desc, ':');
		$prefix = $colon !== false ? mb_substr($desc, 0, min($colon, 200)) : '';
		$looksLikePrefix = $prefix !== '' && (
			(bool)preg_match('/[\d][\d.,\s]*[kmb]?\s*(likes?|comments?|views?)/iu', $prefix)
			|| (bool)preg_match('/\bon\s+(instagram|facebook|tiktok|threads|x)\b/iu', $prefix)
			|| (bool)preg_match('/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/.]\d{1,2})/iu', $prefix)
		);
		if ($colon !== false && $looksLikePrefix) {
			// It IS an engagement prefix ("N likes, M comments - author on <date>:"), so
			// drop it even when there is no caption after it (a caption-less post must not
			// fall back to showing the raw prefix as its description).
			$cleaned = (string)preg_replace('/^.*?:\s*/su', '', $desc);
		}
		$cleaned = trim($cleaned);
		// Drop wrapping straight or curly quotes left around the caption, including a
		// dangling closing quote left after a trailing period (e.g. `... back to back. ".`).
		$cleaned = trim($cleaned, "\"'\x{201C}\x{201D}\x{2018}\x{2019} ");
		$cleaned = (string)preg_replace('/\s*["\x{201C}\x{201D}\x{2018}\x{2019}]\s*[.\x{3002}]?\s*$/u', '', $cleaned);
		$cleaned = (string)preg_replace('/^\s*[.\x{3002}]?\s*["\x{201C}\x{201D}\x{2018}\x{2019}]\s*/u', '', $cleaned);
		$cleaned = trim($cleaned);
		// Strip @account mentions (and the punctuation / parentheses that join them).
		$cleaned = $this->stripMentions($cleaned);
		// Strip emoji / pictographs from social captions (owner's request).
		$cleaned = $this->stripEmoji($cleaned);

		$changed = $cleaned !== $desc;
		if ($isSocial || $changed) {
			$sentence = $this->leadTitle($cleaned);
			if ($sentence !== '') {
				// Social captions are prose, so the "first sentence" is often long. Use a
				// SHORT teaser (prefer a natural clause break, e.g. the first comma) as the
				// title, but still move the whole first sentence out of the description so it
				// doesn't repeat.
				$meta['title'] = $this->shortTitle($sentence);
				$meta['description'] = $this->stripLead($cleaned, $sentence);
			} else {
				// Empty after stripping an engagement prefix -> blank description (never fall
				// back to the raw prefix for a caption-less post).
				$meta['description'] = $cleaned;
			}
		}
		return $meta;
	}

	/**
	 * Trim an over-long lead sentence down to a headline: cut at the first clause
	 * boundary (comma / semicolon / colon / dash) that yields a reasonable length, else
	 * truncate at a word boundary with an ellipsis. Short sentences pass through as-is.
	 */
	private function shortTitle(string $s): string {
		$s = trim($s);
		$max = 72;
		if (mb_strlen($s) <= $max) {
			return $s;
		}
		if (preg_match('/^(.{20,72}?)\s*[,;:\x{2013}\x{2014}\x{2015}-]\s/u', $s, $m)) {
			return rtrim(trim($m[1]), " ,;:\x{2013}\x{2014}-");
		}
		$cut = mb_substr($s, 0, $max);
		$sp = mb_strrpos($cut, ' ');
		if ($sp !== false && $sp > (int)($max * 0.55)) {
			$cut = mb_substr($cut, 0, $sp);
		}
		return rtrim(trim($cut), " ,;:.-") . "\u{2026}";
	}

	/**
	 * Leading title of a caption: the first line, cut at the first sentence
	 * terminator within it. A line break is treated as a hard boundary, so a
	 * caption whose first line is a short headline yields that whole line.
	 */
	private function leadTitle(string $text): string {
		$firstLine = preg_split('/\r\n|\r|\n/u', $text)[0] ?? $text;
		$firstLine = trim((string)$firstLine);
		return $this->firstSentence($firstLine !== '' ? $firstLine : $text);
	}

	/**
	 * Remove @account mentions from a caption, along with the parentheses and
	 * separators that join them (e.g. "(@a, @b & @c)" or "@a x @b"). Ordinary
	 * prose around the mentions is left untouched.
	 */
	private function stripMentions(string $text): string {
		$h = '@[\p{L}0-9_]+(?:\.[\p{L}0-9_]+)*';
		$sep = '(?:[\s,;&]+|\s+(?:and|et|x|und|y|e)\s+)';
		// Parenthetical groups that contain only mentions + separators.
		$text = (string)preg_replace('/\(\s*' . $h . '(?:' . $sep . $h . ')*\s*\)/u', '', $text);
		// Runs of one or more mentions joined by separators.
		$text = (string)preg_replace('/' . $h . '(?:' . $sep . $h . ')*/u', '', $text);
		// Tidy leftover artefacts.
		$text = (string)preg_replace('/\(\s*\)/u', '', $text);
		$text = (string)preg_replace('/\s{2,}/u', ' ', $text);
		$text = (string)preg_replace('/\s+([.,!?;:])/u', '$1', $text);
		$text = (string)preg_replace('/([([{])\s+/u', '$1', $text);
		$text = trim($text, " \t\n\r-,;:&");
		return trim($text);
	}

	/** Strip emoji + pictographs (and their joiners/variation selectors) from a caption. */
	private function stripEmoji(string $text): string {
		$ranges = '\x{1F000}-\x{1FAFF}'   // symbols & pictographs, emoji, supplemental
			. '\x{2600}-\x{27BF}'          // misc symbols + dingbats
			. '\x{2B00}-\x{2BFF}'          // arrows / stars
			. '\x{2190}-\x{21FF}'          // arrows
			. '\x{2300}-\x{23FF}'          // misc technical (⏳ ⌛ ▶ etc.)
			. '\x{25A0}-\x{25FF}'          // geometric shapes
			. '\x{FE00}-\x{FE0F}'          // variation selectors
			. '\x{1F1E6}-\x{1F1FF}'        // regional indicators (flags)
			. '\x{2022}\x{2023}\x{2043}\x{2219}\x{00B7}'  // bullets / decorative dots (• ‣ ⁃ ∙ ·)
			. '\x{200D}\x{20E3}\x{2122}\x{2139}\x{FE0E}\x{FE0F}';
		$text = (string)preg_replace('/[' . $ranges . ']/u', '', $text);
		// Collapse the whitespace / lone punctuation left where bullet-only lines were removed.
		$text = (string)preg_replace('/\s{2,}/u', ' ', $text);
		$text = (string)preg_replace('/\s+([.,!?;:])/u', '$1', $text);
		return trim($text);
	}

	/** Remove the determined title from the start of the caption, if present. */
	private function stripLead(string $full, string $title): string {
		$needle = trim(rtrim($title, ".!?\x{2026}"));
		if ($needle === '' || mb_stripos($full, $needle) !== 0) {
			return trim($full);
		}
		$rest = mb_substr($full, mb_strlen($needle));
		// If the title was a length-truncated fragment the next character is a
		// letter, not a boundary; in that case leave the description intact.
		if ($rest !== '' && !preg_match('/^[\s.!?\x{2026}:;,\-]/u', $rest)) {
			return trim($full);
		}
		$rest = preg_replace('/^[\s.!?\x{2026}:;,\-]+/u', '', $rest);
		return trim((string)$rest);
	}

	/** First sentence (or a length-capped lead) of a caption, for use as a title. */
	private function firstSentence(string $text): string {
		$text = trim((string)preg_replace('/\s+/u', ' ', $text));
		if ($text === '') {
			return '';
		}
		if (preg_match('/^(.+?[.!?])(\s|$)/u', $text, $m)) {
			$s = trim($m[1]);
		} else {
			$s = $text;
		}
		// Drop the trailing sentence period so titles read as headlines, not
		// sentences (question and exclamation marks are kept as meaningful).
		$s = trim(rtrim($s, '.'));
		if (mb_strlen($s) > 120) {
			$s = rtrim(mb_substr($s, 0, 120)) . '...';
		}
		return $s;
	}

	/* ===================== VIDEO ===================== */

	/**
	 * Mirror of the frontend parseVideo(): derive provider/id/embed/thumb without
	 * any network call.
	 *
	 * @return array{provider:string,id?:string,embed?:string,thumb?:string,src?:string}|null
	 */
	private function guessVideo(string $url): ?array {
		if (preg_match('#(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([\w-]{6,})#i', $url, $m)) {
			return [
				'provider' => 'youtube',
				'id' => $m[1],
				'embed' => 'https://www.youtube.com/embed/' . $m[1],
				'thumb' => 'https://img.youtube.com/vi/' . $m[1] . '/hqdefault.jpg',
			];
		}
		if (preg_match('#vimeo\.com/(\d+)#i', $url, $m)) {
			return [
				'provider' => 'vimeo',
				'id' => $m[1],
				'embed' => 'https://player.vimeo.com/video/' . $m[1],
			];
		}
		// Instagram reels / IGTV are video: embed the post so it plays inline (public
		// posts only - a private/login-walled post shows Instagram's login prompt).
		// Plain /p/ posts are left to the photo path so carousels stay image imports.
		if (preg_match('#(?:instagram\.com|instagr\.am)/(reel|reels|tv)/([\w-]+)#i', $url, $m)) {
			$kind = strtolower($m[1]) === 'reels' ? 'reel' : strtolower($m[1]);
			return [
				'provider' => 'instagram',
				'id' => $m[2],
				'embed' => 'https://www.instagram.com/' . $kind . '/' . $m[2] . '/embed',
			];
		}
		if (preg_match('#\.(mp4|webm|ogg)(\?|$)#i', $url)) {
			return ['provider' => 'file', 'src' => $url];
		}
		return null;
	}

	/** Best-effort oEmbed enrichment (title + a better thumbnail). Never throws. */
	private function enrichVideo(string $url, array &$out): void {
		$video = $out['video'];
		$oembed = null;
		try {
			if (($video['provider'] ?? '') === 'youtube') {
				$oembed = 'https://www.youtube.com/oembed?format=json&url=' . rawurlencode($url);
			} elseif (($video['provider'] ?? '') === 'vimeo') {
				$oembed = 'https://vimeo.com/api/oembed.json?url=' . rawurlencode($url);
			}
			if ($oembed === null) {
				return;
			}
			$json = $this->fetchText($oembed);
			if ($json === null) {
				return;
			}
			$data = json_decode($json, true);
			if (!is_array($data)) {
				return;
			}
			if (!empty($data['title'])) {
				$out['title'] = (string)$data['title'];
			}
			if (!empty($data['thumbnail_url']) && ($out['image'] === null || $out['image'] === '')) {
				$out['image'] = (string)$data['thumbnail_url'];
				$out['video']['thumb'] = (string)$data['thumbnail_url'];
			}
			// Intentionally NOT using author_name as the description - that is the
			// channel, not the video description (which comes from og:description above).
		} catch (\Throwable $e) {
			$this->logger->debug('Curio oEmbed enrich failed: ' . $e->getMessage());
		}
	}

	/* ===================== THUMBNAIL CACHE ===================== */

	/**
	 * Return the cached image for a source URL, downloading + caching on first use.
	 *
	 * @return array{content:string,mime:string}|null null if unavailable
	 */
	public function getThumbnail(?string $imageUrl): ?array {
		$imageUrl = trim((string)$imageUrl);
		if (!$this->isHttpUrl($imageUrl)) {
			return null;
		}
		$key = sha1($imageUrl);
		$folder = $this->thumbFolder();

		if ($folder !== null) {
			try {
				$file = $folder->getFile($key);
				$content = $file->getContent();
				return ['content' => $content, 'mime' => $this->detectImageMime($content)];
			} catch (NotFoundException $e) {
				// fall through to download
			} catch (\Throwable $e) {
				$this->logger->debug('Curio thumb read failed: ' . $e->getMessage());
			}
		}

		$dl = $this->downloadImage($imageUrl);
		if ($dl === null) {
			return null;
		}
		if ($folder !== null) {
			try {
				$folder->newFile($key, $dl['content']);
			} catch (\Throwable $e) {
				// Non-fatal: we can still serve the freshly-downloaded bytes this time.
				$this->logger->debug('Curio thumb cache write failed: ' . $e->getMessage());
			}
		}
		return $dl;
	}

	/**
	 * @return array{content:string,mime:string}|null
	 */
	private function downloadImage(string $url): ?array {
		try {
			$resp = $this->clientService->newClient()->get($url, $this->clientOptions(15));
			if ($resp->getStatusCode() >= 400) {
				return null;
			}
			$body = (string)$resp->getBody();
			if ($body === '' || strlen($body) > self::MAX_IMAGE) {
				return null;
			}
			$mime = $this->detectImageMime($body);
			if (!str_starts_with($mime, 'image/')) {
				// Trust the server's content-type only if it is an image type.
				$ct = strtolower(trim(explode(';', (string)$resp->getHeader('Content-Type'))[0]));
				if (!str_starts_with($ct, 'image/')) {
					return null;
				}
				$mime = $ct;
			}
			return ['content' => $body, 'mime' => $mime];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio image download failed: ' . $e->getMessage());
			return null;
		}
	}

	/* ===================== UPLOADS ===================== */

	/**
	 * Store an uploaded image blob in appdata and return its storage key.
	 *
	 * @return array{key:string,mime:string}
	 */
	public function storeUpload(string $content, ?string $declaredMime): array {
		if ($content === '' || strlen($content) > self::MAX_UPLOAD) {
			throw new \InvalidArgumentException('File is empty or larger than the 32 MB limit');
		}
		$mime = $this->detectImageMime($content);
		$allowed = static fn (string $m): bool => str_starts_with($m, 'image/') || $m === 'application/pdf';
		if (!$allowed($mime)) {
			$dm = $declaredMime !== null ? strtolower(trim(explode(';', $declaredMime)[0])) : '';
			if ($allowed($dm)) {
				$mime = $dm;
			} else {
				throw new \InvalidArgumentException('Only image or PDF uploads are supported');
			}
		}
		$folder = $this->uploadFolder();
		if ($folder === null) {
			throw new \RuntimeException('Upload storage is unavailable');
		}
		$key = bin2hex(random_bytes(16));
		$folder->newFile($key, $content);
		return ['key' => $key, 'mime' => $mime];
	}

	/**
	 * @return array{content:string,mime:string}|null
	 */
	public function getUpload(string $key): ?array {
		if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
			return null;
		}
		$folder = $this->uploadFolder();
		if ($folder === null) {
			return null;
		}
		try {
			$content = $folder->getFile($key)->getContent();
			return ['content' => $content, 'mime' => $this->detectImageMime($content)];
		} catch (NotFoundException $e) {
			return null;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio upload read failed: ' . $e->getMessage());
			return null;
		}
	}

	public function deleteUpload(string $key): void {
		if (!preg_match('/^[a-f0-9]{32}$/', $key)) {
			return;
		}
		$folder = $this->uploadFolder();
		if ($folder === null) {
			return;
		}
		try {
			$folder->getFile($key)->delete();
		} catch (\Throwable $e) {
			// already gone / non-fatal
		}
	}

	private function uploadFolder(): ?ISimpleFolder {
		try {
			$appData = $this->appDataFactory->get(Application::APP_ID);
			try {
				return $appData->getFolder(self::UPLOAD_DIR);
			} catch (NotFoundException $e) {
				return $appData->newFolder(self::UPLOAD_DIR);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('Curio appdata unavailable: ' . $e->getMessage());
			return null;
		}
	}

	/* ===================== downloads for the board folder ===================== */

	/**
	 * Public wrapper: download a remote image (bytes + mime), or null.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function fetchImage(string $url): ?array {
		return $this->isHttpUrl($url) ? $this->downloadImage($url) : null;
	}

	/**
	 * Download a direct media file (e.g. a .mp4/.webm) up to MAX_VIDEO. Providers
	 * that only stream (YouTube/Vimeo) are handled with an HTML stub instead.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function downloadFile(string $url, string $mustStartWith = 'video/'): ?array {
		if (!$this->isHttpUrl($url)) {
			return null;
		}
		try {
			$resp = $this->clientService->newClient()->get($url, $this->clientOptions(30));
			if ($resp->getStatusCode() >= 400) {
				return null;
			}
			$body = (string)$resp->getBody();
			if ($body === '' || strlen($body) > self::MAX_VIDEO) {
				return null;
			}
			$ct = strtolower(trim(explode(';', (string)$resp->getHeader('Content-Type'))[0]));
			if ($mustStartWith !== '' && !str_starts_with($ct, $mustStartWith)) {
				$okByExt = ($mustStartWith === 'video/' && preg_match('/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i', $url))
					|| ($mustStartWith === 'application/pdf' && preg_match('/\.pdf(\?|#|$)/i', $url));
				if (!$okByExt) {
					return null;
				}
				$ct = $ct !== '' ? $ct : ($mustStartWith === 'application/pdf' ? 'application/pdf' : 'video/mp4');
			}
			return ['content' => $body, 'mime' => $ct];
		} catch (\Throwable $e) {
			$this->logger->debug('Curio downloadFile failed: ' . $e->getMessage());
			return null;
		}
	}

	/**
	 * Downscale an oversized raster image for card thumbnails (longest edge capped).
	 * Passes through SVG and anything GD cannot handle.
	 *
	 * @return array{content:string,mime:string}
	 */
	public function downscale(string $content, string $mime, int $max = 1200): array {
		if (!function_exists('imagecreatefromstring')) {
			return ['content' => $content, 'mime' => $mime];
		}
		$base = strtolower(trim(explode(';', $mime)[0]));
		if (!in_array($base, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
			return ['content' => $content, 'mime' => $mime];
		}
		$im = @imagecreatefromstring($content);
		if ($im === false) {
			return ['content' => $content, 'mime' => $mime];
		}
		$w = imagesx($im);
		$h = imagesy($im);
		if (max($w, $h) <= $max) {
			imagedestroy($im);
			return ['content' => $content, 'mime' => $mime];
		}
		$scale = $max / max($w, $h);
		$out = imagescale($im, (int)round($w * $scale), (int)round($h * $scale));
		imagedestroy($im);
		if ($out === false) {
			return ['content' => $content, 'mime' => $mime];
		}
		ob_start();
		if ($base === 'image/png') {
			imagealphablending($out, false);
			imagesavealpha($out, true);
			imagepng($out);
			$m = 'image/png';
		} elseif ($base === 'image/webp' && function_exists('imagewebp')) {
			imagesavealpha($out, true);
			imagewebp($out);
			$m = 'image/webp';
		} else {
			imagejpeg($out, null, 82);
			$m = 'image/jpeg';
		}
		$data = (string)ob_get_clean();
		imagedestroy($out);
		return $data !== '' ? ['content' => $data, 'mime' => $m] : ['content' => $content, 'mime' => $mime];
	}

	/* ===================== WebP conversion + geolocation ===================== */

	/**
	 * Convert an image to WebP (shrinks files; the stored board file becomes .webp).
	 * Tries Imagick first (broader input support, incl. HEIC where the delegate
	 * exists), then GD. Returns null - so the caller keeps the original as-is - for
	 * SVG (vector), animated GIF (would be flattened), or when no encoder can read it.
	 * NB re-encoding strips EXIF, so callers MUST read GPS from the original first.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function toWebp(string $bytes, string $mime, int $maxEdge = 2048, int $quality = 82): ?array {
		$base = strtolower(trim(explode(';', $mime)[0]));
		if ($base === 'image/svg+xml') {
			return null;
		}
		if ($base === 'image/gif' && $this->isAnimatedGif($bytes)) {
			return null;
		}
		// Imagick path.
		if (class_exists('\\Imagick')) {
			try {
				$im = new \Imagick();
				$im->readImageBlob($bytes);
				if ($im->getNumberImages() > 1) {
					$im = $im->coalesceImages();
					$im->setIteratorIndex(0);
				}
				$w = $im->getImageWidth();
				$h = $im->getImageHeight();
				if (max($w, $h) > $maxEdge) {
					$scale = $maxEdge / max($w, $h);
					$im->resizeImage((int)round($w * $scale), (int)round($h * $scale), \Imagick::FILTER_LANCZOS, 1);
				}
				$im->setImageFormat('webp');
				$im->setImageCompressionQuality($quality);
				$im->stripImage();
				$out = $im->getImageBlob();
				$im->clear();
				if ($out !== '') {
					return ['content' => $out, 'mime' => 'image/webp'];
				}
			} catch (\Throwable $e) {
				$this->logger->debug('Curio Imagick webp failed, trying GD: ' . $e->getMessage());
			}
		}
		// GD path.
		if (function_exists('imagecreatefromstring') && function_exists('imagewebp')) {
			$im = @imagecreatefromstring($bytes);
			if ($im !== false) {
				$w = imagesx($im);
				$h = imagesy($im);
				if (max($w, $h) > $maxEdge) {
					$scale = $maxEdge / max($w, $h);
					$scaled = imagescale($im, (int)round($w * $scale), (int)round($h * $scale));
					if ($scaled !== false) {
						imagedestroy($im);
						$im = $scaled;
					}
				}
				if (function_exists('imagepalettetotruecolor')) {
					imagepalettetotruecolor($im);
				}
				imagealphablending($im, false);
				imagesavealpha($im, true);
				ob_start();
				imagewebp($im, null, $quality);
				$out = (string)ob_get_clean();
				imagedestroy($im);
				if ($out !== '') {
					return ['content' => $out, 'mime' => 'image/webp'];
				}
			}
		}
		return null;
	}

	/**
	 * Crop an image by fractional rectangle (0..1) and return WebP bytes. Used by the
	 * add-dialog manual crop; done server-side so cross-origin fetched images (which
	 * would taint a client canvas) can be cropped too.
	 *
	 * @return array{content:string,mime:string}|null
	 */
	public function cropImage(string $bytes, float $fx, float $fy, float $fw, float $fh): ?array {
		if (!function_exists('imagecreatefromstring')) {
			return null;
		}
		$im = @imagecreatefromstring($bytes);
		if ($im === false) {
			return null;
		}
		$w = imagesx($im);
		$h = imagesy($im);
		$x = max(0, min($w - 1, (int)round($fx * $w)));
		$y = max(0, min($h - 1, (int)round($fy * $h)));
		$cw = max(1, min($w - $x, (int)round($fw * $w)));
		$ch = max(1, min($h - $y, (int)round($fh * $h)));
		$out = imagecrop($im, ['x' => $x, 'y' => $y, 'width' => $cw, 'height' => $ch]);
		imagedestroy($im);
		if ($out === false) {
			return null;
		}
		if (function_exists('imagepalettetotruecolor')) {
			imagepalettetotruecolor($out);
		}
		imagealphablending($out, false);
		imagesavealpha($out, true);
		ob_start();
		if (function_exists('imagewebp')) {
			imagewebp($out, null, 85);
			$mime = 'image/webp';
		} else {
			imagejpeg($out, null, 88);
			$mime = 'image/jpeg';
		}
		$data = (string)ob_get_clean();
		imagedestroy($out);
		return $data !== '' ? ['content' => $data, 'mime' => $mime] : null;
	}

	private function isAnimatedGif(string $bytes): bool {
		// More than one Graphic Control Extension block => animated.
		return substr_count($bytes, "\x21\xF9\x04") > 1;
	}

	/**
	 * Read GPS coordinates embedded in an image's EXIF (JPEG/TIFF). Returns decimal
	 * lat/lng or null. Reads from a temp copy of the ORIGINAL bytes.
	 *
	 * @return array{lat:float,lng:float}|null
	 */
	/**
	 * Embed a GPS location into an image's bytes so the location travels WITH the file to
	 * other environments (owner wants portable geo; images only). Returns new bytes, or
	 * null when the format can't carry EXIF (gif/svg/avif/... or a malformed container) -
	 * the caller keeps the DB value in that case. Supports WebP (imports are WebP), JPEG,
	 * and PNG.
	 */
	public function embedGps(string $bytes, string $ext, float $lat, float $lng): ?string {
		if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
			return null;
		}
		$tiff = $this->buildGpsTiff($lat, $lng);
		$ext = strtolower($ext);
		if ($ext === 'webp') {
			return $this->injectWebpExif($bytes, $tiff);
		}
		if ($ext === 'jpg' || $ext === 'jpeg') {
			return $this->injectJpegExif($bytes, $tiff);
		}
		if ($ext === 'png') {
			return $this->injectPngExif($bytes, $tiff);
		}
		return null;
	}

	/** Build a minimal little-endian TIFF/EXIF blob carrying only a GPS IFD. */
	private function buildGpsTiff(float $lat, float $lng): string {
		$latRef = $lat >= 0 ? 'N' : 'S';
		$lngRef = $lng >= 0 ? 'E' : 'W';
		$dms = static function (float $v): array {
			$v = abs($v);
			$d = (int)floor($v);
			$m = (int)floor(($v - $d) * 60);
			$s = (($v - $d) * 60 - $m) * 60;
			return [[$d, 1], [$m, 1], [(int)round($s * 10000), 10000]];
		};
		$latD = $dms($lat);
		$lngD = $dms($lng);
		// Fixed layout (offsets from TIFF start): header 0..8, IFD0 8..26 (1 entry),
		// GPS IFD 26..92 (5 entries), lat data 92..116, lng data 116..140.
		$GPS_IFD = 26;
		$LAT_DATA = 92;
		$LNG_DATA = 116;
		$entry = static fn (int $tag, int $type, int $count, string $val4): string =>
			pack('v', $tag) . pack('v', $type) . pack('V', $count) . $val4;
		$out = 'II' . pack('v', 0x2A) . pack('V', 8);          // header -> IFD0 @8
		$out .= pack('v', 1);                                    // IFD0: 1 entry
		$out .= $entry(0x8825, 4, 1, pack('V', $GPS_IFD));       // GPSInfoIFDPointer
		$out .= pack('V', 0);                                    // next IFD = 0
		$out .= pack('v', 5);                                    // GPS IFD: 5 entries
		$out .= $entry(0x0000, 1, 4, pack('C4', 2, 2, 0, 0));    // GPSVersionID 2.2.0.0
		$out .= $entry(0x0001, 2, 2, $latRef . "\0\0\0");        // GPSLatitudeRef
		$out .= $entry(0x0002, 5, 3, pack('V', $LAT_DATA));      // GPSLatitude
		$out .= $entry(0x0003, 2, 2, $lngRef . "\0\0\0");        // GPSLongitudeRef
		$out .= $entry(0x0004, 5, 3, pack('V', $LNG_DATA));      // GPSLongitude
		$out .= pack('V', 0);                                    // next IFD = 0
		foreach ($latD as [$n, $d]) {
			$out .= pack('V', $n) . pack('V', $d);
		}
		foreach ($lngD as [$n, $d]) {
			$out .= pack('V', $n) . pack('V', $d);
		}
		return $out;
	}

	/** Insert/replace the EXIF chunk in a WebP RIFF container (wrapping to VP8X if needed). */
	private function injectWebpExif(string $data, string $tiff): ?string {
		if (strlen($data) < 12 || substr($data, 0, 4) !== 'RIFF' || substr($data, 8, 4) !== 'WEBP') {
			return null;
		}
		$chunks = [];
		$p = 12;
		$len = strlen($data);
		while ($p + 8 <= $len) {
			$cc = substr($data, $p, 4);
			$sz = unpack('V', substr($data, $p + 4, 4))[1];
			if ($p + 8 + $sz > $len) {
				break;
			}
			$chunks[] = ['cc' => $cc, 'data' => substr($data, $p + 8, $sz)];
			$p += 8 + $sz + ($sz % 2);
		}
		if (!$chunks) {
			return null;
		}
		$chunks = array_values(array_filter($chunks, static fn ($c) => $c['cc'] !== 'EXIF'));
		if ($chunks[0]['cc'] === 'VP8X') {
			$vp = $chunks[0]['data'];
			$chunks[0]['data'] = chr(ord($vp[0]) | 0x08) . substr($vp, 1);
		} else {
			$info = @getimagesizefromstring($data);
			if (!is_array($info) || (int)$info[0] < 1 || (int)$info[1] < 1) {
				return null;
			}
			$wm1 = (int)$info[0] - 1;
			$hm1 = (int)$info[1] - 1;
			$vp8x = chr(0x08) . "\0\0\0"
				. chr($wm1 & 0xFF) . chr(($wm1 >> 8) & 0xFF) . chr(($wm1 >> 16) & 0xFF)
				. chr($hm1 & 0xFF) . chr(($hm1 >> 8) & 0xFF) . chr(($hm1 >> 16) & 0xFF);
			array_unshift($chunks, ['cc' => 'VP8X', 'data' => $vp8x]);
		}
		$chunks[] = ['cc' => 'EXIF', 'data' => $tiff];
		$body = '';
		foreach ($chunks as $c) {
			$sz = strlen($c['data']);
			$body .= $c['cc'] . pack('V', $sz) . $c['data'];
			if ($sz % 2) {
				$body .= "\0";
			}
		}
		return 'RIFF' . pack('V', 4 + strlen($body)) . 'WEBP' . $body;
	}

	/** Insert an APP1 EXIF segment right after the JPEG SOI marker. */
	private function injectJpegExif(string $data, string $tiff): ?string {
		if (substr($data, 0, 2) !== "\xFF\xD8") {
			return null;
		}
		$exif = "Exif\0\0" . $tiff;
		if (strlen($exif) + 2 > 0xFFFF) {
			return null;
		}
		$seg = "\xFF\xE1" . pack('n', strlen($exif) + 2) . $exif;
		return substr($data, 0, 2) . $seg . substr($data, 2);
	}

	/** Insert a PNG eXIf chunk before IEND. */
	private function injectPngExif(string $data, string $tiff): ?string {
		if (substr($data, 0, 8) !== "\x89PNG\r\n\x1a\n") {
			return null;
		}
		$pos = strpos($data, "\x00\x00\x00\x00IEND");
		if ($pos === false) {
			return null;
		}
		$chunk = pack('N', strlen($tiff)) . 'eXIf' . $tiff . pack('N', crc32('eXIf' . $tiff));
		return substr($data, 0, $pos) . $chunk . substr($data, $pos);
	}

	public function extractImageGps(string $bytes): ?array {
		if (function_exists('exif_read_data')) {
			$tmp = tempnam(sys_get_temp_dir(), 'rbexif');
			if ($tmp !== false) {
				try {
					file_put_contents($tmp, $bytes);
					$exif = @exif_read_data($tmp, 'GPS', true);
					if (is_array($exif) && !empty($exif['GPS'])) {
						$g = $exif['GPS'];
						$lat = $this->gpsToDecimal($g['GPSLatitude'] ?? null, (string)($g['GPSLatitudeRef'] ?? 'N'));
						$lng = $this->gpsToDecimal($g['GPSLongitude'] ?? null, (string)($g['GPSLongitudeRef'] ?? 'E'));
						$ok = $lat !== null && $lng !== null && $lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180 && !($lat === 0.0 && $lng === 0.0);
						if ($ok) {
							return ['lat' => $lat, 'lng' => $lng];
						}
					}
				} catch (\Throwable $e) {
					// fall through to the container parser
				} finally {
					@unlink($tmp);
				}
			}
		}
		// PHP's exif_read_data reads JPEG but not WebP/PNG EXIF - parse the EXIF chunk
		// ourselves for those (so geo we write into WebP, or an external WebP with GPS, reads back).
		$tiff = $this->extractExifTiff($bytes);
		return $tiff !== null ? $this->parseGpsFromTiff($tiff) : null;
	}

	/** Pull the raw EXIF/TIFF payload out of a WebP (EXIF chunk) or PNG (eXIf chunk). */
	private function extractExifTiff(string $bytes): ?string {
		if (strlen($bytes) >= 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') {
			$p = 12;
			$len = strlen($bytes);
			while ($p + 8 <= $len) {
				$cc = substr($bytes, $p, 4);
				$sz = unpack('V', substr($bytes, $p + 4, 4))[1];
				if ($p + 8 + $sz > $len) {
					break;
				}
				if ($cc === 'EXIF') {
					$t = substr($bytes, $p + 8, $sz);
					// Some encoders prefix "Exif\0\0"; strip it if present.
					return str_starts_with($t, "Exif\0\0") ? substr($t, 6) : $t;
				}
				$p += 8 + $sz + ($sz % 2);
			}
			return null;
		}
		if (substr($bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
			$p = 8;
			$len = strlen($bytes);
			while ($p + 8 <= $len) {
				$sz = unpack('N', substr($bytes, $p, 4))[1];
				$type = substr($bytes, $p + 4, 4);
				if ($type === 'eXIf') {
					return substr($bytes, $p + 8, $sz);
				}
				if ($type === 'IEND') {
					break;
				}
				$p += 12 + $sz; // len(4)+type(4)+data+crc(4)
			}
		}
		return null;
	}

	/** Decode lat/lng from a raw TIFF/EXIF blob's GPS IFD (little- or big-endian). */
	private function parseGpsFromTiff(string $t): ?array {
		if (strlen($t) < 8) {
			return null;
		}
		$le = substr($t, 0, 2) === 'II';
		$u16 = static fn (int $o) => $le ? unpack('v', substr($t, $o, 2))[1] : unpack('n', substr($t, $o, 2))[1];
		$u32 = static fn (int $o) => $le ? unpack('V', substr($t, $o, 4))[1] : unpack('N', substr($t, $o, 4))[1];
		try {
			$ifd0 = $u32(4);
			$n = $u16($ifd0);
			$gps = null;
			for ($i = 0; $i < $n; $i++) {
				$e = $ifd0 + 2 + $i * 12;
				if ($u16($e) === 0x8825) {
					$gps = $u32($e + 8);
				}
			}
			if ($gps === null) {
				return null;
			}
			$dms = static function (int $off) use ($t, $u32): float {
				$v = 0.0;
				for ($k = 0; $k < 3; $k++) {
					$num = $u32($off + $k * 8);
					$den = $u32($off + $k * 8 + 4);
					$v += ($den ? $num / $den : 0) / ($k === 0 ? 1 : ($k === 1 ? 60 : 3600));
				}
				return $v;
			};
			$ng = $u16($gps);
			$latRef = 'N';
			$lngRef = 'E';
			$lat = null;
			$lng = null;
			for ($i = 0; $i < $ng; $i++) {
				$e = $gps + 2 + $i * 12;
				$tag = $u16($e);
				if ($tag === 1) {
					$latRef = substr($t, $e + 8, 1);
				} elseif ($tag === 2) {
					$lat = $dms($u32($e + 8));
				} elseif ($tag === 3) {
					$lngRef = substr($t, $e + 8, 1);
				} elseif ($tag === 4) {
					$lng = $dms($u32($e + 8));
				}
			}
			if ($lat === null || $lng === null) {
				return null;
			}
			if (strtoupper($latRef) === 'S') {
				$lat = -$lat;
			}
			if (strtoupper($lngRef) === 'W') {
				$lng = -$lng;
			}
			if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180 || ($lat === 0.0 && $lng === 0.0)) {
				return null;
			}
			return ['lat' => $lat, 'lng' => $lng];
		} catch (\Throwable $e) {
			return null;
		}
	}

	private function gpsToDecimal($coord, string $ref): ?float {
		if (!is_array($coord) || count($coord) < 3) {
			return null;
		}
		$d = $this->rational($coord[0]);
		$m = $this->rational($coord[1]);
		$s = $this->rational($coord[2]);
		if ($d === null) {
			return null;
		}
		$dec = $d + ($m ?? 0) / 60 + ($s ?? 0) / 3600;
		if (in_array(strtoupper(trim($ref)), ['S', 'W'], true)) {
			$dec = -$dec;
		}
		return $dec;
	}

	private function rational($v): ?float {
		if (is_string($v) && str_contains($v, '/')) {
			[$n, $den] = explode('/', $v, 2);
			$den = (float)$den;
			return $den != 0.0 ? (float)$n / $den : null;
		}
		return is_numeric($v) ? (float)$v : null;
	}

	/**
	 * Read a GPS location atom from a video via ffprobe (phone MP4/MOV). Runs only
	 * against the local temp file, never a URL. Null when ffprobe/shell is absent.
	 *
	 * @return array{lat:float,lng:float}|null
	 */
	public function extractVideoGps(string $bytes): ?array {
		if (!function_exists('shell_exec')) {
			return null;
		}
		$ffprobe = $this->ffprobePath();
		if ($ffprobe === null) {
			return null;
		}
		$tmp = tempnam(sys_get_temp_dir(), 'rbvid');
		if ($tmp === false) {
			return null;
		}
		try {
			file_put_contents($tmp, $bytes);
			$cmd = escapeshellarg($ffprobe) . ' -v quiet -print_format json -show_entries format_tags ' . escapeshellarg($tmp) . ' 2>/dev/null';
			$json = @shell_exec($cmd);
			if (!is_string($json) || $json === '') {
				return null;
			}
			$d = json_decode($json, true);
			$tags = $d['format']['tags'] ?? [];
			if (!is_array($tags)) {
				return null;
			}
			$loc = $tags['location'] ?? $tags['com.apple.quicktime.location.ISO6709'] ?? $tags['location-eng'] ?? null;
			return is_string($loc) && $loc !== '' ? $this->parseIso6709($loc) : null;
		} catch (\Throwable $e) {
			return null;
		} finally {
			@unlink($tmp);
		}
	}

	private function ffprobePath(): ?string {
		foreach (['/usr/bin/ffprobe', '/usr/local/bin/ffprobe'] as $p) {
			if (@is_executable($p)) {
				return $p;
			}
		}
		$w = function_exists('shell_exec') ? @shell_exec('command -v ffprobe 2>/dev/null') : '';
		$w = is_string($w) ? trim($w) : '';
		return $w !== '' ? $w : null;
	}

	/** @return array{lat:float,lng:float}|null */
	private function parseIso6709(string $s): ?array {
		if (preg_match('/([+\-]\d+(?:\.\d+)?)([+\-]\d+(?:\.\d+)?)/', $s, $m)) {
			$lat = (float)$m[1];
			$lng = (float)$m[2];
			if ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180) {
				return ['lat' => $lat, 'lng' => $lng];
			}
		}
		return null;
	}

	/**
	 * Extract a geolocation from a web page's meta tags / JSON-LD.
	 *
	 * @return array{lat:float,lng:float,place:?string}|null
	 */
	public function parsePageGeo(string $html): ?array {
		try {
			$doc = new \DOMDocument();
			libxml_use_internal_errors(true);
			$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
			libxml_clear_errors();
			$xp = new \DOMXPath($doc);
			$low = "translate(@%s,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
			$meta = function (string $sel) use ($xp): ?string {
				$n = $xp->query($sel);
				return ($n !== false && $n->length) ? trim((string)$n->item(0)->nodeValue) : null;
			};
			$lat = $meta('//meta[' . sprintf($low, 'property') . "='og:latitude']/@content");
			$lng = $meta('//meta[' . sprintf($low, 'property') . "='og:longitude']/@content");
			$place = $meta('//meta[' . sprintf($low, 'name') . "='geo.placename']/@content");
			if ($lat === null || $lng === null) {
				$pos = $meta('//meta[' . sprintf($low, 'name') . "='geo.position']/@content")
					?? $meta('//meta[' . sprintf($low, 'name') . "='icbm']/@content");
				if ($pos !== null && preg_match('/(-?\d+(?:\.\d+)?)[;, ]+(-?\d+(?:\.\d+)?)/', $pos, $m)) {
					$lat = $m[1];
					$lng = $m[2];
				}
			}
			if ($lat === null || $lng === null) {
				$scripts = $xp->query("//script[" . sprintf($low, 'type') . "='application/ld+json']");
				if ($scripts !== false) {
					foreach ($scripts as $s) {
						$j = json_decode(trim((string)$s->nodeValue), true);
						$found = $this->findGeoInJsonLd($j);
						if ($found !== null) {
							$lat = $found['lat'];
							$lng = $found['lng'];
							if ($place === null && !empty($found['place'])) {
								$place = (string)$found['place'];
							}
							break;
						}
					}
				}
			}
			if ($lat === null || $lng === null || !is_numeric($lat) || !is_numeric($lng)) {
				return null;
			}
			$latf = (float)$lat;
			$lngf = (float)$lng;
			if ($latf < -90 || $latf > 90 || $lngf < -180 || $lngf > 180) {
				return null;
			}
			return ['lat' => $latf, 'lng' => $lngf, 'place' => $place];
		} catch (\Throwable $e) {
			return null;
		}
	}

	private function findGeoInJsonLd($node): ?array {
		if (!is_array($node)) {
			return null;
		}
		if (isset($node['latitude'], $node['longitude']) && is_numeric($node['latitude'])) {
			return ['lat' => (float)$node['latitude'], 'lng' => (float)$node['longitude'], 'place' => $node['name'] ?? null];
		}
		if (isset($node['geo']) && is_array($node['geo']) && isset($node['geo']['latitude'])) {
			return ['lat' => (float)$node['geo']['latitude'], 'lng' => (float)$node['geo']['longitude'], 'place' => $node['name'] ?? null];
		}
		foreach ($node as $v) {
			if (is_array($v)) {
				$f = $this->findGeoInJsonLd($v);
				if ($f !== null) {
					return $f;
				}
			}
		}
		return null;
	}

	/**
	 * Geocode a free-text place to coordinates via OpenStreetMap Nominatim (a
	 * suggestion the user confirms). Attribution: © OpenStreetMap contributors.
	 *
	 * @return array{lat:float,lng:float,place:string}|null
	 */
	public function geocode(string $query, ?string $lang = null): ?array {
		$results = $this->geocodeSearch($query, $lang, 1);
		return $results[0] ?? null;
	}

	/**
	 * Geocode free text to up to $limit suggestions (OpenStreetMap Nominatim).
	 * $lang (an NC locale like "fr" or "en_GB") is sent as Accept-Language so the
	 * returned place names are in the user's UI language. Respect Nominatim's usage
	 * policy: <=1 req/s and a descriptive User-Agent (set in clientOptions).
	 *
	 * @return array<int,array{lat:float,lng:float,place:string}>
	 */
	public function geocodeSearch(string $query, ?string $lang = null, int $limit = 5): array {
		$q = trim($query);
		if ($q === '') {
			return [];
		}
		$limit = max(1, min(10, $limit));
		try {
			$url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' . $limit . '&q=' . rawurlencode($q);
			$opts = $this->clientOptions(12);
			$accept = $this->localeToAcceptLanguage($lang);
			if ($accept !== null) {
				$opts['headers']['Accept-Language'] = $accept;
			}
			$resp = $this->clientService->newClient()->get($url, $opts);
			if ($resp->getStatusCode() >= 400) {
				return [];
			}
			$data = json_decode((string)$resp->getBody(), true);
			if (!is_array($data)) {
				return [];
			}
			$out = [];
			foreach ($data as $row) {
				if (!is_array($row) || !isset($row['lat'], $row['lon'])) {
					continue;
				}
				$out[] = [
					'lat' => (float)$row['lat'],
					'lng' => (float)$row['lon'],
					'place' => (string)($row['display_name'] ?? $q),
					// Extra fields used by detectLocation() to keep only real places.
					'category' => (string)($row['category'] ?? $row['class'] ?? ''),
					'type' => (string)($row['type'] ?? ''),
					'addresstype' => (string)($row['addresstype'] ?? ''),
					'importance' => (float)($row['importance'] ?? 0),
					// Identity of the resolved OSM object, so different candidate strings that
					// resolve to the SAME place (e.g. "Texas" and "Texas, USA") can be deduped.
					'ref' => (string)($row['osm_type'] ?? '') . (string)($row['osm_id'] ?? ($row['place_id'] ?? '')),
				];
			}
			return $out;
		} catch (\Throwable $e) {
			$this->logger->debug('Curio geocode failed: ' . $e->getMessage());
			return [];
		}
	}

	/** Normalise an NC locale ("fr", "en_GB", "pt_BR") to an Accept-Language value. */
	private function localeToAcceptLanguage(?string $lang): ?string {
		$lang = trim((string)$lang);
		if ($lang === '') {
			return null;
		}
		// Keep only sane locale characters, convert NC's underscore to a hyphen.
		if (!preg_match('/^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$/', $lang)) {
			return null;
		}
		return str_replace('_', '-', $lang);
	}

	/**
	 * Per-language extraction hints for location detection (Latin-script). Geocoding itself
	 * (Nominatim) is already language/script-agnostic; only the EXTRACTION of the candidate
	 * string from caption text is language-specific, so each language contributes three
	 * lists: `cues` (locative prepositions that precede a place), `labels` (explicit
	 * "where" field labels), and `stop` (filler / sentence-openers / months / days that are
	 * NOT places and must not consume the small geocode budget). English is ALWAYS merged in
	 * as a base (captions routinely mix English), plus the user's UI language when known.
	 * Missing entries only cost efficiency, never the ability to find a place, so partial
	 * coverage degrades gracefully.
	 */
	private const LANG_HINTS = [
		'en' => [
			'cues' => ['in', 'at', 'near', 'from', 'around', 'throughout', 'through', 'across', 'along', 'of', 'visiting', 'exploring', 'explored', 'toured', 'touring'],
			'labels' => ['location', 'venue', 'address', 'place', 'where'],
			'stop' => 'a an the this that these those our my your his her their its we i you they he she it '
				. 'and but or so yet for nor as if when what why how who where which while '
				. 'sunset sunrise morning afternoon evening night day today tonight tomorrow yesterday weekend '
				. 'monday tuesday wednesday thursday friday saturday sunday '
				. 'january february march april may june july august september october november december '
				. 'beautiful gorgeous stunning amazing incredible lovely happy good great best new latest first last late early once '
				. 'exploring explored exploration loving love loved finally just here there behind before after during '
				. 'meet meeting introducing presenting check swipe link photo photos video videos reel reels story stories '
				. 'shot shots capture captured golden silver quiet calm peaceful busy sunny rainy '
				. 'welcome thanks thank thankful grateful proud excited super very really always never every '
				. 'work working process progress details detail moment moments memories memory vibes mood '
				. 'summer winter spring autumn fall season holiday holidays vacation trip travel travels journey '
				. 'location venue address place where date time note info infos comment free hybrid contact email tel gmt '
				// Building materials / construction terms that are NOT places ("earth" = soil, not a place).
				. 'earth soil clay mud ground raw rammed cob wattle daub pise adobe stone wood timber concrete metal brick bricks wall walls facade material materials structure '
				// Roles / professions (never a place).
				. 'architect designer engineer sculptor artist photographer founder cofounder director curator author '
				. 'delivery renovation company companies workshop workshops project projects opening exhibition',
		],
		'fr' => [
			'cues' => ['à', 'au', 'aux', 'chez', 'vers', 'dans'],
			'labels' => ['lieu', 'lieux', 'adresse', 'localisation', 'où'],
			'stop' => 'le la les un une des du au aux ce cet cette ces notre votre nos vos leur leurs avec sans pour dans plus très bien '
				. 'présent present demain hier soir matin journée journee semaine weekend aujourd '
				. 'lundi mardi mercredi jeudi vendredi samedi dimanche '
				. 'janvier février fevrier mars avril mai juin juillet août aout septembre octobre novembre décembre decembre '
				. 'formation session projet programme informations pratiques inscription tarif dates publics partenaires '
				. 'horaire heure prix beau belle magnifique nouveau nouvelle bienvenue '
				. 'terre sol argile boue brut brute pierre bois béton beton mur murs façade facade matériau materiau structure '
				. 'architecte concepteur ingénieur ingenieur sculpteur artiste photographe fondateur '
				. 'livraison rénovation renovation entreprise entreprises maîtrise maitrise ouvrage atelier ateliers chantier contributions exposition',
		],
		'es' => [
			'cues' => ['en', 'a', 'desde', 'hacia', 'por', 'cerca de', 'junto a'],
			'labels' => ['lugar', 'ubicación', 'ubicacion', 'dirección', 'direccion', 'dónde', 'donde', 'sede'],
			'stop' => 'el la los las un una unos unas de del y o pero con sin para por muy más mas nuestro nuestra vuestro este esta estos estas '
				. 'hoy mañana manana ayer noche tarde dia día semana '
				. 'lunes martes miércoles miercoles jueves viernes sábado sabado domingo '
				. 'enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre '
				. 'hermoso hermosa bonito bonita nuevo nueva bienvenido gracias taller evento fecha hora precio '
				. 'tierra suelo barro cruda crudo adobe tapia pisada muro muros pared paredes fachada altura espesor '
				. 'sistema metros piedra madera hormigón hormigon ladrillo ladrillos material estructura construida construido '
				. 'arquitecto arquitecta diseñador disenador diseñadora ingeniero escultor artista fotógrafo fotografo fundador',
		],
		'de' => [
			'cues' => ['in', 'im', 'bei', 'beim', 'nach', 'an', 'am', 'zu', 'zum', 'zur', 'aus', 'auf'],
			'labels' => ['ort', 'adresse', 'veranstaltungsort', 'standort', 'treffpunkt', 'wo'],
			'stop' => 'der die das den dem des ein eine einen einem und oder aber mit ohne für fur sehr mehr unser euer dieser diese dieses '
				. 'heute morgen gestern abend nacht tag woche wochenende '
				. 'montag dienstag mittwoch donnerstag freitag samstag sonntag '
				. 'januar februar märz maerz april mai juni juli august september oktober november dezember '
				. 'schön schoen neu neue willkommen danke termin uhrzeit ort preis veranstaltung '
				. 'erde boden lehm roh stein holz beton wand wände waende fassade material struktur',
		],
		'it' => [
			'cues' => ['a', 'in', 'da', 'presso', 'verso', 'vicino a'],
			'labels' => ['luogo', 'indirizzo', 'dove', 'sede', 'posizione'],
			'stop' => 'il lo la i gli le un uno una di del della e o ma con senza per molto più piu nostro vostro questo questa questi queste '
				. 'oggi domani ieri sera notte giorno settimana '
				. 'lunedì lunedi martedì martedi mercoledì mercoledi giovedì giovedi venerdì venerdi sabato domenica '
				. 'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre '
				. 'bello bella nuovo nuova benvenuto grazie evento data ora prezzo '
				. 'terra suolo argilla crudo grezzo pietra legno muro muri parete pareti facciata materiale struttura',
		],
		'pt' => [
			'cues' => ['em', 'no', 'na', 'nos', 'nas', 'para', 'perto de', 'junto a'],
			'labels' => ['local', 'localização', 'localizacao', 'endereço', 'endereco', 'onde'],
			'stop' => 'o a os as um uma uns umas de do da dos das e ou mas com sem para por muito mais nosso vosso este esta estes estas '
				. 'hoje amanhã amanha ontem noite tarde dia semana fim '
				. 'segunda terça terca quarta quinta sexta sábado sabado domingo '
				. 'janeiro fevereiro março marco abril maio junho julho agosto setembro outubro novembro dezembro '
				. 'belo bela novo nova bem-vindo obrigado evento data hora preço preco '
				. 'terra solo barro cru crua adobe taipa parede paredes fachada material estrutura pedra madeira',
		],
		'nl' => [
			'cues' => ['in', 'bij', 'naar', 'op', 'te', 'aan'],
			'labels' => ['locatie', 'adres', 'plaats', 'waar'],
			'stop' => 'de het een en of maar met zonder voor door zeer meer onze jullie deze dit die dat '
				. 'vandaag morgen gisteren avond nacht dag week weekend '
				. 'maandag dinsdag woensdag donderdag vrijdag zaterdag zondag '
				. 'januari februari maart april mei juni juli augustus september oktober november december '
				. 'mooi nieuw welkom bedankt evenement datum tijd prijs '
				. 'aarde grond klei ruw steen hout beton muur muren gevel materiaal structuur',
		],
	];

	/**
	 * Words that are NEVER a place, applied in EVERY language regardless of the UI locale.
	 * Captions are frequently written in a language other than the user's Nextcloud locale
	 * (a French user saving a Spanish or German post), so the material / technique / role /
	 * generic-filler vocabulary must be suppressed unconditionally - otherwise "TIERRA CRUDA"
	 * or "Tapia Pisada" geocodes to a stray hamlet. Building materials and construction
	 * techniques are soil or fabric, not locations; roles (architect/photographer) name a
	 * person; the generic-filler set are the sentence words a caption scan wrongly capitalises.
	 */
	private const UNIVERSAL_STOP =
		// Soil / earth / building materials (all languages) - "earth" is soil, never a place.
		'earth soil clay mud ground raw rammed cob wattle daub pise pise adobe tapia pisada '
		. 'terra tierra terre erde aarde argila argilla arcilla lehm boden barro cruda crudo grezzo grezza cocido '
		. 'loam straw hemp lime plaster render mortar rebar steel iron stone wood timber concrete beton '
		. 'metal muntz brass bronze copper zinc brick bricks masonry marmorino stucco lucida terracotta '
		. 'ceramic ceramics glass gypsum bamboo rattan cork resin '
		// Architecture / construction nouns (multi-language) - describe the object, not where it is.
		. 'facade fachada facciata fassade gevel wall walls muro muros muri mur murs wand wande pared paredes '
		. 'parete pareti structure estructura estrutura struttura struktur altura espesor thickness height width '
		. 'depth column columns colonne pillar pavilion pavilions pabellon padiglione '
		. 'garden jardin giardino jardim chapel capilla chapelle cappella corazon '
		. 'annex veranda roof floor floors basement ceiling interior exterior facade envelope enclosure '
		. 'building buildings house casa maison haus edificio complex extension renovation refurbishment prototype prototypes '
		// Roles / professions - a person, never a place.
		. 'architect architects arquitecto arquitecta arquitectos architekt architekten architecte architetto '
		. 'designer designers disenador diseno engineer engineers ingeniero ingegnere sculptor escultor '
		. 'artist artista photographer photography fotografo photographe fotografia founder cofounder founders fundador '
		. 'director curator author technologist enthusiast laureate client contractor builder studio studios office '
		. 'atelier ateliers workshop workshops firm agency developed developer developers '
		// Generic filler / social-caption words that a capitalisation scan wrongly promotes.
		. 'both light street pointing simple static collaboration thinking sketch massing visuals visual '
		. 'animation image images output outputs workflow computation intuition design code between hybrid '
		. 'question session panel panels detail details idea ideas process approach approaches note register '
		. 'access laptop upcoming launch launching series edition talk talks lecture tour visit inside overview '
		. 'feature featured story content post comment comments swipe follow link bio spatial systems system '
		. 'fabrication robotic vegetation condition support enclosure form forms forma plant life work project projects '
		. 'oracles park through developed construida construido belga '
		. 'congress academy international art centre exhibition exhibit biennale landscape piece show '
		. 'revisited breaking installed held called latest recently amazing curated pavilion '
		// Institution / building-type nouns (a Palace of Justice is a building, not a place).
		. 'palace justice court courthouse hall tribunal town city municipality '
		// Social praise / call-to-action filler common in feature-account captions.
		. 'congratulations congrats shots shot day mighty fantastic spectacular brutal chance tag '
		. 'built designed follow featured founder use having these those spectacular '
		. 'cement over garden greenhouse staircase step steps hilltop mountain mountains region '
		. 'earthquake epicenter debris landfill extraction remnants meaning testament mastery';

	/**
	 * Country names (any common language / exonym, accent-folded) -> canonical English name.
	 * A country named in a caption both disambiguates a city ("Verona" + "Italy") and is itself
	 * a valid coarse suggestion. Keys are stored lowercase and ASCII (see normalizeForMatch).
	 */
	private const GAZ_COUNTRIES = [
		'italy' => 'Italy', 'italia' => 'Italy', 'italie' => 'Italy', 'germania' => 'Italy',
		'germany' => 'Germany', 'deutschland' => 'Germany', 'allemagne' => 'Germany', 'alemania' => 'Germany',
		'france' => 'France', 'francia' => 'France', 'frankreich' => 'France',
		'spain' => 'Spain', 'espana' => 'Spain', 'espagne' => 'Spain', 'spagna' => 'Spain', 'spanien' => 'Spain',
		'portugal' => 'Portugal',
		'belgium' => 'Belgium', 'belgique' => 'Belgium', 'belgie' => 'Belgium', 'belgica' => 'Belgium', 'belgien' => 'Belgium',
		'netherlands' => 'Netherlands', 'nederland' => 'Netherlands', 'holland' => 'Netherlands',
		'switzerland' => 'Switzerland', 'suisse' => 'Switzerland', 'schweiz' => 'Switzerland', 'svizzera' => 'Switzerland', 'suiza' => 'Switzerland',
		'austria' => 'Austria', 'osterreich' => 'Austria', 'autriche' => 'Austria',
		'united kingdom' => 'United Kingdom', 'great britain' => 'United Kingdom', 'england' => 'United Kingdom', 'angleterre' => 'United Kingdom', 'inglaterra' => 'United Kingdom', 'scotland' => 'United Kingdom',
		'ireland' => 'Ireland', 'irlande' => 'Ireland',
		'denmark' => 'Denmark', 'danmark' => 'Denmark', 'sweden' => 'Sweden', 'sverige' => 'Sweden',
		'norway' => 'Norway', 'norge' => 'Norway', 'finland' => 'Finland', 'suomi' => 'Finland',
		'iceland' => 'Iceland', 'greece' => 'Greece', 'grece' => 'Greece', 'grecia' => 'Greece',
		'poland' => 'Poland', 'polska' => 'Poland', 'czechia' => 'Czechia', 'czech republic' => 'Czechia',
		'hungary' => 'Hungary', 'romania' => 'Romania', 'bulgaria' => 'Bulgaria',
		'croatia' => 'Croatia', 'hrvatska' => 'Croatia', 'slovenia' => 'Slovenia', 'slovenija' => 'Slovenia', 'slovenie' => 'Slovenia',
		'slovakia' => 'Slovakia', 'serbia' => 'Serbia', 'estonia' => 'Estonia', 'latvia' => 'Latvia', 'lithuania' => 'Lithuania',
		'turkey' => 'Turkey', 'turkiye' => 'Turkey', 'turquie' => 'Turkey', 'turquia' => 'Turkey',
		'russia' => 'Russia', 'ukraine' => 'Ukraine',
		'morocco' => 'Morocco', 'maroc' => 'Morocco', 'marruecos' => 'Morocco',
		'egypt' => 'Egypt', 'tunisia' => 'Tunisia', 'algeria' => 'Algeria', 'israel' => 'Israel', 'lebanon' => 'Lebanon',
		'qatar' => 'Qatar', 'saudi arabia' => 'Saudi Arabia', 'iran' => 'Iran',
		'japan' => 'Japan', 'japon' => 'Japan', 'china' => 'China', 'chine' => 'China',
		'south korea' => 'South Korea', 'korea' => 'South Korea', 'india' => 'India', 'inde' => 'India',
		'indonesia' => 'Indonesia', 'thailand' => 'Thailand', 'vietnam' => 'Vietnam', 'malaysia' => 'Malaysia', 'philippines' => 'Philippines',
		'australia' => 'Australia', 'new zealand' => 'New Zealand',
		'canada' => 'Canada', 'mexico' => 'Mexico', 'mexique' => 'Mexico',
		'brazil' => 'Brazil', 'brasil' => 'Brazil', 'bresil' => 'Brazil', 'argentina' => 'Argentina', 'argentine' => 'Argentina',
		'chile' => 'Chile', 'chili' => 'Chile', 'peru' => 'Peru', 'perou' => 'Peru',
		'colombia' => 'Colombia', 'colombie' => 'Colombia', 'uruguay' => 'Uruguay', 'ecuador' => 'Ecuador', 'venezuela' => 'Venezuela',
		'united states' => 'United States', 'usa' => 'United States', 'etats unis' => 'United States', 'estados unidos' => 'United States',
		'south africa' => 'South Africa', 'nigeria' => 'Nigeria', 'kenya' => 'Kenya', 'ghana' => 'Ghana',
		'united arab emirates' => 'United Arab Emirates', 'uae' => 'United Arab Emirates',
	];

	/**
	 * Major / architecture-relevant cities (accent-folded key, 1-3 words) -> [canonical, country].
	 * A hit is geocoded as "City, Country" so Nominatim returns the well-known place rather than an
	 * obscure US namesake (the "Brussels -> Illinois" miss). Deliberately omits city names that are
	 * common English words (Nice, Bath, Split, Reading, Mobile) to avoid false positives.
	 */
	private const GAZ_CITIES = [
		'brussels' => ['Brussels', 'Belgium'], 'bruxelles' => ['Brussels', 'Belgium'],
		'antwerp' => ['Antwerp', 'Belgium'], 'anvers' => ['Antwerp', 'Belgium'], 'antwerpen' => ['Antwerp', 'Belgium'],
		'ghent' => ['Ghent', 'Belgium'], 'gent' => ['Ghent', 'Belgium'], 'bruges' => ['Bruges', 'Belgium'], 'brugge' => ['Bruges', 'Belgium'], 'leuven' => ['Leuven', 'Belgium'], 'liege' => ['Liege', 'Belgium'],
		'rome' => ['Rome', 'Italy'], 'roma' => ['Rome', 'Italy'], 'milan' => ['Milan', 'Italy'], 'milano' => ['Milan', 'Italy'],
		'venice' => ['Venice', 'Italy'], 'venezia' => ['Venice', 'Italy'], 'florence' => ['Florence', 'Italy'], 'firenze' => ['Florence', 'Italy'],
		'turin' => ['Turin', 'Italy'], 'torino' => ['Turin', 'Italy'], 'naples' => ['Naples', 'Italy'], 'napoli' => ['Naples', 'Italy'],
		'verona' => ['Verona', 'Italy'], 'bologna' => ['Bologna', 'Italy'], 'genoa' => ['Genoa', 'Italy'], 'genova' => ['Genoa', 'Italy'],
		'palermo' => ['Palermo', 'Italy'], 'ravenna' => ['Ravenna', 'Italy'], 'padua' => ['Padua', 'Italy'], 'padova' => ['Padua', 'Italy'], 'vicenza' => ['Vicenza', 'Italy'],
		'berlin' => ['Berlin', 'Germany'], 'munich' => ['Munich', 'Germany'], 'munchen' => ['Munich', 'Germany'], 'hamburg' => ['Hamburg', 'Germany'],
		'cologne' => ['Cologne', 'Germany'], 'koln' => ['Cologne', 'Germany'], 'frankfurt' => ['Frankfurt', 'Germany'], 'stuttgart' => ['Stuttgart', 'Germany'],
		'dusseldorf' => ['Dusseldorf', 'Germany'], 'dresden' => ['Dresden', 'Germany'], 'leipzig' => ['Leipzig', 'Germany'], 'augsburg' => ['Augsburg', 'Germany'],
		'nuremberg' => ['Nuremberg', 'Germany'], 'nurnberg' => ['Nuremberg', 'Germany'], 'bremen' => ['Bremen', 'Germany'], 'hannover' => ['Hannover', 'Germany'],
		'paris' => ['Paris', 'France'], 'lyon' => ['Lyon', 'France'], 'marseille' => ['Marseille', 'France'], 'bordeaux' => ['Bordeaux', 'France'],
		'toulouse' => ['Toulouse', 'France'], 'nantes' => ['Nantes', 'France'], 'lille' => ['Lille', 'France'], 'strasbourg' => ['Strasbourg', 'France'],
		'grenoble' => ['Grenoble', 'France'], 'montpellier' => ['Montpellier', 'France'], 'rennes' => ['Rennes', 'France'],
		'madrid' => ['Madrid', 'Spain'], 'barcelona' => ['Barcelona', 'Spain'], 'valencia' => ['Valencia', 'Spain'], 'seville' => ['Seville', 'Spain'], 'sevilla' => ['Seville', 'Spain'],
		'bilbao' => ['Bilbao', 'Spain'], 'malaga' => ['Malaga', 'Spain'], 'granada' => ['Granada', 'Spain'], 'zaragoza' => ['Zaragoza', 'Spain'], 'san sebastian' => ['San Sebastian', 'Spain'],
		'lisbon' => ['Lisbon', 'Portugal'], 'lisboa' => ['Lisbon', 'Portugal'], 'porto' => ['Porto', 'Portugal'], 'coimbra' => ['Coimbra', 'Portugal'], 'braga' => ['Braga', 'Portugal'],
		'london' => ['London', 'United Kingdom'], 'manchester' => ['Manchester', 'United Kingdom'], 'birmingham' => ['Birmingham', 'United Kingdom'],
		'glasgow' => ['Glasgow', 'United Kingdom'], 'edinburgh' => ['Edinburgh', 'United Kingdom'], 'liverpool' => ['Liverpool', 'United Kingdom'],
		'bristol' => ['Bristol', 'United Kingdom'], 'leeds' => ['Leeds', 'United Kingdom'], 'cardiff' => ['Cardiff', 'United Kingdom'], 'belfast' => ['Belfast', 'United Kingdom'], 'dublin' => ['Dublin', 'Ireland'],
		'amsterdam' => ['Amsterdam', 'Netherlands'], 'rotterdam' => ['Rotterdam', 'Netherlands'], 'the hague' => ['The Hague', 'Netherlands'], 'den haag' => ['The Hague', 'Netherlands'], 'utrecht' => ['Utrecht', 'Netherlands'], 'eindhoven' => ['Eindhoven', 'Netherlands'],
		'zurich' => ['Zurich', 'Switzerland'], 'geneva' => ['Geneva', 'Switzerland'], 'geneve' => ['Geneva', 'Switzerland'], 'basel' => ['Basel', 'Switzerland'], 'bern' => ['Bern', 'Switzerland'], 'lausanne' => ['Lausanne', 'Switzerland'], 'lugano' => ['Lugano', 'Switzerland'],
		'vienna' => ['Vienna', 'Austria'], 'wien' => ['Vienna', 'Austria'], 'graz' => ['Graz', 'Austria'], 'salzburg' => ['Salzburg', 'Austria'], 'innsbruck' => ['Innsbruck', 'Austria'], 'linz' => ['Linz', 'Austria'],
		'copenhagen' => ['Copenhagen', 'Denmark'], 'kobenhavn' => ['Copenhagen', 'Denmark'], 'oslo' => ['Oslo', 'Norway'], 'stockholm' => ['Stockholm', 'Sweden'],
		'gothenburg' => ['Gothenburg', 'Sweden'], 'goteborg' => ['Gothenburg', 'Sweden'], 'helsinki' => ['Helsinki', 'Finland'], 'malmo' => ['Malmo', 'Sweden'], 'aarhus' => ['Aarhus', 'Denmark'], 'bergen' => ['Bergen', 'Norway'], 'reykjavik' => ['Reykjavik', 'Iceland'],
		'athens' => ['Athens', 'Greece'], 'thessaloniki' => ['Thessaloniki', 'Greece'], 'prague' => ['Prague', 'Czechia'], 'praha' => ['Prague', 'Czechia'], 'brno' => ['Brno', 'Czechia'],
		'warsaw' => ['Warsaw', 'Poland'], 'warszawa' => ['Warsaw', 'Poland'], 'krakow' => ['Krakow', 'Poland'], 'budapest' => ['Budapest', 'Hungary'], 'bucharest' => ['Bucharest', 'Romania'], 'sofia' => ['Sofia', 'Bulgaria'],
		'zagreb' => ['Zagreb', 'Croatia'], 'ljubljana' => ['Ljubljana', 'Slovenia'], 'belgrade' => ['Belgrade', 'Serbia'], 'bratislava' => ['Bratislava', 'Slovakia'], 'tallinn' => ['Tallinn', 'Estonia'], 'riga' => ['Riga', 'Latvia'], 'vilnius' => ['Vilnius', 'Lithuania'], 'luxembourg' => ['Luxembourg', 'Luxembourg'],
		'istanbul' => ['Istanbul', 'Turkey'], 'ankara' => ['Ankara', 'Turkey'], 'izmir' => ['Izmir', 'Turkey'], 'antalya' => ['Antalya', 'Turkey'],
		'moscow' => ['Moscow', 'Russia'], 'saint petersburg' => ['Saint Petersburg', 'Russia'], 'kyiv' => ['Kyiv', 'Ukraine'], 'kiev' => ['Kyiv', 'Ukraine'],
		'dubai' => ['Dubai', 'United Arab Emirates'], 'abu dhabi' => ['Abu Dhabi', 'United Arab Emirates'], 'doha' => ['Doha', 'Qatar'], 'tel aviv' => ['Tel Aviv', 'Israel'], 'jerusalem' => ['Jerusalem', 'Israel'],
		'beirut' => ['Beirut', 'Lebanon'], 'riyadh' => ['Riyadh', 'Saudi Arabia'], 'cairo' => ['Cairo', 'Egypt'], 'marrakech' => ['Marrakech', 'Morocco'], 'marrakesh' => ['Marrakech', 'Morocco'], 'casablanca' => ['Casablanca', 'Morocco'], 'tehran' => ['Tehran', 'Iran'],
		'tokyo' => ['Tokyo', 'Japan'], 'kyoto' => ['Kyoto', 'Japan'], 'osaka' => ['Osaka', 'Japan'], 'nagoya' => ['Nagoya', 'Japan'], 'yokohama' => ['Yokohama', 'Japan'], 'sapporo' => ['Sapporo', 'Japan'],
		'seoul' => ['Seoul', 'South Korea'], 'busan' => ['Busan', 'South Korea'], 'beijing' => ['Beijing', 'China'], 'shanghai' => ['Shanghai', 'China'], 'shenzhen' => ['Shenzhen', 'China'], 'guangzhou' => ['Guangzhou', 'China'], 'chengdu' => ['Chengdu', 'China'],
		'hong kong' => ['Hong Kong', 'Hong Kong'], 'taipei' => ['Taipei', 'Taiwan'], 'singapore' => ['Singapore', 'Singapore'], 'bangkok' => ['Bangkok', 'Thailand'], 'hanoi' => ['Hanoi', 'Vietnam'], 'ho chi minh city' => ['Ho Chi Minh City', 'Vietnam'],
		'jakarta' => ['Jakarta', 'Indonesia'], 'kuala lumpur' => ['Kuala Lumpur', 'Malaysia'], 'manila' => ['Manila', 'Philippines'],
		'mumbai' => ['Mumbai', 'India'], 'new delhi' => ['New Delhi', 'India'], 'bengaluru' => ['Bengaluru', 'India'], 'bangalore' => ['Bengaluru', 'India'], 'chennai' => ['Chennai', 'India'], 'kolkata' => ['Kolkata', 'India'], 'ahmedabad' => ['Ahmedabad', 'India'],
		'dhaka' => ['Dhaka', 'Bangladesh'], 'colombo' => ['Colombo', 'Sri Lanka'], 'kathmandu' => ['Kathmandu', 'Nepal'],
		'sydney' => ['Sydney', 'Australia'], 'melbourne' => ['Melbourne', 'Australia'], 'brisbane' => ['Brisbane', 'Australia'], 'perth' => ['Perth', 'Australia'], 'adelaide' => ['Adelaide', 'Australia'], 'auckland' => ['Auckland', 'New Zealand'], 'wellington' => ['Wellington', 'New Zealand'],
		'new york' => ['New York', 'United States'], 'los angeles' => ['Los Angeles', 'United States'], 'chicago' => ['Chicago', 'United States'], 'san francisco' => ['San Francisco', 'United States'],
		'boston' => ['Boston', 'United States'], 'seattle' => ['Seattle', 'United States'], 'philadelphia' => ['Philadelphia', 'United States'], 'miami' => ['Miami', 'United States'],
		'houston' => ['Houston', 'United States'], 'dallas' => ['Dallas', 'United States'], 'austin' => ['Austin', 'United States'], 'denver' => ['Denver', 'United States'], 'atlanta' => ['Atlanta', 'United States'],
		'toronto' => ['Toronto', 'Canada'], 'montreal' => ['Montreal', 'Canada'], 'vancouver' => ['Vancouver', 'Canada'], 'ottawa' => ['Ottawa', 'Canada'],
		'mexico city' => ['Mexico City', 'Mexico'], 'guadalajara' => ['Guadalajara', 'Mexico'], 'monterrey' => ['Monterrey', 'Mexico'],
		'sao paulo' => ['Sao Paulo', 'Brazil'], 'rio de janeiro' => ['Rio de Janeiro', 'Brazil'], 'brasilia' => ['Brasilia', 'Brazil'],
		'buenos aires' => ['Buenos Aires', 'Argentina'], 'santiago' => ['Santiago', 'Chile'], 'lima' => ['Lima', 'Peru'], 'bogota' => ['Bogota', 'Colombia'], 'medellin' => ['Medellin', 'Colombia'], 'quito' => ['Quito', 'Ecuador'], 'montevideo' => ['Montevideo', 'Uruguay'],
		'cape town' => ['Cape Town', 'South Africa'], 'johannesburg' => ['Johannesburg', 'South Africa'], 'nairobi' => ['Nairobi', 'Kenya'], 'lagos' => ['Lagos', 'Nigeria'], 'accra' => ['Accra', 'Ghana'], 'tunis' => ['Tunis', 'Tunisia'], 'addis ababa' => ['Addis Ababa', 'Ethiopia'],
	];

	/**
	 * Scan text for known countries and major cities (accent-folded, 1-3 word windows). A city hit
	 * is returned as a "City, Country" query so Nominatim resolves the well-known place; a country
	 * hit is returned on its own. Both are marked TRUSTED (a named gazetteer place is not a fuzzy
	 * guess), so detectLocations accepts a localised exonym ("Bruxelles" for a "Brussels" query)
	 * that the correspondence guard would otherwise reject.
	 *
	 * @return array<int,array{q:string,minImportance:float,trusted:bool}>
	 */
	private function gazetteerCandidates(string $text): array {
		$norm = $this->normalizeForMatch($text);
		if ($norm === '') {
			return [];
		}
		$tokens = explode(' ', $norm);
		$n = count($tokens);
		$cities = [];
		$countries = [];
		for ($i = 0; $i < $n; $i++) {
			for ($w = 3; $w >= 1; $w--) {
				if ($i + $w > $n) {
					continue;
				}
				$key = implode(' ', array_slice($tokens, $i, $w));
				if (isset(self::GAZ_CITIES[$key])) {
					$c = self::GAZ_CITIES[$key];
					$cities[$c[0] . '|' . $c[1]] = $c;
					$i += $w - 1;
					break;
				}
				if (isset(self::GAZ_COUNTRIES[$key])) {
					$countries[self::GAZ_COUNTRIES[$key]] = self::GAZ_COUNTRIES[$key];
					$i += $w - 1;
					break;
				}
			}
		}
		$out = [];
		foreach ($cities as $c) {
			$q = $c[0] === $c[1] ? $c[0] : $c[0] . ', ' . $c[1];
			$out[] = ['q' => $q, 'minImportance' => 0.12, 'trusted' => true];
		}
		foreach ($countries as $cn) {
			$out[] = ['q' => $cn, 'minImportance' => 0.18, 'trusted' => true];
		}
		return $out;
	}

	/** Is a single word a known gazetteer country or city (accent-folded)? Used to skip the bare
	 * form of a place the gazetteer already added as a disambiguated "City, Country" candidate. */
	private function isGazetteerWord(string $q): bool {
		$nq = $this->normalizeForMatch($q);
		if ($nq === '' || strpos($nq, ' ') !== false) {
			return false;
		}
		return isset(self::GAZ_CITIES[$nq]) || isset(self::GAZ_COUNTRIES[$nq]);
	}

	/**
	 * Merge English (always) with the user's UI language into a single hint set:
	 * {cues:string[], labels:string[], stop:array<string,true>}. `$lang` may be an NC locale
	 * like "fr", "pt_BR", "de_DE"; only the leading language subtag is used.
	 *
	 * @return array{cues:string[],labels:string[],stop:array<string,true>}
	 */
	private function resolveHints(?string $lang): array {
		// Genitive prepositions ("of X", "de Versailles", "di Roma") that precede a place. Unlike
		// locative cues they capture a SINGLE following capitalised word, so a run-together caption
		// ("de Versailles Livraison ...") still isolates "Versailles" instead of gluing on the next
		// word. Kept separate per language, English ("of") always included.
		$genMap = [
			'en' => ['of'], 'fr' => ['de', 'du', 'des'], 'es' => ['de', 'del'],
			'it' => ['di', 'del', 'della', 'da'], 'pt' => ['de', 'do', 'da', 'dos', 'das'],
			'de' => ['von', 'vom'], 'nl' => ['van'],
		];
		$code = strtolower(substr(trim((string)$lang), 0, 2));
		$sets = ['en'];
		if ($code !== '' && $code !== 'en' && isset(self::LANG_HINTS[$code])) {
			$sets[] = $code;
		}
		$cues = [];
		$labels = [];
		$gcues = [];
		$stop = [];
		// UNIVERSAL_STOP (materials / techniques / roles / generic filler) applies in every
		// language: a caption is often written in a language other than the UI locale, so this
		// vocabulary must be suppressed regardless of $lang.
		foreach ($sets as $c) {
			$s = self::LANG_HINTS[$c];
			$cues = array_merge($cues, $s['cues']);
			$labels = array_merge($labels, $s['labels']);
			$gcues = array_merge($gcues, $genMap[$c] ?? []);
		}
		foreach (explode(' ', self::UNIVERSAL_STOP) as $w) {
			$w = trim($w);
			if ($w !== '') {
				$stop[$w] = true;
			}
		}
		foreach ($sets as $c) {
			foreach (explode(' ', self::LANG_HINTS[$c]['stop']) as $w) {
				$w = trim($w);
				if ($w !== '') {
					$stop[$w] = true;
				}
			}
		}
		// Longest cue/label first so alternation prefers "cerca de" over "a", "into" over "in".
		usort($cues, static fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
		usort($labels, static fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
		usort($gcues, static fn ($a, $b) => mb_strlen($b) <=> mb_strlen($a));
		return [
			'cues' => array_values(array_unique($cues)),
			'labels' => array_values(array_unique($labels)),
			'gcues' => array_values(array_unique($gcues)),
			'stop' => $stop,
		];
	}

	/**
	 * Detect a likely location from a reference's text (title / description / hashtags /
	 * page placename) and geocode it, returning a suggestion the user confirms. Builds a
	 * prioritised candidate list, geocodes each in turn (capped, Nominatim ~1 req/s), and
	 * returns the first candidate that resolves to a REAL place (city/region/landmark/...)
	 * with enough confidence - so random capitalised words don't produce false pins.
	 *
	 * @return array{lat:float,lng:float,place:string,source:string,matched:string}|null
	 */
	public function detectLocation(string $title, string $desc, string $hashtags = '', ?string $placename = null, ?string $lang = null): ?array {
		$all = $this->detectLocations($title, $desc, $hashtags, $placename, $lang);
		return $all[0] ?? null;
	}

	/**
	 * Detect ALL distinct locations mentioned in a reference's text, best first, so the UI can
	 * offer several when a caption names more than one place. The SAME place expressed at
	 * different granularity ("Texas" and "Texas, USA" -> one Texas) is collapsed by the resolved
	 * OSM object / coordinates; genuinely different places (Kentfield, California, Oklahoma) are
	 * kept separate. Each is scored by signal strength (stronger source = lower minImportance)
	 * then Nominatim confidence.
	 *
	 * @return array<int,array{lat:float,lng:float,place:string,source:string,matched:string}>
	 */
	public function detectLocations(string $title, string $desc, string $hashtags = '', ?string $placename = null, ?string $lang = null, int $limit = 5): array {
		$hints = $this->resolveHints($lang);
		$candidates = $this->placeCandidates($title, $desc, $hashtags, $placename, $hints);
		$found = []; // keyed by resolved place identity -> best-scored match
		$tried = 0;
		foreach ($candidates as $cand) {
			if ($tried >= 10) {
				break; // be polite to Nominatim: cap lookups per detection
			}
			$tried++;
			$results = $this->geocodeSearch($cand['q'], $lang, 3);
			foreach ($results as $r) {
				if (!$this->looksLikePlace($r, $cand['minImportance'])) {
					continue;
				}
				// Precision guard: Nominatim will fuzzily match a name to a famous far-away place
				// (a person's name -> "Bethléem"). Require the resolved place name to actually
				// contain a word from the query, so a mismatch is dropped. Skipped for TRUSTED
				// gazetteer candidates: a known city/country may resolve to a localised exonym
				// ("Bruxelles" for "Brussels", "Deutschland" for "Germany") the guard would reject.
				if (empty($cand['trusted']) && !$this->resultMatchesQuery($cand['q'], (string)($r['place'] ?? ''))) {
					continue;
				}
				$score = (1.0 - $cand['minImportance']) * 10.0 + (float)($r['importance'] ?? 0);
				$key = $this->placeIdentityKey($r);
				// Same resolved place reached before? keep the higher-scored one.
				if (isset($found[$key])) {
					if ($score > $found[$key]['score']) {
						$found[$key]['score'] = $score;
					}
				} else {
					$found[$key] = [
						'score' => $score,
						'lat' => $r['lat'],
						'lng' => $r['lng'],
						'place' => $r['place'],
						'source' => 'geocoded',
						'matched' => $cand['q'],
					];
				}
				break; // best Nominatim result for this candidate is its first
			}
		}
		$out = array_values($found);
		usort($out, static fn ($a, $b) => $b['score'] <=> $a['score']);
		// Collapse duplicates: the SAME point (two feeds for one feature) and a broader ANCESTOR
		// of a place already kept ("United States" when "Texas" is present, "California" when
		// "Kentfield, California" is present) - so only genuinely distinct places remain.
		$kept = [];
		foreach ($out as $cand) {
			$skip = false;
			foreach ($kept as $i => $k) {
				if ($this->haversineKm($cand['lat'], $cand['lng'], $k['lat'], $k['lng']) < 1.5) {
					$skip = true;
					break;
				}
				if ($this->placeIsAncestor($cand['place'], $k['place'])) {
					$skip = true; // cand is broader than something we already have -> drop it
					break;
				}
				if ($this->placeIsAncestor($k['place'], $cand['place'])) {
					$kept[$i] = $cand; // cand is MORE specific than a kept broader place -> replace
					$skip = true;
					break;
				}
			}
			if (!$skip) {
				$kept[] = $cand;
			}
		}
		return array_map(static function ($k) {
			unset($k['score']);
			return $k;
		}, array_slice($kept, 0, $limit));
	}

	/** Is $broad a broader ancestor of $specific by Nominatim display_name (suffix match)? */
	private function placeIsAncestor(string $broad, string $specific): bool {
		$b = mb_strtolower(trim($broad));
		$s = mb_strtolower(trim($specific));
		if ($b === '' || $s === '' || $b === $s) {
			return false;
		}
		return str_ends_with($s, ', ' . $b);
	}

	/**
	 * Does the geocoded place name actually contain a significant word from the query? Guards
	 * against Nominatim's fuzzy fallback matching an unrelated token to a famous place. Accent-
	 * and case-insensitive; a query with only very short tokens (or none) is allowed through.
	 */
	private function resultMatchesQuery(string $query, string $placeName): bool {
		$qn = $this->normalizeForMatch($query);
		$pn = $this->normalizeForMatch($placeName);
		if ($qn === '' || $pn === '') {
			return true;
		}
		$toks = array_filter(explode(' ', $qn), static fn ($t) => mb_strlen($t) >= 4);
		if (!$toks) {
			$toks = array_filter(explode(' ', $qn), static fn ($t) => mb_strlen($t) >= 3);
		}
		if (!$toks) {
			return true;
		}
		foreach ($toks as $t) {
			if (preg_match('/(^| )' . preg_quote($t, '/') . '/', $pn)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Fold "styled" Unicode letters (mathematical bold/italic/script/fraktur/sans/monospace,
	 * full-width, ligatures) back to plain ASCII-ish letters via NFKC, so an Instagram caption
	 * written in a decorative font ("𝐃𝐫𝐞𝐚𝐦 𝐒𝐭𝐚𝐠𝐞", "𝘈𝘸𝘢𝘫𝘪") is still readable to the extractor.
	 * A no-op when intl's Normalizer is unavailable or the text is already plain.
	 */
	private function foldText(string $s): string {
		if ($s === '' || !class_exists('\\Normalizer')) {
			return $s;
		}
		$n = \Normalizer::normalize($s, \Normalizer::FORM_KC);
		return $n === false ? $s : $n;
	}

	/** Lowercase + strip accents/diacritics + reduce to space-separated alphanumerics. */
	private function normalizeForMatch(string $s): string {
		$s = mb_strtolower($this->foldText(trim($s)));
		if (class_exists('\\Transliterator')) {
			$t = \Transliterator::create('Any-Latin; Latin-ASCII');
			if ($t !== null) {
				$s = (string)$t->transliterate($s);
			}
		} elseif (function_exists('iconv')) {
			$c = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
			if ($c !== false) {
				$s = $c;
			}
		}
		$s = (string)preg_replace('/[^a-z0-9]+/', ' ', mb_strtolower($s));
		return trim($s);
	}

	/** Identity of a resolved place for dedup: its OSM object ref, else rounded coordinates. */
	private function placeIdentityKey(array $r): string {
		$ref = trim((string)($r['ref'] ?? ''));
		if ($ref !== '') {
			return 'ref:' . $ref;
		}
		return 'xy:' . round((float)$r['lat'], 2) . ',' . round((float)$r['lng'], 2);
	}

	/** Great-circle distance in km between two lat/lng points. */
	private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float {
		$r = 6371.0;
		$dLat = deg2rad($lat2 - $lat1);
		$dLng = deg2rad($lng2 - $lng1);
		$a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
		return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
	}

	/**
	 * Ordered, de-duplicated place-name candidates from a reference's text. Ordered by
	 * reliability so the first few (only ~4 get geocoded) are the strongest signals:
	 * page placename, then prepositional cues ("in/at/near/from <place>", which also
	 * catch a lowercase place a capitalisation scan would miss), then hashtags, then
	 * capitalised proper-noun phrases (sentence-opener stopwords filtered out). Each
	 * carries a minImportance so intentional signals pass more easily than a stray phrase.
	 *
	 * @return array<int,array{q:string,minImportance:float}>
	 */
	private function placeCandidates(string $title, string $desc, string $hashtags, ?string $placename, ?array $hints = null): array {
		$hints ??= $this->resolveHints(null);
		// Fold decorative Unicode fonts to plain letters first, so a bold/italic caption
		// ("𝐀𝐰𝐚𝐣𝐢 𝐘𝐮𝐦𝐞𝐛𝐮𝐭𝐚𝐢") is seen by every extractor below (and the capitalisation signal survives).
		$title = $this->foldText($title);
		$desc = $this->foldText($desc);
		$hashtags = $this->foldText($hashtags);
		$placename = $placename === null ? null : $this->foldText($placename);
		$out = [];
		$seen = [];
		$add = function (?string $q, float $minImp, bool $trusted = false) use (&$out, &$seen, $hints): void {
			$q = trim((string)$q);
			if ($q === '' || mb_strlen($q) < 3) {
				return;
			}
			// Never geocode a phrase that is entirely filler / material words ("Tierra Cruda").
			if ($this->phraseIsAllStop($q, $hints)) {
				return;
			}
			// Skip the BARE form of a known city/country: the gazetteer already added it as a
			// disambiguated "City, Country" candidate, so a lone "Brussels" won't also resolve to
			// an obscure US namesake. Trusted (gazetteer-sourced) adds bypass this.
			if (!$trusted && $this->isGazetteerWord($q)) {
				return;
			}
			$key = mb_strtolower($q);
			if (isset($seen[$key]) && $seen[$key] <= $minImp) {
				return;
			}
			$seen[$key] = $minImp;
			$out[] = ['q' => $q, 'minImportance' => $minImp, 'trusted' => $trusted];
		};
		// Add a multi-word candidate AND cheaper fallbacks drawn from it, so a phrase Nominatim
		// won't match whole ("Karimoku Commons, Tokyo", "Vejle Harbour") still resolves via a
		// component ("Tokyo", "Vejle"). The trailing comma-segment (usually the city) ranks just
		// above the individual words.
		$addBackoff = function (string $q, float $minImp) use ($add, $hints): void {
			$add($q, $minImp);
			if (!preg_match('/[ ,]/u', $q)) {
				return;
			}
			$segs = preg_split('/\s*,\s*/u', $q) ?: [];
			if (count($segs) > 1) {
				$add(trim((string)end($segs)), $minImp + 0.08);
			}
			foreach (preg_split('/[\s,]+/u', $q) ?: [] as $w) {
				$w = trim($w, " \t.,;:'’-");
				if (mb_strlen($w) >= 3 && !$this->isStopword($w, $hints) && preg_match('/^[\p{Lu}]/u', $w)) {
					$add($w, $minImp + 0.14);
				}
			}
		};

		if ($placename !== null && trim($placename) !== '') {
			$add($placename, 0.0);
		}
		// Bundled gazetteer: a country or major city named ANYWHERE in the text is a strong,
		// grammar-independent signal. A city is queried as "City, Country" so Nominatim returns
		// the well-known place rather than an obscure namesake; both are trusted (see $add).
		foreach ($this->gazetteerCandidates($title . "\n" . $desc . "\n" . (string)$hashtags . "\n" . (string)$placename) as $g) {
			$add($g['q'], $g['minImportance'], true);
		}
		// Explicit location labels ("Lieu: ...", "Location: ...", "📍 ...") are the strongest
		// signal: the author literally states WHERE. The full label value is tried first (so a
		// detailed venue is kept over just its city), then a broader fallback drawn from it.
		foreach ($this->explicitLocationLabels($title . "\n" . $desc, $hints) as $p) {
			$add($p['q'], $p['minImportance']);
		}
		// Prepositional cues from title then description (most reliable text signal, and
		// the only path that catches a lowercase place name like "...in reykjavik...").
		foreach ($this->locationCues($title, $hints) as $p) {
			$addBackoff($p, 0.24);
		}
		foreach ($this->locationCues($desc, $hints) as $p) {
			$addBackoff($p, 0.24);
		}
		// Hashtags: split "#CamelCase_or-words" into readable phrases.
		foreach (preg_split('/[\s,]+/', $hashtags) ?: [] as $h) {
			$h = ltrim(trim($h), '#');
			if ($h === '') {
				continue;
			}
			$add($this->humanizeToken($h), 0.28);
		}
		// Capitalised proper-noun phrases from title then description.
		foreach ($this->capitalisedPhrases($title, $hints) as $p) {
			$addBackoff($p, 0.36);
		}
		foreach ($this->capitalisedPhrases($desc, $hints) as $p) {
			$addBackoff($p, 0.42);
		}
		// De-dupe kept the strongest (lowest) minImportance per query; sort so those
		// stronger signals are geocoded first within the 4-lookup budget.
		usort($out, static fn ($a, $b) => $a['minImportance'] <=> $b['minImportance']);
		return $out;
	}

	/**
	 * Place names introduced by a locative preposition ("shot in Marrakech", "morning
	 * in reykjavik", "streets of Kyoto"). Captures a following run of capitalised words
	 * (proper nouns, commas allowed) OR a single lowercase word right after the cue - so
	 * a lower-cased place a capitalisation scan ignores is still found. Ordered as met.
	 *
	 * @return string[]
	 */
	private function locationCues(string $text, ?array $hints = null): array {
		$text = trim($text);
		if ($text === '') {
			return [];
		}
		$hints ??= $this->resolveHints(null);
		// Build the cue alternation from the (English + user-language) cue list, longest first
		// so multi-word cues like "cerca de" win over "a". Lookbehind (not \b) so accented
		// cues like "à" match. Cues are plain words -> preg_quote is a no-op but keeps it safe.
		$cue = '(?:' . implode('|', array_map(static fn ($c) => preg_quote($c, '/'), $hints['cues'])) . ')';
		$out = [];
		// Cue + a run of 1-3 capitalised words ("Marrakech, Morocco", "Grands Ateliers").
		if (preg_match_all('/(?<![\p{L}])' . $cue . '\s+([A-ZÀ-Þ][\p{L}\'’-]+(?:[ ,]+[A-ZÀ-Þ][\p{L}\'’-]+){0,2})/u', $text, $m)) {
			foreach ($m[1] as $p) {
				$out[] = trim((string)preg_replace('/\s*,\s*/', ', ', $p));
			}
		}
		// Cue + a single lowercase word (>=4 letters, not a common stopword) -> catches
		// "in reykjavik", "at lisbon".
		if (preg_match_all('/(?<![\p{L}])' . $cue . '\s+(\p{Ll}[\p{Ll}\'’-]{3,})\b/u', $text, $m2)) {
			foreach ($m2[1] as $w) {
				if (!$this->isStopword($w, $hints)) {
					$out[] = $w;
				}
			}
		}
		// Genitive cue + a SINGLE following word ("de Versailles", "of Kyoto", "di Roma"). Only
		// one token is taken (not a run) so a run-together caption ("de Versailles Livraison ...")
		// still isolates the place instead of gluing on the next unrelated capitalised word.
		if (!empty($hints['gcues'])) {
			$gcue = '(?:' . implode('|', array_map(static fn ($c) => preg_quote($c, '/'), $hints['gcues'])) . ')';
			if (preg_match_all('/(?<![\p{L}])' . $gcue . '\s+([A-ZÀ-Þ][\p{L}\'’-]{2,})/u', $text, $m3)) {
				foreach ($m3[1] as $w) {
					if (!$this->isStopword($w, $hints)) {
						$out[] = trim($w);
					}
				}
			}
			if (preg_match_all('/(?<![\p{L}])' . $gcue . '\s+(\p{Ll}[\p{Ll}\'’-]{3,})\b/u', $text, $m4)) {
				foreach ($m4[1] as $w) {
					if (!$this->isStopword($w, $hints)) {
						$out[] = $w;
					}
				}
			}
		}
		return array_slice(array_values(array_unique(array_filter($out, static fn ($s) => $s !== ''))), 0, 12);
	}

	/**
	 * Is a single-word candidate a common sentence-opener / adjective / verb / calendar word
	 * (in English or the user's language) that is NOT a place, so it must not consume the
	 * small geocode budget? Matched case-insensitively; multi-word phrases are never dropped.
	 */
	private function isStopword(string $word, ?array $hints = null): bool {
		$hints ??= $this->resolveHints(null);
		return isset($hints['stop'][mb_strtolower($word)]);
	}

	/** Split a hashtag/CamelCase token into a spaced phrase ("newYork_city" -> "new York city"). */
	private function humanizeToken(string $t): string {
		$t = preg_replace('/([a-z0-9])([A-Z])/u', '$1 $2', $t) ?? $t;
		$t = str_replace(['_', '-'], ' ', $t);
		return trim(preg_replace('/\s+/', ' ', $t) ?? $t);
	}

	/**
	 * Runs of 1-4 capitalised words (accents allowed), comma-joined, from a text.
	 *
	 * @return string[]
	 */
	private function capitalisedPhrases(string $text, ?array $hints = null): array {
		$text = trim($text);
		if ($text === '') {
			return [];
		}
		$hints ??= $this->resolveHints(null);
		if (!preg_match_all('/\b([A-ZÀ-Þ][\p{L}\'’-]+(?:[ ,]+[A-ZÀ-Þ][\p{L}\'’-]+){0,3})\b/u', $text, $m)) {
			return [];
		}
		$out = [];
		foreach ($m[1] as $p) {
			$p = trim(preg_replace('/\s*,\s*/', ', ', $p) ?? $p);
			if ($p === '') {
				continue;
			}
			// Drop a candidate whose words are ALL filler / non-place (a single "Beautiful",
			// or a material phrase like "Tierra Cruda" = raw earth); keep any phrase with a
			// real proper-noun word ("New York", "Tierra del Fuego").
			if ($this->phraseIsAllStop($p, $hints)) {
				continue;
			}
			$out[] = $p;
		}
		return array_slice(array_values(array_unique($out)), 0, 10);
	}

	/** True when every significant word of a phrase is a stopword (so it is not a place). */
	private function phraseIsAllStop(string $phrase, array $hints): bool {
		$words = preg_split('/[\s,]+/u', trim($phrase)) ?: [];
		$significant = 0;
		foreach ($words as $w) {
			$w = trim($w, " \t.,;:'’-");
			if ($w === '' || mb_strlen($w) < 2 || preg_match('/^\d+$/', $w)) {
				continue;
			}
			$significant++;
			if (!isset($hints['stop'][mb_strtolower($w)])) {
				return false;
			}
		}
		return $significant > 0;
	}

	/**
	 * Place names stated behind an explicit label ("Lieu: ...", "Location: ...", "Venue: ...",
	 * "Adresse: ...", a 📍/📌 pin). The author is telling us WHERE, so this is the strongest
	 * signal. Returns the full label value first (minImportance 0 -> geocoded first and, via
	 * looksLikePlace, accepted even as a specific venue so a detailed spot is kept over its
	 * city), then a broader fallback (the last capitalised phrase in the value, usually the
	 * city) in case the full venue does not geocode.
	 *
	 * @return array<int,array{q:string,minImportance:float}>
	 */
	private function explicitLocationLabels(string $text, ?array $hints = null): array {
		$hints ??= $this->resolveHints(null);
		$out = [];
		$push = function (string $val) use (&$out, $hints): void {
			// Trim to the value, drop a trailing "(38)"-style department/parenthetical and
			// stray punctuation so "... de Grenoble (38)" geocodes cleanly.
			$val = trim($val);
			$val = (string)preg_replace('/\s*\([^)]*\)\s*$/u', '', $val);
			$val = trim($val, " \t\r\n.,;:—-–>\"'“”");
			if ($val === '' || mb_strlen($val) < 3) {
				return;
			}
			// If the value still ran long (a sentence spilled past the venue), keep only up to
			// the last full word within 90 chars rather than dropping it entirely - a long
			// "TÜYAP Fair and Congress Center in Istanbul, Türkiye ..." must still geocode.
			if (mb_strlen($val) > 90) {
				$cut = mb_substr($val, 0, 90);
				$sp = mb_strrpos($cut, ' ');
				$val = trim($sp !== false ? mb_substr($cut, 0, $sp) : $cut, " \t.,;:-");
			}
			$caps = $this->capitalisedPhrases($val, $hints);
			$out[] = ['q' => $val, 'minImportance' => 0.0];
			// Broader fallback: the last capitalised phrase in the value (usually the city).
			if ($caps) {
				$last = $caps[count($caps) - 1];
				if (mb_strtolower($last) !== mb_strtolower($val)) {
					$out[] = ['q' => $last, 'minImportance' => 0.05];
				}
			}
		};
		// "Label: value" up to the next "Word:" label / a — separator / sentence end / newline.
		$labels = 'lieu|lieux|adresse|localisation|location|venue|address|où|where|place';
		if (preg_match_all('/(?<![\p{L}])(?:' . $labels . ')\s*[:：]\s*(.+?)(?=\s+[\p{Lu}][\p{L}’\'\-]*\s*[:：]|\s+[—–]\s|[.!?;]|\s{2,}|[\r\n]|$)/iu', $text, $m)) {
			foreach ($m[1] as $v) {
				$push((string)$v);
			}
		}
		// Pin emoji prefix ("📍 Paris, France"): value runs to end of line / sentence.
		if (preg_match_all('/[\x{1F4CD}\x{1F4CC}\x{1F5FA}]\s*(.+?)(?=[\r\n]|[.!?]|\s{2,}|$)/u', $text, $m2)) {
			foreach ($m2[1] as $v) {
				$push((string)$v);
			}
		}
		return $out;
	}

	/** Does a Nominatim result look like an actual place (not a shop/road/etc.)? */
	private function looksLikePlace(array $r, float $minImportance): bool {
		$cat = strtolower((string)($r['category'] ?? ''));
		$atype = strtolower((string)($r['addresstype'] ?? ''));
		// High-confidence candidates (explicit "Lieu:" label, page placename): the author
		// stated the location, so accept a SPECIFIC named venue (a campus/building/amenity)
		// rather than forcing the match up to its city. Reject only clearly non-locational
		// hits (a person, a product) - anything with a physical footprint is fine.
		if ($minImportance <= 0.06) {
			$nonPlace = ['person', 'railway'];
			if ($cat !== '' && in_array($cat, $nonPlace, true)) {
				return false;
			}
			$venueCats = ['place', 'boundary', 'natural', 'tourism', 'leisure', 'historic', 'waterway',
				'amenity', 'building', 'office', 'man_made', 'landuse', 'aeroway'];
			return $cat === '' || in_array($cat, $venueCats, true) || $atype !== '';
		}
		$placeCats = ['place', 'boundary', 'natural', 'tourism', 'leisure', 'historic', 'waterway'];
		$placeAddr = ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'state', 'region',
			'province', 'county', 'municipality', 'country', 'island', 'city_district', 'district', 'quarter'];
		$isPlace = in_array($cat, $placeCats, true) || in_array($atype, $placeAddr, true);
		if (!$isPlace) {
			return false;
		}
		$imp = (float)($r['importance'] ?? 0);
		// A WEAK signal (a bare capitalised phrase / a backoff word, minImportance >= 0.34) is
		// usually a proper noun that is NOT a place - a person's or studio's name, or a common
		// word that happens to also name a tiny hamlet ("Cement, Oklahoma", "Over, Cambridgeshire").
		// Nominatim lands these on a low-importance administrative area or rural settlement, so for
		// weak signals apply a confidence bar by bucket instead of auto-accepting:
		//   - rural / administrative fabric (county/region/village/hamlet/boundary): high bar 0.50
		//     (this is where the fuzzy junk lands: Christian County, Lange, Over, Light Regional Council);
		//   - well-known settlement (city/town/country): 0.38;
		//   - a specific NAMED venue (a tourism/leisure/historic/amenity/building the query name
		//     actually matches, e.g. "Awaji Yumebutai"): keep the per-signal bar, do NOT over-filter.
		// Strong signals (cue / label / gazetteer / hashtag, minImp < 0.34) keep permissive accept.
		if ($minImportance >= 0.34) {
			$rural = $cat === 'boundary' || in_array($atype, ['state', 'region', 'province', 'county', 'municipality', 'district', 'village', 'hamlet'], true);
			if ($rural) {
				return $imp >= 0.50;
			}
			if (in_array($atype, ['city', 'town', 'country'], true)) {
				return $imp >= 0.38;
			}
			return $imp >= $minImportance;
		}
		if ($cat === 'boundary' || in_array($atype, ['city', 'town', 'state', 'country', 'region', 'province', 'county', 'municipality', 'district'], true)) {
			return true;
		}
		return $imp >= $minImportance;
	}

	/* ===================== link / video stubs ===================== */

	/**
	 * A small self-contained HTML card for a link with no importable image. Web pages
	 * no longer store a full HTML snapshot: type=link references save the selected
	 * picture as WebP (see CurioService::referenceFileContent) and keep source_url
	 * for "Open link", so this stub is only the fallback when there is no image.
	 */
	public function buildLinkStubHtml(string $sourceUrl, ?string $title, ?string $image, ?string $description): string {
		$t = htmlspecialchars(($title !== null && $title !== '') ? $title : $sourceUrl, ENT_QUOTES);
		$u = htmlspecialchars($sourceUrl, ENT_QUOTES);
		$img = ($image !== null && $image !== '') ? '<img src="' . htmlspecialchars($image, ENT_QUOTES) . '" alt="" style="max-width:100%;border-radius:8px">' : '';
		$desc = ($description !== null && $description !== '') ? '<p>' . htmlspecialchars($description, ENT_QUOTES) . '</p>' : '';
		return "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
			. "<title>$t</title><meta name=\"curio:source\" content=\"$u\"></head>"
			. "<body style=\"font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.5\">"
			. "<h1 style=\"font-size:1.3rem\">$t</h1>$img$desc"
			. "<p><a href=\"$u\">$u</a></p></body></html>";
	}

	/** A small self-contained HTML file for a streamed provider video (poster + embed + link). */
	public function buildVideoStubHtml(array $video, string $sourceUrl, ?string $title, ?string $poster): string {
		$t = htmlspecialchars(($title !== null && $title !== '') ? $title : $sourceUrl, ENT_QUOTES);
		$u = htmlspecialchars($sourceUrl, ENT_QUOTES);
		$embed = htmlspecialchars((string)($video['embed'] ?? ''), ENT_QUOTES);
		$posterTag = ($poster !== null && $poster !== '') ? '<img src="' . htmlspecialchars($poster, ENT_QUOTES) . '" alt="" style="max-width:100%;border-radius:8px">' : '';
		$frame = $embed !== ''
			? '<div style="position:relative;padding-top:56.25%;margin:1rem 0"><iframe src="' . $embed . '" style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:8px" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>'
			: $posterTag;
		return "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
			. "<title>$t</title><meta name=\"curio:source\" content=\"$u\"></head>"
			. "<body style=\"font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem\">"
			. "<h1 style=\"font-size:1.3rem\">$t</h1>$frame"
			. "<p><a href=\"$u\">$u</a></p></body></html>";
	}

	/* ===================== low-level helpers ===================== */

	private function fetchText(string $url, ?int $maxBytes = null): ?string {
		try {
			$resp = $this->clientService->newClient()->get($url, $this->clientOptions(12));
			if ($resp->getStatusCode() >= 400) {
				return null;
			}
			$body = (string)$resp->getBody();
			return $body === '' ? null : substr($body, 0, $maxBytes ?? self::MAX_HTML);
		} catch (\Throwable $e) {
			$this->logger->debug('Curio fetchText failed: ' . $e->getMessage());
			return null;
		}
	}

	/** @return array<string,mixed> */
	private function clientOptions(int $timeout): array {
		$opts = [
			'timeout' => $timeout,
			'headers' => ['User-Agent' => self::UA, 'Accept' => '*/*'],
			'allow_redirects' => ['max' => 5],
		];
		if ($this->config->getAppValue(Application::APP_ID, 'allow_local_fetch', 'no') === 'yes') {
			$opts['nextcloud'] = ['allow_local_address' => true];
		}
		return $opts;
	}

	private function thumbFolder(): ?ISimpleFolder {
		try {
			$appData = $this->appDataFactory->get(Application::APP_ID);
			try {
				return $appData->getFolder(self::THUMB_DIR);
			} catch (NotFoundException $e) {
				return $appData->newFolder(self::THUMB_DIR);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('Curio appdata unavailable: ' . $e->getMessage());
			return null;
		}
	}

	private function detectImageMime(string $bytes): string {
		if (function_exists('finfo_open')) {
			$f = finfo_open(FILEINFO_MIME_TYPE);
			if ($f !== false) {
				$m = finfo_buffer($f, $bytes);
				finfo_close($f);
				if (is_string($m) && $m !== '') {
					return $m;
				}
			}
		}
		$info = @getimagesizefromstring($bytes);
		if (is_array($info) && !empty($info['mime'])) {
			return (string)$info['mime'];
		}
		return 'application/octet-stream';
	}

	private function isHttpUrl(string $url): bool {
		if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
			return false;
		}
		$scheme = strtolower((string)parse_url($url, PHP_URL_SCHEME));
		return $scheme === 'http' || $scheme === 'https';
	}

	private function absoluteUrl(string $base, string $rel): string {
		if ($rel === '' || $this->isHttpUrl($rel)) {
			return $rel;
		}
		if (str_starts_with($rel, '//')) {
			$scheme = (string)parse_url($base, PHP_URL_SCHEME) ?: 'https';
			return $scheme . ':' . $rel;
		}
		$parts = parse_url($base);
		if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
			return $rel;
		}
		$origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
		if (str_starts_with($rel, '/')) {
			return $origin . $rel;
		}
		$path = isset($parts['path']) ? preg_replace('#/[^/]*$#', '/', $parts['path']) : '/';
		return $origin . $path . $rel;
	}
}
