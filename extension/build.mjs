// build.mjs - assembles the Curio Web Clipper for Firefox and for Chrome (Edge,
// Brave, Opera) from:
//   - src/: the extension's own files (manifest, background, content script, the
//     browser bridge, the settings page);
//   - ../android/app/src/main/assets/ui/: Curio for Android's share dialog,
//     extractors, tag logic, caption cleanup, API client, theme and translations,
//     used unchanged;
//   - ../src/styles.css and ../l10n/*.json: Curio's own stylesheet and translations;
//   - node_modules/webextension-polyfill: the browser.* API in Chrome.
// Output: dist/firefox/, dist/chrome/ and dist/curio-webclipper-<version>-<browser>.zip.
//
//   node build.mjs            both browsers
//   node build.mjs firefox    one of them

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(HERE, 'src');
const APP_UI = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'ui');
const DIST = path.join(HERE, 'dist');
const POLYFILL = path.join(HERE, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.min.js');

// Curio for Android files the clipper runs as they are.
const FROM_APP = ['clip.html', 'clip.js', 'native.js', 'app-l10n.js', 'look.js', 'curio.js', 'taglogic.js', 'cleanup.js', 'extract.js', 'page-extractors.js', 'app.css'];

function copyDir(from, to) {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		const a = path.join(from, e.name);
		const b = path.join(to, e.name);
		if (e.isDirectory()) copyDir(a, b);
		else fs.copyFileSync(a, b);
	}
}

// The share dialog's page, with its scripts loaded by boot.js once the bridge is
// ready, plus the clipper's own additions.
function clipPage(html) {
	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
	for (const need of ['native.js', 'app-l10n.js', 'look.js', 'curio.js', 'extract.js', 'clip.js']) {
		if (!scripts.includes(need)) throw new Error('clip.html no longer loads ' + need + '; update build.mjs');
	}
	const list = [];
	for (const s of scripts) {
		if (s === 'clip.js') list.push('clip-ext.js');
		list.push(s);
		if (s === 'app-l10n.js') list.push('ext-l10n.js');
	}
	const boot = '<script src="../browser-polyfill.min.js"></script>\n\t<script src="bridge.js"></script>\n\t<script src="boot.js" data-needs-connection data-scripts="' + list.join(',') + '"></script>';
	let out = html.replace(/(\s*<script src="[^"]+"><\/script>)+/, '\n\t' + boot);
	if (!out.includes('href="app.css">')) throw new Error('clip.html no longer links app.css; update build.mjs');
	out = out.replace('href="app.css">', 'href="app.css">\n\t<link rel="stylesheet" href="ext.css">');
	return out;
}

function manifestFor(browser, base) {
	const m = JSON.parse(JSON.stringify(base));
	if (browser === 'firefox') {
		delete m.background.service_worker;
		delete m.minimum_chrome_version;
	} else {
		delete m.background.scripts;
		delete m.browser_specific_settings;
		delete m.action.theme_icons;
	}
	return m;
}

function build(browser) {
	if (!fs.existsSync(POLYFILL)) throw new Error('Run npm install in extension/ first (webextension-polyfill is missing).');
	const out = path.join(DIST, browser);
	fs.rmSync(out, { recursive: true, force: true });
	copyDir(SRC, out);

	for (const f of FROM_APP) fs.copyFileSync(path.join(APP_UI, f), path.join(out, 'ui', f));
	const clipHtml = path.join(out, 'ui', 'clip.html');
	fs.writeFileSync(clipHtml, clipPage(fs.readFileSync(clipHtml, 'utf8')));

	fs.mkdirSync(path.join(out, 'curio', 'l10n'), { recursive: true });
	fs.copyFileSync(path.join(ROOT, 'src', 'styles.css'), path.join(out, 'curio', 'styles.css'));
	for (const f of fs.readdirSync(path.join(ROOT, 'l10n'))) {
		if (f.endsWith('.json')) fs.copyFileSync(path.join(ROOT, 'l10n', f), path.join(out, 'curio', 'l10n', f));
	}
	fs.copyFileSync(POLYFILL, path.join(out, 'browser-polyfill.min.js'));

	const base = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
	fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifestFor(browser, base), null, '\t') + '\n');

	const zip = path.join(DIST, 'curio-webclipper-' + base.version + '-' + browser + '.zip');
	fs.rmSync(zip, { force: true });
	execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: out });
	console.log('built ' + path.relative(HERE, out) + ' and ' + path.relative(HERE, zip));
}

const which = process.argv.slice(2);
for (const b of (which.length ? which : ['firefox', 'chrome'])) {
	if (b !== 'firefox' && b !== 'chrome') throw new Error('Unknown browser ' + b);
	build(b);
}
