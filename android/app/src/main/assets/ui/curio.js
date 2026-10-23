// curio.js - Curio clip API client: the browser extension's common.js, with the
// requests sent through the phone's native HTTP (CurioNative.http) instead of fetch.
// Talks only to the /api/clip/ endpoints (Curio 1.0.4+), authenticated with a
// Nextcloud app password.

/* global CurioNative */
const CURIO = {
	DEFAULTS: {
		server: '',
		user: '',
		appPassword: '',
		defaultBoardId: null,
	},

	getConfig() {
		return Object.assign({}, this.DEFAULTS, CurioNative.getConfig());
	},

	setConfig(patch) {
		CurioNative.setConfig(patch);
	},

	configured(c) {
		return !!(c && c.server && c.user && c.appPassword);
	},

	base(server) {
		let s = String(server || '').trim().replace(/\/+$/, '');
		if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
		return s;
	},

	apiUrl(server, path) {
		// /index.php/ works whether or not the server has pretty URLs enabled.
		return this.base(server) + '/index.php/apps/curio/api/clip' + path;
	},

	authHeader(c) {
		// UTF-8 safe base64 of "user:password".
		const raw = c.user + ':' + c.appPassword;
		return 'Basic ' + btoa(unescape(encodeURIComponent(raw)));
	},

	headers(c, extra) {
		return Object.assign({
			'Authorization': this.authHeader(c),
			'Accept': 'application/json',
		}, extra || {});
	},

	async call(path, opts = {}) {
		const c = opts.config || this.getConfig();
		if (!this.configured(c)) {
			const e = new Error('not-configured');
			e.code = 'not-configured';
			throw e;
		}
		let url = this.apiUrl(c.server, path);
		if (opts.query) {
			const qs = new URLSearchParams(opts.query).toString();
			if (qs) url += (url.includes('?') ? '&' : '?') + qs;
		}
		const spec = { method: opts.method || 'GET', url: url, headers: this.headers(c), timeoutMs: opts.timeoutMs || 30000 };
		if (opts.json != null) {
			spec.headers['Content-Type'] = 'application/json';
			spec.body = JSON.stringify(opts.json);
		} else if (opts.multipart != null) {
			spec.multipart = opts.multipart;
			spec.timeoutMs = 120000;
		}
		const res = await CurioNative.http(spec);
		return this.parse(res);
	},

	parse(res) {
		if (res.error) {
			const e = new Error(res.message || res.error);
			e.code = res.error === 'network' ? 'network' : res.error;
			throw e;
		}
		let data = null;
		try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
		if (res.status < 200 || res.status >= 300) {
			const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
			const e = new Error(msg);
			e.status = res.status;
			e.data = data;
			throw e;
		}
		return data;
	},

	ping(config) { return this.call('/ping', { config }); },
	state(config) { return this.call('/state', { config }); },
	fetchMeta(url, config) { return this.call('/fetch', { method: 'POST', json: { url }, config }); },
	detect(params, config) { return this.call('/geocode/detect', { query: params, config }); },
	suggest(q, lang, config) { return this.call('/geocode/suggest', { query: { q: q, lang: lang || '' }, config }); },
	createReference(payload, config) { return this.call('/reference', { method: 'POST', json: payload, config }); },
	createTag(name, config) { return this.call('/tags', { method: 'POST', json: { name: name }, config }); },

	// Download a remote image on the phone and hand the bytes to Curio. Returns the
	// upload marker to use as a reference's `img`.
	uploadImageFromUrl(url, fromHeaders, config) {
		return this.call('/upload', { method: 'POST', config, multipart: { file: { fromUrl: url, fromHeaders: fromHeaders || {}, field: 'file', filename: 'clip', expect: 'image/' } } });
	},

	uploadVideoFromUrl(url, fromHeaders, config) {
		return this.call('/upload-video', { method: 'POST', config, multipart: { file: { fromUrl: url, fromHeaders: fromHeaders || {}, field: 'file', filename: 'video.mp4', mime: 'video/mp4', expect: 'video/' } } });
	},

	// A file shared into the app (photo, video or PDF from the gallery or a files app).
	uploadShared(index, name, isVideo, config) {
		return this.call(isVideo ? '/upload-video' : '/upload', { method: 'POST', config, multipart: { file: { shared: index, field: 'file', filename: name || 'shared' } } });
	},
};

if (typeof self !== 'undefined') self.CURIO = CURIO;
if (typeof module !== 'undefined') module.exports = CURIO;
