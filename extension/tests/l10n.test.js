// Every string the clipper's own pages show is translated in each of Curio's
// languages, by ext-l10n.js, the Android app's app-l10n.js or Curio's l10n files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_UI = path.join(__dirname, '..', 'src', 'ui');
const APP_UI = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'ui');
const LANGS = ['fr', 'es', 'de', 'it', 'pt', 'nl'];

function tables() {
	const ctx = vm.createContext({});
	ctx.self = ctx;
	vm.runInContext(fs.readFileSync(path.join(APP_UI, 'app-l10n.js'), 'utf8') + '\n;this.APP_L10N = APP_L10N;', ctx);
	vm.runInContext(fs.readFileSync(path.join(SRC_UI, 'ext-l10n.js'), 'utf8'), ctx);
	return ctx;
}

function usedStrings() {
	const out = new Set();
	for (const f of ['options.js', 'clip-ext.js']) {
		const s = fs.readFileSync(path.join(SRC_UI, f), 'utf8');
		for (const m of s.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
		for (const m of s.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)) out.add(m[1]);
	}
	// The share sheet's wording the clipper replaces: the replacements are shown instead.
	const wording = /const WORDING = \{([\s\S]*?)\};/.exec(fs.readFileSync(path.join(SRC_UI, 'clip-ext.js'), 'utf8'))[1];
	for (const m of wording.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) out.add(m[1]);
	const html = fs.readFileSync(path.join(SRC_UI, 'options.html'), 'utf8');
	for (const m of html.matchAll(/data-(?:tr|tr-placeholder)="([^"]*)"/g)) out.add(m[1].replace(/&amp;/g, '&'));
	return [...out];
}

test('all clipper strings are translated in fr, es, de, it, pt and nl', () => {
	const { APP_L10N } = tables();
	const missing = [];
	for (const lang of LANGS) {
		const curio = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'l10n', lang + '.json'), 'utf8')).translations;
		for (const s of usedStrings()) {
			if (!(APP_L10N[lang] && APP_L10N[lang][s]) && !curio[s]) missing.push(lang + ': ' + s);
		}
	}
	assert.deepEqual(missing, []);
});

test('every language has the same clipper strings, with their placeholders', () => {
	const { EXT_L10N } = tables();
	const keys = Object.keys(EXT_L10N.fr).sort();
	const bad = [];
	for (const lang of LANGS) {
		assert.deepEqual(Object.keys(EXT_L10N[lang]).sort(), keys, lang);
		for (const [k, v] of Object.entries(EXT_L10N[lang])) {
			const want = (k.match(/\{\w+\}/g) || []).sort().join();
			const got = (v.match(/\{\w+\}/g) || []).sort().join();
			if (want !== got) bad.push(lang + ': ' + k);
		}
	}
	assert.deepEqual(bad, []);
});

test('the store listing is translated in every locale', () => {
	const dir = path.join(__dirname, '..', 'src', '_locales');
	const en = JSON.parse(fs.readFileSync(path.join(dir, 'en', 'messages.json'), 'utf8'));
	for (const loc of fs.readdirSync(dir)) {
		const m = JSON.parse(fs.readFileSync(path.join(dir, loc, 'messages.json'), 'utf8'));
		assert.deepEqual(Object.keys(m).sort(), Object.keys(en).sort(), loc);
		assert.ok(m.extDescription.message.length <= 132, loc + ': Chrome Web Store limit');
	}
});
