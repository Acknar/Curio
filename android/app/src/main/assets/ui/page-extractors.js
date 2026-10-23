// page-extractors.js - the Curio Web Clipper (1.1.0) extractors.js, unchanged. The
// app injects it into a hidden WebView that renders a page with the user's in-app
// site sign-ins (see Renderer.java), as the fallback when plain fetches come back empty.
//
// extractors.js - runs in the content-script (page) context. Reads the DOM the
// user's logged-in browser has already loaded, which is how the clipper gets
// Instagram (and other login-walled) media that the Nextcloud server cannot
// fetch itself. Produces a plain payload object the popup renders.

const CurioExtract = {
	meta(names) {
		for (const n of names) {
			const el = document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]');
			if (el && el.content && el.content.trim()) return el.content.trim();
		}
		return '';
	},

	site() {
		const h = location.hostname.replace(/^www\./, '');
		if (h.endsWith('instagram.com') || h === 'instagr.am') return 'instagram';
		if (h.endsWith('youtube.com') || h === 'youtu.be') return 'youtube';
		if (h.includes('pinterest.')) return 'pinterest';
		if (h.endsWith('vimeo.com')) return 'vimeo';
		return 'web';
	},

	push(arr, u) {
		if (!u || !/^https?:/i.test(u)) return;
		if (!arr.includes(u)) arr.push(u);
	},

	unshift(arr, u) {
		if (!u) return;
		const i = arr.indexOf(u);
		if (i >= 0) arr.splice(i, 1);
		arr.unshift(u);
	},

	// info: synthesized from a context-menu click, an action click, or a hotkey click.
	// { srcUrl, mediaType('image'|'video'), linkUrl, selectionText, pageUrl }
	page(info) {
		info = info || {};
		const site = this.site();
		const data = {
			url: info.linkUrl || location.href,
			pageUrl: location.href,
			site: site,
			title: '',
			description: '',
			image: '',
			images: [],
			video: null,
			selection: (info.selectionText || (window.getSelection ? String(window.getSelection()) : '') || '').trim(),
			kind: 'link', // link | image | image_url | video | pdf | text
		};

		data.title = this.meta(['og:title', 'twitter:title']) || document.title || '';
		data.description = this.meta(['og:description', 'twitter:description', 'description']) || '';
		this.push(data.images, this.meta(['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']));
		if (data.images.length) data.image = data.images[0];

		if (site === 'instagram') this.instagram(data, info);
		else if (site === 'youtube') this.youtube(data, info);
		else if (site === 'vimeo') this.vimeo(data, info);
		else if (site === 'pinterest') this.pinterest(data, info);
		else this.generic(data, info);

		// PDF wins over everything (a linked or open PDF).
		if (/\.pdf($|[?#])/i.test(data.url) || document.contentType === 'application/pdf') {
			data.kind = 'pdf';
		}

		// A pure text selection with no media target becomes a text note.
		if (data.selection && !info.srcUrl && data.kind === 'link' && info.hotkeyText) {
			data.kind = 'text';
		}
		return data;
	},

	cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); },

	// Find the <img> element for a src, preferring an open modal so a photo that
	// also sits in the feed behind the modal doesn't win.
	findImgBySrc(src) {
		if (!src) return null;
		const scopes = [document.querySelector('div[role="dialog"]'), document];
		for (const sc of scopes) {
			if (!sc) continue;
			const imgs = sc.querySelectorAll('img');
			for (const im of imgs) { if (im.src === src || im.currentSrc === src) return im; }
		}
		return null;
	},

	// The DOM container for the ONE post the user acted on: the clicked media's
	// post, else the open post modal, else the single article on a permalink page.
	igPostRoot(info) {
		const dialog = document.querySelector('div[role="dialog"]');
		if (info && info.srcUrl) {
			const el = this.findImgBySrc(info.srcUrl);
			if (el) {
				// In a post modal the caption sits in a side panel OUTSIDE the media's
				// <article>, so the whole dialog (media + caption) is the post.
				if (dialog && dialog.contains(el)) return dialog;
				return el.closest('article') || el.closest('a[href*="/p/"], a[href*="/reel/"]') || el.parentElement || document.body;
			}
		}
		if (dialog) return dialog;
		return document.querySelector('article') || document.body;
	},

	// Post kind + shortcode from the clicked link, the post's own permalink, or the URL.
	igPostRef(info, root) {
		const cands = [];
		if (info && info.linkUrl) cands.push(info.linkUrl);
		if (root && root.querySelector) {
			const a = root.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]');
			if (a) cands.push(a.href);
		}
		cands.push(location.href);
		for (const c of cands) {
			const m = c && c.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
			if (m) return { kind: m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase(), code: m[2] };
		}
		return null;
	},

	// Caption for THIS post, read from the DOM (og:description is page-level and
	// goes stale as you navigate Instagram's single-page app).
	// Extract usable caption text from one element: drop a leading username link
	// ("username caption...") and obvious UI strings.
	igCaptionText(el) {
		let t = this.cleanText(el.textContent);
		if (!t) return '';
		const a = el.querySelector('a[href^="/"]');
		if (a) {
			let p = '';
			try { p = new URL(a.href, location.origin).pathname; } catch (e) { p = ''; }
			const isProfile = /^\/[^\/]+\/?$/.test(p) && !/^\/(explore|p|reel|reels|tv|stories|accounts)\b/.test(p);
			if (isProfile) {
				const uname = this.cleanText(a.textContent);
				if (uname && t.indexOf(uname) === 0) t = t.slice(uname.length).trim();
			}
		}
		if (t.length < 2) return '';
		if (/^(log ?in|sign up|log into instagram|follow|following|see more|view all|view replies|reply|share|save|more options|liked by|likes?$|comments?$|see translation|translation|original audio|suggested for you|verified)/i.test(t)) return '';
		return t;
	},

	igCaption(root) {
		if (!root || !root.querySelectorAll) root = document.body;
		const h1 = root.querySelector('h1');
		if (h1) { const t = this.igCaptionText(h1); if (t) return t; }
		const blocks = [];
		root.querySelectorAll('[dir="auto"]').forEach((el) => {
			if (el.closest('header')) return; // author / handle
			// Take the outermost dir="auto" block, not its nested spans.
			if (el.parentElement && el.parentElement.closest('[dir="auto"]')) return;
			const t = this.igCaptionText(el);
			if (!t) return;
			blocks.push({ t: t, inUl: !!el.closest('ul'), len: t.length });
		});
		// Prefer a block that is NOT in the comment list; among those, the longest.
		const nonUl = blocks.filter((b) => !b.inUl).sort((a, b) => b.len - a.len);
		if (nonUl.length) return nonUl[0].t;
		// Some layouts render the caption as the first item of the comments list.
		if (blocks.length) return blocks[0].t;
		// Only trust the page-level og:description on a genuine single-post page.
		if (document.querySelectorAll('article').length <= 1) {
			return this.meta(['og:description', 'description']) || '';
		}
		return '';
	},

	// True for real Instagram MEDIA URLs (scontent / fbcdn), false for UI assets
	// like the Instagram logo, which is served from static.cdninstagram.com and
	// would otherwise be picked up by a naive "contains cdninstagram" test.
	igMedia(u) { return !!u && /^https?:/i.test(u) && /(scontent|fbcdn)/i.test(u) && !/static\./i.test(u); },

	// Images for THIS post only, excluding avatars/profile pictures and UI assets.
	igImages(root, info) {
		const out = [];
		if (info && info.srcUrl && info.mediaType === 'image' && this.igMedia(info.srcUrl)) this.push(out, info.srcUrl);
		const scope = (root && root.querySelectorAll) ? root : document;
		scope.querySelectorAll('img').forEach((im) => {
			if (out.length >= 8) return;
			const s = im.currentSrc || im.src;
			if (!this.igMedia(s)) return;
			if (im.closest('header')) return;
			const alt = (im.alt || '').toLowerCase();
			if (alt.includes('profile picture')) return;
			const w = im.naturalWidth || im.width || 0;
			if (w && w < 150) return;
			this.push(out, s);
		});
		return out;
	},

	// Poster frame for a reel/video, scoped to THIS post. Never the page-level
	// og:image, which is the first reel that loaded (stale in Instagram's SPA).
	igVideoPoster(root, info) {
		if (info && info.srcUrl && info.mediaType === 'image' && this.igMedia(info.srcUrl)) return info.srcUrl;
		if (!root || !root.querySelector) return '';
		const v = root.querySelector('video');
		if (v) {
			const p = v.getAttribute('poster') || v.poster || '';
			if (this.igMedia(p)) return p;
		}
		const imgs = root.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]');
		for (const img of imgs) {
			if (img.closest('header') || /profile picture/i.test(img.alt || '')) continue;
			const s = img.currentSrc || img.src;
			if (this.igMedia(s)) return s;
		}
		return '';
	},

	// Best-effort: the real reel .mp4 URL, which Instagram ships inside inline JSON
	// (video_versions / video_url). These scontent/fbcdn URLs are fetchable in the
	// logged-in browser, so the popup can download the reel and store it in Curio.
	igVideoUrl(ref) {
		const texts = [];
		document.querySelectorAll('script').forEach((s) => {
			const t = s.textContent || '';
			if (t.length < 40) return;
			if (t.includes('video_versions') || t.includes('"video_url"')) texts.push(t);
		});
		if (!texts.length) return '';
		const unesc = (u) => u.replace(/\\u0026/gi, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
		const collect = (text) => {
			const out = [];
			let m;
			const res = [/"video_url":"(https:[^"]+?\.mp4[^"]*)"/g, /"url":"(https:[^"]+?\.mp4[^"]*)"/g];
			for (const re of res) { while ((m = re.exec(text)) !== null) { const u = unesc(m[1]); if (/scontent|fbcdn/i.test(u)) out.push(u); } }
			return out;
		};
		const code = ref && ref.code ? ref.code : '';
		let pool = [];
		if (code) { for (const t of texts) { if (t.includes(code)) pool = pool.concat(collect(t)); } }
		if (!pool.length) { for (const t of texts) pool = pool.concat(collect(t)); }
		pool = [...new Set(pool)];
		return pool[0] || '';
	},

	instagram(data, info) {
		const root = this.igPostRoot(info);
		const ref = this.igPostRef(info, root);

		// Caption from the DOM of THIS post, run raw through the popup's cleanup later.
		data.description = this.igCaption(root) || '';
		data.title = ''; // the real title is derived from the caption by Cleanup.refineMeta; blank beats a generic "Instagram"

		const hasVideo = !!(root && root.querySelector && root.querySelector('video'));
		let isVideo;
		if (ref && (ref.kind === 'reel' || ref.kind === 'tv')) { isVideo = true; data.url = location.origin + '/reel/' + ref.code + '/'; }
		else if (ref) { isVideo = hasVideo && !(info && info.mediaType === 'image'); data.url = location.origin + '/' + (isVideo ? 'reel' : 'p') + '/' + ref.code + '/'; }
		else { isVideo = hasVideo && !(info && info.mediaType === 'image'); }

		// A specifically targeted image always forces a photo clip.
		if (info && info.srcUrl && info.mediaType === 'image') isVideo = false;
		data.kind = isVideo ? 'video' : 'image';

		if (isVideo) {
			// Scope the poster to THIS reel; do NOT fall back to the stale page og:image.
			const poster = this.igVideoPoster(root, info);
			data.images = poster ? [poster] : [];
			data.image = poster || '';
			data.video = { provider: 'instagram', id: (ref && ref.code) || '', embed: (data.url || (location.origin + '/')) + 'embed' };
			// The real mp4, so the popup can download and store the reel as a playable file.
			data.videoFileUrl = this.igVideoUrl(ref);
		} else {
			let imgs = this.igImages(root, info);
			// Photo permalink pages (one article) can safely use og:image if nothing scoped was found.
			if (!imgs.length && document.querySelectorAll('article').length <= 1) {
				const og = this.meta(['og:image:secure_url', 'og:image']);
				if (og) imgs = [og];
			}
			data.images = imgs;
			data.image = imgs[0] || '';
			if (info && info.srcUrl && info.mediaType === 'image') {
				this.unshift(data.images, info.srcUrl);
				data.image = info.srcUrl;
			}
		}
	},

	youtube(data, info) {
		data.kind = 'video';
		// Watch pages, youtu.be, AND Shorts (/shorts/ID). Prefer a clicked link so a
		// Short's thumbnail in a feed clips that Short, not the page.
		const srcs = [(info && info.linkUrl) || '', location.href];
		let id = '';
		for (const s of srcs) {
			let m;
			if ((m = s.match(/[?&]v=([\w-]{6,})/))) { id = m[1]; break; }
			if ((m = s.match(/youtu\.be\/([\w-]{6,})/))) { id = m[1]; break; }
			if ((m = s.match(/\/shorts\/([\w-]{6,})/))) { id = m[1]; break; }
			if ((m = s.match(/\/embed\/([\w-]{6,})/))) { id = m[1]; break; }
		}
		if (id) {
			data.url = 'https://www.youtube.com/watch?v=' + id;
			data.video = { provider: 'youtube', id: id, embed: 'https://www.youtube.com/embed/' + id, thumb: 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg' };
		}
		data.title = this.meta(['og:title']) || document.title.replace(/\s*-\s*YouTube$/, '');
		const og = this.meta(['og:image']);
		if (og) { data.image = og; data.images = [og]; }
		else if (data.video) { data.image = data.video.thumb; data.images = [data.video.thumb]; }
		data.description = this.meta(['og:description']) || data.description;
	},

	vimeo(data, info) {
		data.kind = 'video';
		data.title = this.meta(['og:title']) || document.title;
		const og = this.meta(['og:image']);
		if (og) { data.image = og; data.images = [og]; }
		data.description = this.meta(['og:description']) || data.description;
	},

	// The closeup container for the pin the user acted on (Pinterest is also an SPA,
	// so og:* and a whole-page image sweep are wrong once you open a pin).
	pinRoot(info) {
		const CLOSEUP = '[data-test-id="closeup"], [data-test-id="CloseupMainPin"], [data-test-id="pin-closeup"], [data-test-id="pin"], div[role="dialog"]';
		if (info && info.srcUrl) {
			const el = this.findImgBySrc(info.srcUrl);
			if (el) return el.closest(CLOSEUP) || el.closest('[data-test-id="pinWrapper"]') || el.closest('a[href*="/pin/"]') || el.parentElement;
		}
		return document.querySelector(CLOSEUP) || document.querySelector('main') || document.body;
	},

	pinText(root, selectors) {
		const scope = (root && root.querySelector) ? root : document;
		for (const sel of selectors) {
			const el = scope.querySelector(sel);
			if (el) { const t = this.cleanText(el.textContent); if (t) return t; }
		}
		return '';
	},

	pinRef(info, root) {
		const cands = [];
		if (info && info.linkUrl) cands.push(info.linkUrl);
		if (root && root.querySelector) { const a = root.querySelector('a[href*="/pin/"]'); if (a) cands.push(a.href); }
		cands.push(location.href);
		for (const c of cands) { const m = c && c.match(/\/pin\/(\d+)/); if (m) return m[1]; }
		return null;
	},

	pinImages(root, info) {
		const out = [];
		if (info && info.srcUrl && info.mediaType === 'image') this.push(out, info.srcUrl);
		const scope = (root && root.querySelectorAll) ? root : document;
		scope.querySelectorAll('img').forEach((im) => {
			if (out.length >= 6) return;
			const s = im.currentSrc || im.src;
			if (!s || !/pinimg\.com/i.test(s)) return;
			if (/\/(30x30|60x60|75x75|140x140|avatar)/i.test(s)) return; // avatars / tiny
			const w = im.naturalWidth || im.width || 0;
			if (w && w < 150) return;
			this.push(out, s);
		});
		return out;
	},

	pinterest(data, info) {
		const root = this.pinRoot(info);
		data.kind = 'image';

		const title = this.pinText(root, ['[data-test-id="pinTitle"]', '[data-test-id="closeup-title"]', '[data-test-id="CloseupTitle"]', 'h1']);
		const desc = this.pinText(root, [
			'[data-test-id="pin-closeup-description"]', '[data-test-id="closeup-description"]',
			'[data-test-id="main-pin-description-text"]', '[data-test-id="CloseupDescriptionContainer"]',
			'[data-test-id="pinDescription"]', '[data-test-id="description"]',
		]);
		data.title = title || this.meta(['og:title']) || document.title || 'Pinterest';
		if (desc) data.description = desc;
		else if (document.querySelectorAll('[data-test-id="closeup"], [data-test-id="CloseupMainPin"]').length <= 1) data.description = this.meta(['og:description', 'description']) || '';
		else data.description = '';

		const imgs = this.pinImages(root, info);
		if (imgs.length) { data.images = imgs; data.image = imgs[0]; }

		if (info && info.srcUrl && info.mediaType === 'image') {
			this.unshift(data.images, info.srcUrl);
			data.image = info.srcUrl;
		}
		const ref = this.pinRef(info, root);
		if (ref) data.url = 'https://www.pinterest.com/pin/' + ref + '/';
	},

	generic(data, info) {
		if (info.srcUrl && info.mediaType === 'image') {
			data.kind = 'image';
			this.unshift(data.images, info.srcUrl);
			data.image = info.srcUrl;
		} else if (info.srcUrl && info.mediaType === 'video') {
			data.kind = 'video';
			if (info.srcUrl && /^https?:/i.test(info.srcUrl)) data.video = { provider: 'file', src: info.srcUrl };
		} else if (/\.(png|jpe?g|gif|webp|avif|svg)($|[?#])/i.test(data.url)) {
			data.kind = 'image_url';
		} else if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(data.url)) {
			data.kind = 'video';
		}
		// A few sizeable page images as extra choices for the picker.
		const extra = [];
		document.querySelectorAll('img[src]').forEach(el => {
			if (extra.length >= 8) return;
			const s = el.currentSrc || el.src;
			const w = el.naturalWidth || el.width || 0;
			if (s && /^https?:/i.test(s) && w >= 200) this.push(extra, s);
		});
		extra.forEach(s => this.push(data.images, s));
		if (!data.image && data.images.length) data.image = data.images[0];
	},

	// Given a clicked element, synthesize a context-info object for page().
	fromElement(el) {
		const info = { pageUrl: location.href };
		if (!el) return info;
		const tag = el.tagName ? el.tagName.toLowerCase() : '';
		if (tag === 'img' || (tag === 'image')) {
			info.srcUrl = el.currentSrc || el.src;
			info.mediaType = 'image';
		} else if (tag === 'video') {
			const src = el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src);
			info.srcUrl = src;
			info.mediaType = 'video';
		} else {
			// Look for an enclosing/related media element or link.
			const img = el.closest && (el.closest('a') && el.closest('a').querySelector && el.closest('a').querySelector('img'));
			const link = el.closest && el.closest('a[href]');
			const media = el.querySelector && el.querySelector('img, video');
			if (img) { info.srcUrl = img.currentSrc || img.src; info.mediaType = 'image'; }
			else if (media && media.tagName.toLowerCase() === 'img') { info.srcUrl = media.currentSrc || media.src; info.mediaType = 'image'; }
			else if (media && media.tagName.toLowerCase() === 'video') { info.srcUrl = media.currentSrc || media.src; info.mediaType = 'video'; }
			if (link) info.linkUrl = link.href;
		}
		return info;
	},
};
