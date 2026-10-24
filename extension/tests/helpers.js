// Test helpers: open a page of the built extension (dist/chrome) in jsdom with a
// fake browser.* API (storage, runtime, tabs, permissions) and a fake network for
// the sites and the Curio server. The page loads its scripts through boot.js, as
// in the browser.
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'dist', 'chrome');
const FIX = path.join(__dirname, '..', '..', 'android', 'tests', 'fixtures');
const SERVER = 'https://cloud.example.com';
const API = SERVER + '/index.php/apps/curio/api/clip';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

function fixture(name) {
	return fs.readFileSync(path.join(FIX, name), 'utf8');
}

class FakeResponse {
	constructor(spec, r) {
		this.status = r.status || 200;
		this.url = r.url || spec.url;
		const h = Object.assign({ 'content-type': r.contentType || 'text/html' }, r.headers || {});
		this.headers = {
			get: (k) => h[k.toLowerCase()] || null,
			forEach: (fn) => { for (const k of Object.keys(h)) fn(h[k], k); },
		};
		this._body = r.bytes ? r.bytes : new TextEncoder().encode(r.body || '');
	}

	async arrayBuffer() { return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength); }
	async text() { return new TextDecoder().decode(this._body); }
}

function curioRoutes(rec, fetchMeta) {
	const json = (o) => ({ contentType: 'application/json', body: JSON.stringify(o) });
	return [
		{ match: API + '/state', res: json({
			boards: [{ id: 3, name: 'Travel', mine: true }, { id: 7, name: 'Home', mine: true }, { id: 9, name: 'Shared', mine: false }],
			tags: [{ id: 11, name: 'Thailand', color: '#ff8800' }, { id: 12, name: 'Interior design', color: '#3366cc' }, { id: 13, name: 'Street food', color: '#22aa55' }],
			folders: [], lang: 'en',
		}) },
		{ match: API + '/ping', res: json({ ok: true, app: 'curio', version: '2.2.0', user: 'tom' }) },
		{ match: API + '/fetch', res: () => json(fetchMeta || { type: 'link', title: null, description: null, image: null }) },
		{ match: API + '/geocode/detect', res: (spec) => { rec.detect.push(spec.url); return json({ results: [] }); } },
		{ match: API + '/upload-video', res: (spec) => { rec.uploads.push(spec.opts.body.get('file')); return json({ upload: 'curio-upload:vid1' }); } },
		{ match: API + '/upload', res: (spec) => { rec.uploads.push(spec.opts.body.get('file')); return json({ img: 'curio-upload:img1' }); } },
		{ match: API + '/tags', res: (spec) => json({ id: 50, name: JSON.parse(spec.opts.body).name }) },
		{ match: API + '/reference', res: (spec) => { rec.refs.push(JSON.parse(spec.opts.body)); rec.auth = spec.opts.headers.Authorization; return json({ id: 1 }); } },
		{ match: /\.(jpe?g|png)(\?|$)/, res: { contentType: 'image/png', bytes: PNG } },
		{ match: /\.mp4(\?|$)/, res: { contentType: 'video/mp4', bytes: MP4 } },
	];
}

// routes: [{ match: string|RegExp, res: object|function(spec) }]
function fakeFetch(routes, rec) {
	return async (url, opts) => {
		url = String(url);
		if (url.startsWith('ext://')) {
			const f = path.join(DIST, url.slice(6));
			return new FakeResponse({ url }, { body: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', status: fs.existsSync(f) ? 200 : 404 });
		}
		const spec = { url, opts: opts || {} };
		rec.requests.push(spec);
		for (const r of routes) {
			const hit = typeof r.match === 'string' ? url.startsWith(r.match) : r.match.test(url);
			if (hit) return new FakeResponse(spec, typeof r.res === 'function' ? r.res(spec) : r.res);
		}
		return new FakeResponse(spec, { status: 404 });
	};
}

function fakeBrowser(store, session, rec) {
	return {
		runtime: {
			id: 'test',
			getURL: (p) => 'ext://' + p,
			getManifest: () => ({ version: '1.2.0' }),
			openOptionsPage: async () => { rec.optionsOpened = true; },
		},
		storage: {
			local: {
				get: async () => Object.assign({}, store),
				set: async (o) => { Object.assign(store, o); },
				remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
			},
			session: {
				get: async (id) => ({ [id]: session[id] }),
				remove: async () => {},
			},
		},
		tabs: {
			create: async (o) => { rec.tabs.push(o.url); return { id: 99 }; },
			remove: async (id) => { rec.closedTabs.push(id); },
			getCurrent: async () => ({ id: 1 }),
			update: async () => ({}),
		},
		permissions: { contains: async () => true, request: async () => true },
		commands: { getAll: async () => [{ name: 'clip-page', shortcut: 'Alt+Shift+C' }] },
		i18n: { getMessage: (k) => (k === 'menuClip' ? 'Clip to Curio' : '') },
	};
}

async function waitFor(fn, ms = 4000) {
	const t0 = Date.now();
	while (!fn()) {
		if (Date.now() - t0 > ms) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 20));
	}
}

// Open ui/<page> of the built extension. `clip` is what the content script read.
async function openPage(page, { clip, routes, fetchMeta, config, query }) {
	const rec = { refs: [], uploads: [], detect: [], requests: [], tabs: [], closedTabs: [], auth: '', closed: false, optionsOpened: false };
	const store = Object.assign({}, config === undefined ? { server: SERVER, user: 'tom', appPassword: 'aaaaa-bbbbb', defaultBoardId: 7 } : config);
	const session = { 'clip-1': clip };
	const file = path.join(DIST, 'ui', page);
	const dom = await JSDOM.fromFile(file, {
		url: 'file://' + file + (query || '?id=clip-1'),
		runScripts: 'dangerously',
		resources: 'usable',
		pretendToBeVisual: true,
		beforeParse(window) {
			window.chrome = { runtime: { id: 'test' } };
			window.browser = fakeBrowser(store, session, rec);
			window.fetch = fakeFetch([...curioRoutes(rec, fetchMeta), ...(routes || [])], rec);
			window.TextDecoder = TextDecoder;
			window.TextEncoder = TextEncoder;
			window.close = () => { rec.closed = true; };
		},
	});
	return { w: dom.window, doc: dom.window.document, rec, store };
}

async function openClip(opts) {
	const ctx = await openPage('clip.html', opts);
	const doc = ctx.doc;
	await waitFor(() => doc.getElementById('btnAdd') && (!doc.getElementById('btnAdd').disabled || !doc.getElementById('setup').classList.contains('hidden')));
	return ctx;
}

async function submit(ctx) {
	ctx.doc.getElementById('btnAdd').click();
	await waitFor(() => ctx.rec.refs.length > 0 || !ctx.doc.getElementById('err').classList.contains('hidden'));
	return ctx.rec.refs[0];
}

module.exports = { SERVER, API, fixture, openPage, openClip, submit, waitFor };
