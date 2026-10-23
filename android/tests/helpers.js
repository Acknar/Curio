// Test helpers: load the app's browser scripts into Node with a jsdom DOMParser,
// and a fake network keyed by URL prefix.
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const UI = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'ui');
const FIX = path.join(__dirname, 'fixtures');

function fixture(name) {
	return fs.readFileSync(path.join(FIX, name), 'utf8');
}

// Evaluate the given asset scripts in one shared context, like <script> tags.
function loadScripts(names, extraGlobals) {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	const ctx = vm.createContext(Object.assign({
		DOMParser: dom.window.DOMParser,
		URL, URLSearchParams, console, setTimeout, clearTimeout, btoa, unescape, encodeURIComponent,
		navigator: { language: 'en-US' },
	}, extraGlobals || {}));
	ctx.self = ctx;
	for (const n of names) {
		// const declarations stay script-scoped in vm; re-expose them as globals.
		const src = fs.readFileSync(path.join(UI, n), 'utf8');
		vm.runInContext(src + '\n;' + exportsFor(src), ctx, { filename: n });
	}
	return ctx;
}

function exportsFor(src) {
	const names = [...src.matchAll(/^(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
	return names.map((n) => 'self.' + n + ' = ' + n + ';').join('\n');
}

// routes: [{ match: string|RegExp, res: object|function(spec) }]
function fakeNet(routes, log) {
	return async (spec) => {
		if (log) log.push(spec);
		for (const r of routes) {
			const hit = typeof r.match === 'string' ? spec.url.startsWith(r.match) : r.match.test(spec.url);
			if (hit) {
				const res = typeof r.res === 'function' ? r.res(spec) : r.res;
				return Object.assign({ status: 200, url: spec.url, contentType: 'text/html', headers: {} }, res);
			}
		}
		return { status: 404, url: spec.url, body: '', contentType: 'text/html', headers: {} };
	};
}

module.exports = { UI, fixture, loadScripts, fakeNet };
