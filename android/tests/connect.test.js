// The connection screen's Nextcloud Login Flow v2, against a fake server.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { UI, fakeNet, curioAsset } = require('./helpers');

test('Login Flow v2: opens the login page, polls, saves the app password, checks Curio', async () => {
	let config = {};
	let opened = '';
	let openedCurio = false;
	let polls = 0;
	const log = [];
	const net = fakeNet([
		{ match: 'https://cloud.example.com/index.php/login/v2/poll', res: () => (++polls < 2
			? { status: 404, body: '' }
			: { contentType: 'application/json', body: JSON.stringify({ server: 'https://cloud.example.com', loginName: 'tom', appPassword: 'app-pass-123' }) }) },
		{ match: 'https://cloud.example.com/index.php/login/v2', res: { contentType: 'application/json', body: JSON.stringify({ poll: { token: 'tok', endpoint: 'https://cloud.example.com/index.php/login/v2/poll' }, login: 'https://cloud.example.com/index.php/login/v2/flow/abc' }) } },
		{ match: 'https://cloud.example.com/index.php/apps/curio/api/clip/ping', res: { contentType: 'application/json', body: '{"ok":true,"user":"tom","version":"1.0.5"}' } },
	], log);
	const dom = await JSDOM.fromFile(path.join(UI, 'connect.html'), {
		runScripts: 'dangerously',
		resources: 'usable',
		beforeParse(window) {
			window.Android = {
				getConfig: () => JSON.stringify(config),
				setConfig: (p) => { const patch = JSON.parse(p); for (const k in patch) { if (patch[k] === null) delete config[k]; else config[k] = patch[k]; } },
				appInfo: () => '{"version":"1.0.0","device":"Google Pixel 8"}',
				siteSessions: () => '{}',
				request: (id, s) => net(JSON.parse(s)).then((r) => window.CurioNative._resolve(id, JSON.stringify(r))),
				openExternal: (u) => { opened = u; },
				toast: () => {},
				asset: curioAsset,
				openCurio: () => { openedCurio = true; },
			};
		},
	});
	const doc = dom.window.document;
	await new Promise((r) => dom.window.addEventListener('load', r));
	assert.equal(doc.querySelector('.mhead h2').textContent, 'Welcome to Curio');
	doc.getElementById('cServer').value = 'cloud.example.com/';
	doc.getElementById('cLogin').click();
	const t0 = Date.now();
	while (!openedCurio) {
		if (Date.now() - t0 > 9000) throw new Error('never opened Curio: ' + doc.getElementById('cStatus').textContent);
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(opened, 'https://cloud.example.com/index.php/login/v2/flow/abc');
	assert.equal(log[0].headers['User-Agent'], 'Curio for Android (Google Pixel 8)');
	assert.equal(log.find((s) => s.url.endsWith('/poll')).body, 'token=tok');
	assert.equal(config.appPassword, 'app-pass-123');
	assert.equal(config.user, 'tom');
	assert.equal(config.curioVersion, '1.0.5');
});
