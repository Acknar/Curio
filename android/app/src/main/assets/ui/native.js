// native.js - promise wrapper around the Android bridge (NativeBridge.java,
// exposed as window.Android). Outside the app (tests, a desktop browser) a stub
// with the same shape can be assigned to window.Android before this file loads.

/* global Android */
const CurioNative = {
	_seq: 0,
	_pending: {},

	available() { return typeof Android !== 'undefined'; },

	_resolve(id, json) {
		const p = this._pending[id];
		if (!p) return;
		delete this._pending[id];
		let data;
		try { data = JSON.parse(json); } catch (e) { data = { error: 'bad-response', message: String(e) }; }
		p(data);
	},

	request(spec) {
		const id = 'r' + (++this._seq) + '-' + Date.now();
		return new Promise((resolve) => {
			this._pending[id] = resolve;
			Android.request(id, JSON.stringify(spec));
		});
	},

	// Plain HTTP from the phone (no CORS). Resolves { status, url, contentType, headers, body } or { error }.
	http(spec) { return this.request(Object.assign({ op: 'http' }, spec)); },

	// Render a page in a hidden WebView and run page-extractors.js on it.
	render(url, info, timeoutMs) { return this.request({ op: 'render', url: url, info: info || {}, timeoutMs: timeoutMs || 12000 }); },

	getConfig() { try { return JSON.parse(Android.getConfig() || '{}'); } catch (e) { return {}; } },
	setConfig(patch) { Android.setConfig(JSON.stringify(patch)); },
	shared() { try { return JSON.parse(Android.getShared() || '{}'); } catch (e) { return {}; } },
	appInfo() { try { return JSON.parse(Android.appInfo() || '{}'); } catch (e) { return {}; } },
	siteSessions() { try { return JSON.parse(Android.siteSessions() || '{}'); } catch (e) { return {}; } },
};

if (typeof self !== 'undefined') self.CurioNative = CurioNative;
if (typeof module !== 'undefined') module.exports = CurioNative;
