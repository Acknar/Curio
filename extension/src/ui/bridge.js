// bridge.js - the browser's stand-in for Curio for Android's JavaScript bridge
// (NativeBridge.java, window.Android). With it, the app's own screens and scripts
// (clip.html/.js, extract.js, curio.js, look.js...) run unchanged in the extension:
//   - config lives in browser.storage.local (same keys as web clipper 1.1.0);
//   - HTTP goes through fetch from the extension page, which host permissions
//     exempt from CORS; headers fetch cannot set itself (User-Agent, Referer) are
//     added with a declarativeNetRequest session rule for that one request;
//   - "render" (the app's hidden WebView) is the page the user clipped, already
//     read in their tab by page-extractors.js;
//   - Curio's translations are read from the package up front, because the app
//     reads them synchronously.
// boot.js waits for ExtBridge.ready before loading the app's scripts.

/* global browser */
const ExtBridge = {
	LANGS: ['fr', 'es', 'de', 'it', 'pt', 'nl'],
	config: {},
	clip: null,       // what the content script read, from storage.session
	l10n: {},
	renderable: true, // clip-ext.js turns this off when the clip is a link to another page
	ready: null,

	async init() {
		this.config = await browser.storage.local.get(null);
		const id = new URLSearchParams(location.search).get('id');
		if (id) {
			const store = browser.storage.session || browser.storage.local;
			try {
				const got = await store.get(id);
				this.clip = got[id] || null;
			} catch (e) { this.clip = null; }
		}
		await Promise.all(this.LANGS.map(async (l) => {
			try { this.l10n[l] = await (await fetch(browser.runtime.getURL('curio/l10n/' + l + '.json'))).text(); } catch (e) { this.l10n[l] = ''; }
		}));
	},

	setConfig(patch) {
		const set = {};
		const remove = [];
		for (const k of Object.keys(patch || {})) {
			if (patch[k] === null || patch[k] === undefined) { delete this.config[k]; remove.push(k); }
			else { this.config[k] = patch[k]; set[k] = patch[k]; }
		}
		if (Object.keys(set).length) browser.storage.local.set(set).catch(() => {});
		if (remove.length) browser.storage.local.remove(remove).catch(() => {});
	},

	browserName() {
		const ua = navigator.userAgent || '';
		if (/Firefox\//.test(ua)) return 'Firefox';
		if (/Edg\//.test(ua)) return 'Edge';
		if (/OPR\//.test(ua)) return 'Opera';
		if (navigator.brave) return 'Brave';
		if (/Chrome\//.test(ua)) return 'Chrome';
		return 'Browser';
	},

	osName() {
		const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
		if (/win/i.test(p)) return 'Windows';
		if (/mac/i.test(p)) return 'macOS';
		if (/cros/i.test(navigator.userAgent || '')) return 'ChromeOS';
		if (/linux/i.test(p)) return 'Linux';
		return '';
	},

	/* ---------------- HTTP ---------------- */

	// Headers a page's fetch() may not set. Firefox honours User-Agent in fetch;
	// the session rule covers the rest, and User-Agent in Chrome.
	RULE_HEADERS: /^(user-agent|referer|origin)$/i,

	async headerRule(url, headers) {
		const dnr = browser.declarativeNetRequest;
		const set = Object.keys(headers || {}).filter((k) => this.RULE_HEADERS.test(k));
		if (!dnr || !dnr.updateSessionRules || !set.length) return 0;
		const id = 1 + Math.floor(Math.random() * 2000000000);
		try {
			await dnr.updateSessionRules({
				addRules: [{
					id: id,
					priority: 1,
					action: { type: 'modifyHeaders', requestHeaders: set.map((k) => ({ header: k.toLowerCase(), operation: 'set', value: String(headers[k]) })) },
					condition: { urlFilter: '|' + String(url).split('#')[0], resourceTypes: ['xmlhttprequest', 'other'] },
				}],
			});
			return id;
		} catch (e) {
			return 0;
		}
	},

	dropRule(id) {
		if (id) browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
	},

	async fetchRaw(spec) {
		const headers = {};
		for (const [k, v] of Object.entries(spec.headers || {})) {
			if (!/^(referer|origin|cookie)$/i.test(k)) headers[k] = String(v);
		}
		const opts = {
			method: (spec.method || 'GET').toUpperCase(),
			headers: headers,
			credentials: spec.cookies ? 'include' : 'omit',
			cache: 'no-store',
			redirect: spec.followRedirects === false ? 'manual' : 'follow',
		};
		if (spec.form) opts.body = spec.form;
		else if (spec.body != null) opts.body = spec.body;
		const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
		if (ctrl) opts.signal = ctrl.signal;
		const timer = ctrl ? setTimeout(() => ctrl.abort(), spec.timeoutMs || 20000) : null;
		const rule = await this.headerRule(spec.url, spec.headers);
		try {
			return await fetch(spec.url, opts);
		} finally {
			if (timer) clearTimeout(timer);
			this.dropRule(rule);
		}
	},

	responseHead(res, spec) {
		const out = { status: res.status, url: res.url || spec.url, contentType: res.headers.get('content-type') || '', headers: {} };
		res.headers.forEach((v, k) => { out.headers[k.toLowerCase()] = v; });
		return out;
	},

	decode(buf, contentType) {
		const m = /charset=([\w.:-]+)/i.exec(contentType || '');
		try { return new TextDecoder(m ? m[1] : 'utf-8').decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
	},

	base64(buf) {
		const bytes = new Uint8Array(buf);
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		return btoa(s);
	},

	// Same contract as Http.java: { status, url, contentType, headers, body | bodyBase64 } or { error, message }.
	async http(spec) {
		if (spec.multipart) return this.multipart(spec);
		let res;
		try { res = await this.fetchRaw(spec); } catch (e) { return { error: 'network', message: String(e && e.message ? e.message : e) }; }
		const out = this.responseHead(res, spec);
		if (spec.responseType === 'none' || (spec.method || '').toUpperCase() === 'HEAD') return out;
		let buf = await res.arrayBuffer();
		const max = spec.maxBytes || 4 * 1024 * 1024;
		if (buf.byteLength > max) buf = buf.slice(0, max);
		if (spec.responseType === 'base64') out.bodyBase64 = this.base64(buf);
		else out.body = this.decode(buf, out.contentType);
		return out;
	},

	// Magic-number sniffing for the formats Curio accepts (Http.sniff).
	sniff(b, fallback) {
		const s = (i, n) => String.fromCharCode.apply(null, b.subarray(i, i + n));
		if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
		if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
		if (b.length >= 6 && s(0, 3) === 'GIF') return 'image/gif';
		if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
		if (b.length >= 12 && s(4, 4) === 'ftyp') {
			const brand = s(8, 4);
			if (/^avi[fs]/.test(brand)) return 'image/avif';
			if (/^(heic|heix|mif1)/.test(brand)) return 'image/heic';
			if (/^qt/.test(brand)) return 'video/quicktime';
			return 'video/mp4';
		}
		if (b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';
		if (b.length >= 5 && s(0, 4) === '%PDF') return 'application/pdf';
		return fallback;
	},

	// Download a file in the browser and post it to Curio as multipart form data.
	async multipart(spec) {
		const mp = spec.multipart || {};
		const form = new FormData();
		for (const [k, v] of Object.entries(mp.fields || {})) form.append(k, String(v));
		const file = mp.file;
		if (file) {
			if (!file.fromUrl) return { error: 'source', message: 'No shared file' };
			const max = file.maxBytes || 32 * 1024 * 1024;
			let res;
			try { res = await this.fetchRaw({ url: file.fromUrl, headers: file.fromHeaders || {}, cookies: !!file.fromCookies, timeoutMs: 60000 }); } catch (e) { return { error: 'source', message: 'Download failed: ' + (e && e.message ? e.message : e) }; }
			if (res.status < 200 || res.status >= 300) return { error: 'source', message: 'Download failed: HTTP ' + res.status };
			const data = new Uint8Array(await res.arrayBuffer());
			if (!data.length) return { error: 'source', message: 'Empty file' };
			if (data.length > max) return { error: 'too-large', message: 'File is larger than ' + Math.round(max / 1048576) + ' MB' };
			let mime = (res.headers.get('content-type') || '').split(';')[0].trim() || file.mime || '';
			if (!mime || mime === 'application/octet-stream') mime = this.sniff(data, file.mime || 'application/octet-stream');
			if (file.expect && !mime.startsWith(file.expect)) {
				const sniffed = this.sniff(data, mime);
				if (!sniffed.startsWith(file.expect)) return { error: 'type', message: 'Not ' + file.expect + ' (' + mime + ')' };
				mime = sniffed;
			}
			form.append(file.field || 'file', new Blob([data], { type: mime }), file.filename || 'clip');
		}
		const headers = Object.assign({}, spec.headers || {});
		delete headers['Content-Type'];
		return this.http({ method: spec.method || 'POST', url: spec.url, headers: headers, form: form, timeoutMs: spec.timeoutMs || 120000 });
	},

	// The app's hidden-WebView render: here, the page as the user's tab showed it.
	render() {
		const d = this.clip;
		if (!d || !this.renderable) return { error: 'no-render', message: 'Nothing rendered' };
		return { title: d.title || '', description: d.description || '', images: d.images || [], video: d.video || null, videoFileUrl: d.videoFileUrl || '', kind: d.kind || 'link' };
	},

	async request(id, specJson) {
		let res;
		try {
			const spec = JSON.parse(specJson);
			res = spec.op === 'render' ? this.render() : await this.http(spec);
		} catch (e) {
			res = { error: 'bad-request', message: String(e && e.message ? e.message : e) };
		}
		window.CurioNative._resolve(id, JSON.stringify(res));
	},

	openSettings() {
		browser.runtime.openOptionsPage().catch(() => {});
	},
};

// clip.js declares a global close() of its own, which replaces window.close.
const closeWindow = window.close.bind(window);

window.Android = {
	getConfig: () => JSON.stringify(ExtBridge.config),
	setConfig: (json) => { try { ExtBridge.setConfig(JSON.parse(json)); } catch (e) { /* ignore bad input */ } },
	getShared: () => {
		const d = ExtBridge.clip;
		return JSON.stringify(d ? { text: d.url || d.pageUrl || '', subject: d.title || '', dom: d } : {});
	},
	appInfo: () => JSON.stringify({ version: browser.runtime.getManifest().version, device: [ExtBridge.browserName(), ExtBridge.osName()].filter(Boolean).join(' on ') }),
	// The browser's own sign-ins: the clip reads sites with the user's cookies.
	siteSessions: () => JSON.stringify({ instagram: true, facebook: true, pinterest: true, tiktok: true, x: true }),
	request: (id, specJson) => { ExtBridge.request(id, specJson); },
	asset: (p) => {
		const m = /^curio\/l10n\/([a-z]+)\.json$/.exec(String(p || ''));
		return m ? (ExtBridge.l10n[m[1]] || '') : '';
	},
	close: () => closeWindow(),
	clipped: () => {},
	toast: () => {},
	openExternal: (url) => { browser.tabs.create({ url: url }).catch(() => window.open(url, '_blank')); },
	openCurio: () => { ExtBridge.openSettings(); closeWindow(); },
	openSettings: () => { ExtBridge.openSettings(); closeWindow(); },
	openConnect: () => { ExtBridge.openSettings(); },
};

ExtBridge.ready = ExtBridge.init();
if (typeof self !== 'undefined') self.ExtBridge = ExtBridge;
