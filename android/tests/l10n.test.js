// Every string the app shows is translated in each of Curio's languages, either by
// Curio's own l10n files or by app-l10n.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { UI, loadScripts, curioAsset } = require('./helpers');

function usedStrings() {
	const out = new Set();
	for (const f of ['clip.js', 'connect.js', 'settings.js', 'sites.js', 'intro.js']) {
		const s = fs.readFileSync(path.join(UI, f), 'utf8');
		for (const m of s.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
		for (const m of s.matchAll(/tr\([^)]*\?\s*'([^']+)'\s*:\s*'([^']+)'\)/g)) { out.add(m[1]); out.add(m[2]); }
		for (const m of s.matchAll(/\breads: '([^']+)'/g)) out.add(m[1]);
		const tn = /TYPE_NAME = \{([^}]*)\}/.exec(s);
		if (tn) for (const m of tn[1].matchAll(/:\s*'([^']+)'/g)) out.add(m[1]);
	}
	for (const f of fs.readdirSync(UI).filter((x) => x.endsWith('.html'))) {
		const s = fs.readFileSync(path.join(UI, f), 'utf8');
		for (const m of s.matchAll(/data-(?:tr|tr-placeholder|title)="([^"]*)"/g)) out.add(m[1].replace(/&amp;/g, '&'));
	}
	for (const m of fs.readFileSync(path.join(UI, 'extract.js'), 'utf8').matchAll(/progress\('([^']*)'\)/g)) out.add(m[1]);
	return [...out];
}

test('all app strings are translated in fr, es, de, it, pt and nl', () => {
	const ctx = loadScripts(['app-l10n.js']);
	const app = ctx.APP_L10N;
	const missing = [];
	for (const lang of ['fr', 'es', 'de', 'it', 'pt', 'nl']) {
		const curio = JSON.parse(curioAsset('curio/l10n/' + lang + '.json')).translations;
		for (const s of usedStrings()) {
			if (!(app[lang] && app[lang][s]) && !curio[s]) missing.push(lang + ': ' + s);
		}
	}
	assert.deepEqual(missing, []);
});

test('placeholders survive translation', () => {
	const ctx = loadScripts(['app-l10n.js']);
	const bad = [];
	for (const [lang, table] of Object.entries(ctx.APP_L10N)) {
		for (const [k, v] of Object.entries(table)) {
			const want = (k.match(/\{\w+\}/g) || []).sort().join();
			const got = (v.match(/\{\w+\}/g) || []).sort().join();
			if (want !== got) bad.push(lang + ': ' + k);
		}
	}
	assert.deepEqual(bad, []);
});
