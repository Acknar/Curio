// extract.js - turns whatever was shared into the app (a link from Instagram,
// Pinterest, TikTok, X, Reddit, YouTube, a browser...) into the same clip payload
// the browser extension built from the page DOM:
//   { url, pageUrl, site, title, description, image, images[], video, videoFileUrl,
//     selection, kind, geo, placeHint, imageHeaders, via[], notes[] }
//
// Everything here runs on the phone, through CurioNative.http (native, no CORS,
// the phone's own connection) and, as a last resort, CurioNative.render (a hidden
// WebView carrying the user's in-app site sign-ins, running page-extractors.js).
// Each platform has a chain of sources tried in order; the first that yields a
// caption wins and later ones only fill gaps.

/* global CurioNative, DOMParser */
const Extract = {
	UA_CRAWLER: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	UA_DESKTOP: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
	IG_APP_ID: '936619743392459',

	// Overridable in tests.
	http(spec) { return CurioNative.http(spec); },
	render(url, info, timeoutMs) { return CurioNative.render(url, info, timeoutMs); },
	sessions() { return CurioNative.siteSessions(); },
	progress() {},

	/* ---------------- entry point ---------------- */

	// share: { text, subject, title, files[], processText }
	async run(share) {
		share = share || {};
		const files = Array.isArray(share.files) ? share.files : [];
		if (files.length) return this.fromFile(files[0], share);

		const text = String(share.text || '').trim();
		const found = this.findUrl(text);
		if (!found) {
			return this.blank({ kind: 'text', selection: text, title: String(share.subject || share.title || '').trim() });
		}

		let url = this.cleanUrl(found);
		// Text the sharing app put around the link ("Check out this Pin!", a caption...).
		const extraText = text.replace(found, ' ').replace(/\s+/g, ' ').trim();

		this.progress('Opening link...');
		url = await this.resolveShort(url);
		url = this.cleanUrl(url);

		const site = this.site(url);
		const out = this.blank({ url: url, pageUrl: url, site: site, kind: 'link' });
		const subject = String(share.subject || share.title || '').trim();

		try {
			const fn = this.sites[site];
			if (fn) await fn.call(this, out);
			else await this.web(out);
		} catch (e) {
			out.notes.push('Extractor error: ' + (e && e.message ? e.message : e));
		}

		// Nothing usable from plain fetches: render the page like a browser would.
		if (!out.description && !out.images.length && site !== 'youtube' && site !== 'vimeo') {
			await this.viaRender(out);
		}

		if (!out.title && subject && subject !== url) out.title = subject;
		if (!out.description && extraText && !/^https?:/i.test(extraText) && !this.isBoilerplate(extraText)) out.description = extraText;
		if (!out.image && out.images.length) out.image = out.images[0];
		return out;
	},

	blank(extra) {
		return Object.assign({
			url: '', pageUrl: '', site: 'web', title: '', description: '',
			image: '', images: [], video: null, videoFileUrl: '', selection: '', kind: 'link',
			geo: null, placeHint: '', imageHeaders: {}, via: [], notes: [], file: null,
		}, extra || {});
	},

	fromFile(f, share) {
		const mime = String(f.mime || '').toLowerCase();
		const name = String(f.name || 'shared');
		let kind = 'file-image';
		if (mime.startsWith('video/')) kind = 'file-video';
		else if (mime === 'application/pdf' || /\.pdf$/i.test(name)) kind = 'file-pdf';
		const title = String(share.subject || share.title || '').trim() || name.replace(/\.[^.]+$/, '');
		return this.blank({ kind: kind, file: f, title: title, description: String(share.text || '').trim(), site: 'file' });
	},

	/* ---------------- URL helpers ---------------- */

	findUrl(text) {
		const m = String(text || '').match(/https?:\/\/[^\s<>"'`]+/i);
		if (!m) return '';
		return m[0].replace(/[),.!?;:'"\]]+$/, '');
	},

	// Drop share-tracking parameters so the saved source URL is clean and dedupes.
	cleanUrl(url) {
		let u;
		try { u = new URL(url); } catch (e) { return url; }
		const host = u.hostname.toLowerCase();
		const drop = ['igsh', 'igshid', 'fbclid', 'gclid', 'mibextid', 'si', 'share_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_name', '_r', 'rdt', 'ref_src', 'ref_url', 'invite_code', 'sender_device', 'sender_web_id', 'is_from_webapp', 'is_copy_url', 'web_id', '_t', 'sharer_id', 'share_app_id', 'share_link_id', 'share_item_id', 'tt_from', 'u_code', 'social_sharing', 'xmt', 'slof'];
		if (/(^|\.)(x|twitter)\.com$/.test(host)) drop.push('s', 't');
		if (/(^|\.)pinterest\./.test(host)) drop.push('invite_code', 'sfo', 'amp_client_id', 'mweb_unauth_id');
		for (const k of Array.from(u.searchParams.keys())) {
			if (drop.includes(k) || /^utm_/.test(k)) u.searchParams.delete(k);
		}
		// Facebook's link shim wraps the real target in ?u=.
		if (/^l\.facebook\.com$|^lm\.facebook\.com$/.test(host) && u.searchParams.get('u')) return this.cleanUrl(u.searchParams.get('u'));
		let s = u.toString();
		if (s.endsWith('?')) s = s.slice(0, -1);
		return s;
	},

	isShort(url) {
		let h = '';
		let p = '';
		try { const u = new URL(url); h = u.hostname.toLowerCase().replace(/^www\./, ''); p = u.pathname; } catch (e) { return false; }
		if (/^(pin\.it|vm\.tiktok\.com|vt\.tiktok\.com|t\.co|fb\.watch|instagr\.am|bit\.ly|tinyurl\.com|ow\.ly|buff\.ly|goo\.gl|a\.co|amzn\.to|redd\.it|lnkd\.in|t\.ly|shorturl\.at|on\.soundcloud\.com|spoti\.fi|link\.chtbl\.com)$/.test(h)) return true;
		if (/(^|\.)tiktok\.com$/.test(h) && /^\/t\//.test(p)) return true;
		if (/(^|\.)reddit\.com$/.test(h) && /\/s\/[A-Za-z0-9]+/.test(p)) return true;
		if (/(^|\.)facebook\.com$/.test(h) && /^\/share\//.test(p)) return true;
		if (/(^|\.)pinterest\.[a-z.]+$/.test(h) && /^\/url_shortener\//.test(p)) return true;
		return false;
	},

	async resolveShort(url) {
		if (!this.isShort(url)) return url;
		const res = await this.http({ url: url, headers: { 'User-Agent': this.UA_DESKTOP }, maxBytes: 200000, timeoutMs: 15000 });
		if (res.error) return url;
		let final = res.url || url;
		// Some shorteners answer with a page that redirects by meta refresh or script.
		if (final === url && res.body) {
			const m = res.body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i)
				|| res.body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)
				|| res.body.match(/(?:location\.href|location\.replace\()\s*=?\s*["'](https?:[^"']+)/i);
			if (m) final = this.decodeHtml(m[1]);
		}
		return final;
	},

	site(url) {
		let h = '';
		try { h = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, ''); } catch (e) { return 'web'; }
		if (/(^|\.)instagram\.com$/.test(h) || h === 'instagr.am') return 'instagram';
		if (/(^|\.)pinterest\.[a-z.]+$/.test(h)) return 'pinterest';
		if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
		if (/(^|\.)(x|twitter)\.com$/.test(h) || h === 'fxtwitter.com' || h === 'vxtwitter.com') return 'x';
		if (/(^|\.)reddit\.com$/.test(h)) return 'reddit';
		if (/(^|\.)youtube\.com$/.test(h) || h === 'youtu.be') return 'youtube';
		if (/(^|\.)vimeo\.com$/.test(h)) return 'vimeo';
		if (/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/.test(h)) return 'facebook';
		if (/(^|\.)threads\.(net|com)$/.test(h)) return 'threads';
		return 'web';
	},

	/* ---------------- generic parsing ---------------- */

	parseHtml(html) {
		return new DOMParser().parseFromString(String(html || ''), 'text/html');
	},

	decodeHtml(s) {
		const d = this.parseHtml('<textarea>' + String(s || '').replace(/</g, '&lt;') + '</textarea>');
		const t = d.querySelector('textarea');
		return t ? t.value : String(s || '');
	},

	meta(doc, names) {
		for (const n of names) {
			const el = doc.querySelector('meta[property="' + n + '"], meta[name="' + n + '"], meta[itemprop="' + n + '"]');
			const v = el && (el.getAttribute('content') || '').trim();
			if (v) return v;
		}
		return '';
	},

	metaAll(doc, name) {
		return Array.from(doc.querySelectorAll('meta[property="' + name + '"], meta[name="' + name + '"]'))
			.map((el) => (el.getAttribute('content') || '').trim()).filter(Boolean);
	},

	abs(u, base) {
		if (!u) return '';
		try { return new URL(this.decodeEntities(u), base).toString(); } catch (e) { return ''; }
	},

	decodeEntities(s) {
		return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
	},

	pushImg(out, u) {
		if (!u || !/^https?:/i.test(u)) return;
		if (!out.images.includes(u)) out.images.push(u);
	},

	// og / twitter / JSON-LD metadata of a fetched page.
	pageMeta(html, base) {
		const doc = this.parseHtml(html);
		const r = {
			title: this.meta(doc, ['og:title', 'twitter:title']) || (doc.querySelector('title') ? doc.querySelector('title').textContent.trim() : ''),
			description: this.meta(doc, ['og:description', 'twitter:description', 'description']),
			images: [],
			video: this.meta(doc, ['og:video:secure_url', 'og:video:url', 'og:video']),
			type: this.meta(doc, ['og:type']),
			siteName: this.meta(doc, ['og:site_name']),
			canonical: '',
			jsonld: [],
			doc: doc,
		};
		const canon = doc.querySelector('link[rel="canonical"]');
		if (canon) r.canonical = this.abs(canon.getAttribute('href'), base);
		for (const n of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
			for (const v of this.metaAll(doc, n)) { const a = this.abs(v, base); if (a && !r.images.includes(a)) r.images.push(a); }
		}
		doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
			try { r.jsonld.push(JSON.parse(s.textContent)); } catch (e) { /* invalid JSON-LD */ }
		});
		if (!r.description || !r.images.length) {
			for (const node of this.walk(r.jsonld)) {
				if (!r.description && typeof node.description === 'string') r.description = node.description;
				if (!r.images.length && node.image) {
					const im = Array.isArray(node.image) ? node.image[0] : node.image;
					const u = typeof im === 'string' ? im : (im && (im.url || im.contentUrl));
					if (u) r.images.push(this.abs(u, base));
				}
			}
		}
		return r;
	},

	// Depth-first walk over every object in a JSON value.
	* walk(v, depth) {
		depth = depth || 0;
		if (depth > 40 || v == null || typeof v !== 'object') return;
		if (!Array.isArray(v)) yield v;
		for (const k in v) {
			if (Object.prototype.hasOwnProperty.call(v, k) && v[k] && typeof v[k] === 'object') yield* this.walk(v[k], depth + 1);
		}
	},

	async getText(url, ua, extraHeaders, cookies) {
		const headers = Object.assign({ 'User-Agent': ua || this.UA_DESKTOP, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': this.lang() }, extraHeaders || {});
		const res = await this.http({ url: url, headers: headers, cookies: !!cookies, maxBytes: 4 * 1024 * 1024 });
		if (res.error || res.status >= 400) return null;
		return res;
	},

	async getJson(url, headers, cookies) {
		const res = await this.http({ url: url, headers: Object.assign({ 'User-Agent': this.UA_DESKTOP, 'Accept': 'application/json, text/plain, */*' }, headers || {}), cookies: !!cookies, maxBytes: 4 * 1024 * 1024 });
		if (res.error || res.status >= 400 || !res.body) return null;
		try { return JSON.parse(res.body); } catch (e) { return null; }
	},

	lang() {
		const l = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US';
		return l + ',en;q=0.8';
	},

	isBoilerplate(t) {
		return /^(check out|look at|see|view) (this|my|the) /i.test(t) && t.length < 60;
	},

	fill(out, part, via) {
		if (!part) return false;
		let used = false;
		if (part.title && !out.title) { out.title = part.title; used = true; }
		if (part.description && !out.description) { out.description = part.description; used = true; }
		for (const u of part.images || []) { if (u && !out.images.includes(u)) { out.images.push(u); used = true; } }
		if (part.video && !out.video) { out.video = part.video; used = true; }
		if (part.videoFileUrl && !out.videoFileUrl) { out.videoFileUrl = part.videoFileUrl; used = true; }
		if (part.geo && !out.geo) { out.geo = part.geo; used = true; }
		if (part.placeHint && !out.placeHint) out.placeHint = part.placeHint;
		if (part.kind && (out.kind === 'link' || part.forceKind)) out.kind = part.kind;
		if (used && via) out.via.push(via);
		return used;
	},

	async viaRender(out) {
		this.progress('Rendering the page...');
		let data;
		try { data = await this.render(out.url, {}, 12000); } catch (e) { data = null; }
		if (!data || data.error) return;
		const part = {
			title: data.title || '',
			description: data.description || '',
			images: Array.isArray(data.images) ? data.images : [],
			video: data.video || null,
			videoFileUrl: data.videoFileUrl || '',
		};
		if (data.kind === 'image' || data.kind === 'video') part.kind = data.kind;
		this.fill(out, part, 'render');
	},

	/* ---------------- generic web ---------------- */

	async web(out) {
		this.progress('Reading the page...');
		const res = await this.getText(out.url, this.UA_DESKTOP);
		if (res && /html|xml/i.test(res.contentType || 'text/html')) {
			const m = this.pageMeta(res.body, res.url || out.url);
			this.fill(out, { title: m.title, description: m.description, images: m.images }, 'page');
			if (m.video && /\.(mp4|webm)(\?|$)/i.test(m.video)) { out.kind = 'video'; out.video = { provider: 'file', src: m.video }; }
		} else if (res && /^image\//i.test(res.contentType || '')) {
			out.kind = 'image_url';
			this.pushImg(out, out.url);
		} else if (res && /pdf/i.test(res.contentType || '')) {
			out.kind = 'pdf';
		}
	},

	/* ---------------- platform chains ---------------- */

	sites: {
		async instagram(out) {
			const ref = this.igRef(out.url);
			if (!ref) return this.web(out);
			out.url = 'https://www.instagram.com/' + (ref.kind === 'tv' ? 'reel' : ref.kind) + '/' + ref.code + '/';
			out.pageUrl = out.url;
			out.kind = ref.kind === 'p' ? 'image' : 'video';
			if (out.kind === 'video') out.video = { provider: 'instagram', id: ref.code, embed: out.url + 'embed' };

			// 1. Signed in to Instagram in the app: the private web API has everything
			//    (full caption, every carousel image, the reel mp4, the tagged location).
			if (this.sessions().instagram) {
				this.progress('Reading the Instagram post...');
				const item = await this.igApi(ref.code, out.url);
				if (item) this.fill(out, this.igFromItem(item), 'instagram-api');
			}
			// 2. Public embed page: caption + uncropped image, no sign-in needed.
			if (!out.description || !out.images.length) {
				this.progress('Reading the Instagram post...');
				const part = await this.igEmbed(ref);
				if (part) this.fill(out, part, 'instagram-embed');
			}
			// 3. Crawler-facing page: og:description holds the caption.
			if (!out.description || !out.images.length) {
				const res = await this.getText(out.url, this.UA_CRAWLER);
				if (res && res.body) {
					const m = this.pageMeta(res.body, out.url);
					if (!/^(instagram|login|log in)/i.test(m.title || '') || m.description) {
						this.fill(out, { description: m.description, images: m.images }, 'instagram-page');
					}
				}
			}
			// A post the sources above revealed to be a video embeds as a reel.
			if (out.kind === 'video' && !out.video) out.video = { provider: 'instagram', id: ref.code, embed: 'https://www.instagram.com/reel/' + ref.code + '/embed' };
			// Without a sign-in and without the embed, all we have is a preview (or nothing):
			// suggest signing in. A still-empty result goes on to the render fallback in run().
			if (!this.sessions().instagram && !out.via.includes('instagram-embed')) {
				out.notes.push('instagram-signin');
			}
		},

		async pinterest(out) {
			const id = this.pinId(out.url);
			if (!id) return this.web(out);
			out.url = 'https://www.pinterest.com/pin/' + id + '/';
			out.pageUrl = out.url;
			out.kind = 'image';

			this.progress('Reading the Pin...');
			const info = await this.getJson('https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=' + encodeURIComponent(id));
			const pin = info && Array.isArray(info.data) ? info.data[0] : null;
			if (pin) this.fill(out, this.pinFromData(pin), 'pinterest-widget');

			if (!out.description || !out.images.length || !out.title) {
				const res = await this.getText(out.url, this.UA_DESKTOP);
				if (res && res.body) {
					const part = this.pinFromPage(res.body, id, out.url);
					this.fill(out, part, 'pinterest-page');
				}
			}
		},

		async tiktok(out) {
			this.progress('Reading the TikTok...');
			out.kind = 'image';
			out.imageHeaders = { Referer: 'https://www.tiktok.com/' };
			const o = await this.getJson('https://www.tiktok.com/oembed?url=' + encodeURIComponent(out.url));
			if (o && (o.title || o.thumbnail_url)) {
				this.fill(out, { description: o.title || '', images: o.thumbnail_url ? [o.thumbnail_url] : [] }, 'tiktok-oembed');
				if (o.author_unique_id) out.author = o.author_unique_id;
			}
			// The page carries the full caption, a better cover and the tagged place.
			const res = await this.getText(out.url, this.UA_DESKTOP);
			if (res && res.body) this.fill(out, this.tiktokFromPage(res.body), 'tiktok-page');
		},

		async x(out) {
			const m = out.url.match(/\/status(?:es)?\/(\d+)/);
			if (!m) return this.web(out);
			const id = m[1];
			this.progress('Reading the post...');
			const t = await this.getJson('https://cdn.syndication.twimg.com/tweet-result?id=' + id + '&lang=en&token=' + this.tweetToken(id));
			if (t && (t.text || t.full_text)) {
				this.fill(out, this.tweetFromData(t), 'x-syndication');
			} else {
				const o = await this.getJson('https://publish.twitter.com/oembed?omit_script=1&url=' + encodeURIComponent(out.url));
				if (o && o.html) {
					const doc = this.parseHtml(o.html);
					const p = doc.querySelector('p');
					this.fill(out, { description: p ? p.textContent.trim() : '' }, 'x-oembed');
				}
			}
		},

		async reddit(out) {
			this.progress('Reading the Reddit post...');
			let u;
			try { u = new URL(out.url); } catch (e) { return this.web(out); }
			if (!/\/comments\//.test(u.pathname)) return this.web(out);
			const jsonUrl = 'https://www.reddit.com' + u.pathname.replace(/\/+$/, '') + '.json?raw_json=1&limit=1';
			const data = await this.getJson(jsonUrl, { 'User-Agent': 'android:com.acknar.curio:1.0 (Curio clipper)' });
			const post = data && data[0] && data[0].data && data[0].data.children && data[0].data.children[0] ? data[0].data.children[0].data : null;
			if (post) this.fill(out, this.redditFromPost(post), 'reddit-json');
			else await this.web(out);
		},

		async youtube(out) {
			const vid = this.youtubeId(out.url);
			out.kind = 'video';
			if (vid) {
				out.url = 'https://www.youtube.com/watch?v=' + vid;
				out.video = { provider: 'youtube', id: vid, embed: 'https://www.youtube.com/embed/' + vid, thumb: 'https://img.youtube.com/vi/' + vid + '/hqdefault.jpg' };
			}
			this.progress('Reading the video...');
			const o = await this.getJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(out.url));
			if (o) this.fill(out, { title: o.title || '', images: o.thumbnail_url ? [o.thumbnail_url] : [] }, 'youtube-oembed');
			const res = await this.getText(out.url, this.UA_DESKTOP);
			if (res && res.body) {
				const d = this.youtubeDescription(res.body);
				if (d) this.fill(out, { description: d }, 'youtube-page');
			}
			if (out.video && out.video.thumb) this.pushImg(out, out.video.thumb);
		},

		async vimeo(out) {
			out.kind = 'video';
			const m = out.url.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
			if (m) out.video = { provider: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] };
			const o = await this.getJson('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(out.url));
			if (o) this.fill(out, { title: o.title || '', description: o.description || '', images: o.thumbnail_url ? [o.thumbnail_url] : [] }, 'vimeo-oembed');
		},

		async facebook(out) {
			this.progress('Reading the post...');
			const res = await this.getText(out.url, this.UA_CRAWLER);
			if (res && res.body) {
				const m = this.pageMeta(res.body, res.url || out.url);
				if (!/^(facebook|log in|log into)/i.test(m.title || '') || m.description) {
					this.fill(out, { title: m.title, description: m.description, images: m.images }, 'facebook-page');
					if (m.images.length) out.kind = 'image';
				}
				if (res.url) out.url = this.cleanUrl(res.url);
			}
		},

		async threads(out) {
			this.progress('Reading the post...');
			const res = await this.getText(out.url, this.UA_CRAWLER);
			if (res && res.body) {
				const m = this.pageMeta(res.body, out.url);
				this.fill(out, { description: m.description, images: m.images }, 'threads-page');
				if (m.images.length) out.kind = 'image';
			}
		},
	},

	/* ---------------- Instagram ---------------- */

	igRef(url) {
		const m = String(url || '').match(/(?:instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
		if (!m) return null;
		const k = m[1].toLowerCase();
		return { kind: k === 'reels' ? 'reel' : k, code: m[2] };
	},

	// Shortcode -> numeric media id (base64url digits). Long private-post codes carry
	// the media id in their first 11 characters.
	igPk(code) {
		const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
		const c = code.length > 11 ? code.slice(0, 11) : code;
		let n = BigInt(0);
		for (const ch of c) {
			const i = A.indexOf(ch);
			if (i < 0) return '';
			n = n * BigInt(64) + BigInt(i);
		}
		return n.toString();
	},

	async igApi(code, referer) {
		const pk = this.igPk(code);
		if (!pk) return null;
		const data = await this.getJson('https://www.instagram.com/api/v1/media/' + pk + '/info/', {
			'X-IG-App-ID': this.IG_APP_ID,
			'X-Requested-With': 'XMLHttpRequest',
			'X-ASBD-ID': '129477',
			'Referer': referer,
			'User-Agent': this.UA_DESKTOP,
		}, true);
		return data && Array.isArray(data.items) && data.items[0] ? data.items[0] : null;
	},

	igBest(versions) {
		const cands = versions && Array.isArray(versions.candidates) ? versions.candidates : [];
		let best = null;
		for (const c of cands) { if (c && c.url && (!best || (c.width || 0) > (best.width || 0))) best = c; }
		return best ? best.url : '';
	},

	igFromItem(item) {
		const part = { description: item.caption && item.caption.text ? item.caption.text : '', images: [] };
		const children = Array.isArray(item.carousel_media) && item.carousel_media.length ? item.carousel_media : [item];
		for (const ch of children) { const u = this.igBest(ch.image_versions2); if (u && !part.images.includes(u)) part.images.push(u); }
		const vidOwner = (item.video_versions && item.video_versions.length) ? item : children.find((c) => c.video_versions && c.video_versions.length);
		const isReel = item.media_type === 2 || item.product_type === 'clips' || item.product_type === 'igtv';
		if (isReel && vidOwner) {
			part.videoFileUrl = vidOwner.video_versions[0].url;
			part.kind = 'video';
			part.forceKind = true;
		} else if (item.media_type === 1 || item.media_type === 8) {
			part.kind = 'image';
			part.forceKind = true;
		}
		const loc = item.location;
		if (loc && loc.name) {
			if (typeof loc.lat === 'number' && typeof loc.lng === 'number') part.geo = { lat: loc.lat, lng: loc.lng, place: loc.name, source: 'page' };
			else part.placeHint = loc.name;
		}
		return part;
	},

	async igEmbed(ref) {
		const kind = ref.kind === 'p' ? 'p' : 'reel';
		const res = await this.getText('https://www.instagram.com/' + kind + '/' + ref.code + '/embed/captioned/', this.UA_DESKTOP);
		if (!res || !res.body) return null;
		return this.igParseEmbed(res.body);
	},

	igParseEmbed(html) {
		const part = { description: '', images: [] };
		const doc = this.parseHtml(html);

		// Structured data first: the embed ships the post as JSON (contextJSON / gql_data).
		const media = this.igEmbedJson(html);
		if (media) {
			const edges = media.edge_media_to_caption && media.edge_media_to_caption.edges;
			if (edges && edges[0] && edges[0].node && edges[0].node.text) part.description = edges[0].node.text;
			const kids = media.edge_sidecar_to_children && media.edge_sidecar_to_children.edges;
			if (Array.isArray(kids) && kids.length) {
				for (const e of kids) { if (e.node && e.node.display_url) part.images.push(e.node.display_url); }
			} else if (media.display_url) {
				part.images.push(media.display_url);
			}
			if (media.is_video && media.video_url) { part.videoFileUrl = media.video_url; part.kind = 'video'; part.forceKind = true; }
			if (media.location && media.location.name) part.placeHint = media.location.name;
		}

		// The rendered caption block.
		if (!part.description) {
			const cap = doc.querySelector('.Caption');
			if (cap) {
				cap.querySelectorAll('.CaptionUsername, .CaptionComments').forEach((n) => n.remove());
				cap.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
				part.description = cap.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
			}
		}

		const main = doc.querySelector('img.EmbeddedMediaImage');
		if (main) {
			const best = this.largestSrcset(main.getAttribute('srcset')) || main.getAttribute('src');
			if (best && !part.images.includes(best)) part.images.unshift(this.decodeEntities(best));
		}
		if (!part.images.length) {
			doc.querySelectorAll('img').forEach((im) => {
				const s = im.getAttribute('src') || '';
				if (/(scontent|cdninstagram|fbcdn)/i.test(s) && !/s150x150|profile/i.test(s) && !part.images.includes(s)) part.images.push(s);
			});
		}
		return (part.description || part.images.length) ? part : null;
	},

	igEmbedJson(html) {
		// contextJSON is a JSON string literal holding JSON.
		const m = html.match(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/);
		const blobs = [];
		if (m) { try { blobs.push(JSON.parse(JSON.parse(m[1]))); } catch (e) { /* not JSON */ } }
		const m2 = html.match(/__additionalDataLoaded\(\s*['"][^'"]*['"]\s*,\s*(\{[\s\S]*?\})\s*\);/);
		if (m2) { try { blobs.push(JSON.parse(m2[1])); } catch (e) { /* not JSON */ } }
		for (const b of blobs) {
			for (const node of this.walk(b)) {
				if (node.shortcode_media && typeof node.shortcode_media === 'object') return node.shortcode_media;
				if (node.display_url && (node.edge_media_to_caption || node.shortcode)) return node;
			}
		}
		return null;
	},

	largestSrcset(srcset) {
		if (!srcset) return '';
		let best = '';
		let bw = 0;
		for (const part of String(srcset).split(',')) {
			const bits = part.trim().split(/\s+/);
			const w = parseInt((bits[1] || '').replace(/[^\d]/g, ''), 10) || 0;
			if (bits[0] && w >= bw) { bw = w; best = bits[0]; }
		}
		return this.decodeEntities(best);
	},

	/* ---------------- Pinterest ---------------- */

	pinId(url) {
		const m = String(url || '').match(/\/pin\/(?:[^/?#]*--)?(\d{5,})/);
		return m ? m[1] : '';
	},

	pinImageSet(images) {
		const out = [];
		if (!images || typeof images !== 'object') return out;
		let best = null;
		for (const k of Object.keys(images)) {
			const v = images[k];
			if (!v || !v.url) continue;
			if (k === 'orig' || k === 'originals') { best = { url: v.url, width: 1e9 }; break; }
			const w = v.width || parseInt(k, 10) || 0;
			if (!best || w > best.width) best = { url: v.url, width: w };
		}
		if (best) {
			const orig = best.url.replace(/\/\d+x(\d+)?\//, '/originals/');
			if (orig !== best.url) out.push(orig);
			out.push(best.url);
		}
		return out;
	},

	pinFromData(pin) {
		const title = pin.title || pin.grid_title || pin.seo_title || (pin.rich_metadata && pin.rich_metadata.title) || '';
		let desc = pin.description || pin.closeup_unified_description || pin.closeup_description || (pin.rich_metadata && pin.rich_metadata.description) || '';
		if (desc.trim() === title.trim()) desc = '';
		const part = { title: String(title).trim(), description: String(desc).trim(), images: this.pinImageSet(pin.images) };
		// Idea (story) pins keep their pages' images separately.
		const pages = pin.story_pin_data && Array.isArray(pin.story_pin_data.pages) ? pin.story_pin_data.pages : [];
		for (const pg of pages) {
			for (const blk of pg.blocks || []) {
				const imgs = blk.image && blk.image.images;
				for (const u of this.pinImageSet(imgs)) { if (!part.images.includes(u)) part.images.push(u); }
			}
		}
		const vids = pin.videos && pin.videos.video_list;
		if (vids) {
			const pick = Object.values(vids).filter((v) => v && v.url && /\.mp4(\?|$)/i.test(v.url)).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
			if (pick) part.videoFileUrl = pick.url;
		}
		if (pin.link) part.sourceLink = pin.link;
		return part;
	},

	pinFromPage(html, id, base) {
		const m = this.pageMeta(html, base);
		const part = { title: '', description: '', images: [] };
		// The pin's own record inside the page's bootstrap JSON.
		m.doc.querySelectorAll('script[type="application/json"], script#__PWS_DATA__, script#__PWS_INITIAL_PROPS__').forEach((s) => {
			if (part.description && part.images.length) return;
			let data;
			try { data = JSON.parse(s.textContent); } catch (e) { return; }
			for (const node of this.walk(data)) {
				if (String(node.id || node.entityId || '') !== id) continue;
				if (!node.images && !node.description && !node.title && !node.imageSpec_orig) continue;
				const p = this.pinFromData(node);
				if (node.imageSpec_orig && node.imageSpec_orig.url) p.images.unshift(node.imageSpec_orig.url);
				this.fill(part, p);
				if (part.description || part.images.length) break;
			}
		});
		const og = { title: m.title, description: m.description, images: m.images };
		if (/^pinterest$/i.test(og.title || '')) og.title = '';
		this.fill(part, og);
		return part;
	},

	/* ---------------- TikTok ---------------- */

	tiktokFromPage(html) {
		const part = { description: '', images: [] };
		const m = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
			|| html.match(/<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
		if (!m) return part;
		let data;
		try { data = JSON.parse(m[1]); } catch (e) { return part; }
		let item = null;
		for (const node of this.walk(data)) {
			if (node.itemStruct && typeof node.itemStruct === 'object') { item = node.itemStruct; break; }
			if (node.desc !== undefined && node.video && node.author) { item = node; break; }
		}
		if (!item) return part;
		part.description = item.desc || '';
		const v = item.video || {};
		for (const u of [v.originCover, v.cover, v.dynamicCover]) { if (u && !part.images.includes(u)) part.images.push(u); }
		const imgPost = item.imagePost && Array.isArray(item.imagePost.images) ? item.imagePost.images : [];
		for (const im of imgPost) {
			const u = im.imageURL && Array.isArray(im.imageURL.urlList) ? im.imageURL.urlList[0] : '';
			if (u && !part.images.includes(u)) part.images.push(u);
		}
		const poi = item.poi || (item.contents && item.contents.poi);
		if (poi && poi.name) part.placeHint = [poi.name, poi.city || poi.address || ''].filter(Boolean).join(', ');
		return part;
	},

	/* ---------------- X / Twitter ---------------- */

	// Token the public embed endpoint expects (same formula as Twitter's own widget).
	tweetToken(id) {
		return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
	},

	tweetFromData(t) {
		let text = String(t.text || t.full_text || '');
		// Drop trailing t.co media links.
		text = text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, '').replace(/\s*https:\/\/t\.co\/\w+\s*$/g, '').trim();
		const part = { description: text, images: [] };
		for (const md of t.mediaDetails || []) {
			if (md.media_url_https) part.images.push(md.media_url_https + (md.type === 'photo' ? '?name=large' : ''));
			if ((md.type === 'video' || md.type === 'animated_gif') && md.video_info && Array.isArray(md.video_info.variants)) {
				const mp4 = md.video_info.variants.filter((v) => v.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
				if (mp4 && !part.videoFileUrl) { part.videoFileUrl = mp4.url; part.kind = 'video'; }
			}
		}
		if (!part.images.length) for (const p of t.photos || []) { if (p.url) part.images.push(p.url); }
		if (part.images.length && !part.kind) part.kind = 'image';
		if (t.place && t.place.full_name) part.placeHint = t.place.full_name;
		return part;
	},

	/* ---------------- Reddit ---------------- */

	redditFromPost(p) {
		const part = { title: p.title || '', description: p.selftext || '', images: [] };
		const dec = (u) => this.decodeEntities(u || '');
		if (p.media_metadata && p.gallery_data && Array.isArray(p.gallery_data.items)) {
			for (const it of p.gallery_data.items) {
				const mm = p.media_metadata[it.media_id];
				const u = mm && mm.s ? (mm.s.u || mm.s.gif) : '';
				if (u) part.images.push(dec(u));
			}
			part.kind = 'image';
		}
		if (p.post_hint === 'image' && p.url_overridden_by_dest) { part.images.unshift(dec(p.url_overridden_by_dest)); part.kind = 'image'; }
		const prev = p.preview && p.preview.images && p.preview.images[0] && p.preview.images[0].source;
		if (prev && prev.url) part.images.push(dec(prev.url));
		if (p.is_video && p.media && p.media.reddit_video && p.media.reddit_video.fallback_url) part.kind = 'image';
		return part;
	},

	/* ---------------- YouTube ---------------- */

	youtubeId(url) {
		const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
		return m ? m[1] : '';
	},

	youtubeDescription(html) {
		const m = html.match(/"shortDescription":("(?:[^"\\]|\\.)*")/);
		if (!m) return '';
		try { return JSON.parse(m[1]); } catch (e) { return ''; }
	},
};

if (typeof self !== 'undefined') self.Extract = Extract;
if (typeof module !== 'undefined') module.exports = Extract;
