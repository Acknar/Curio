// The settings page: Nextcloud Login Flow v2 from the browser, the connected view
// (default board, click hotkey) and its translations.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVER, openPage, waitFor } = require('./helpers');

test('Sign in with Nextcloud: login page opened in a tab, app password stored, tab closed', async () => {
	let polls = 0;
	const ctx = await openPage('options.html', {
		config: {},
		query: '',
		routes: [
			{ match: SERVER + '/index.php/login/v2/poll', res: () => (++polls < 2 ? { status: 404, body: '' } : { contentType: 'application/json', body: JSON.stringify({ server: SERVER, loginName: 'tom', appPassword: 'new-app-password' }) }) },
			{ match: SERVER + '/index.php/login/v2', res: { contentType: 'application/json', body: JSON.stringify({ poll: { token: 'tok', endpoint: SERVER + '/index.php/login/v2/poll' }, login: SERVER + '/index.php/login/v2/flow/abc' }) } },
			{ match: SERVER + '/ocs/v2.php/cloud/capabilities', res: { contentType: 'application/json', body: JSON.stringify({ ocs: { data: { capabilities: { theming: { color: '#00679e' } } } } }) } },
		],
	});
	const { doc, rec, store } = ctx;
	await waitFor(() => !doc.getElementById('connect').classList.contains('hidden'));
	doc.getElementById('cServer').value = 'cloud.example.com';
	doc.getElementById('cLogin').click();
	await waitFor(() => store.appPassword === 'new-app-password', 8000);
	assert.deepEqual(rec.tabs, [SERVER + '/index.php/login/v2/flow/abc']);
	assert.deepEqual(rec.closedTabs, [99]);
	const start = rec.requests.find((r) => r.url === SERVER + '/index.php/login/v2');
	assert.match(start.opts.headers['User-Agent'], /^Curio Web Clipper/, 'names the app password');
	assert.equal(store.server, SERVER);
	assert.equal(store.user, 'tom');
	await waitFor(() => store.look && store.look.primary === '#00679e');
});

test('Connected: default board and click hotkey are saved as they change', async () => {
	const ctx = await openPage('options.html', { query: '' });
	const { doc, store } = ctx;
	await waitFor(() => doc.querySelectorAll('#sBoard option').length === 3);
	assert.equal(doc.getElementById('sWho').textContent, 'tom on cloud.example.com');
	assert.equal(doc.getElementById('sBoard').value, '7');
	assert.equal(doc.getElementById('sVersion').textContent, 'Curio 2.2.0 on the server');
	assert.equal(doc.querySelectorAll('#howTo li').length, 4);
	assert.match(doc.getElementById('howTo').textContent, /Alt\+Shift\+C/);

	const board = doc.getElementById('sBoard');
	board.value = '3';
	board.dispatchEvent(new ctx.w.Event('change'));
	const hk = doc.getElementById('sHotkey');
	hk.value = 'off';
	hk.dispatchEvent(new ctx.w.Event('change'));
	await waitFor(() => store.defaultBoardId === 3 && store.hotkeyEnabled === false);
	hk.value = 'alt';
	hk.dispatchEvent(new ctx.w.Event('change'));
	await waitFor(() => store.hotkeyEnabled === true && store.hotkeyMod === 'alt');
});

test('Settings page in Curio\'s language', async () => {
	const ctx = await openPage('options.html', { query: '', config: { server: SERVER, user: 'tom', appPassword: 'x', look: { lang: 'de' } } });
	const { doc } = ctx;
	await waitFor(() => !doc.getElementById('connected').classList.contains('hidden'));
	assert.equal(doc.querySelector('label[for="sBoard"]').textContent, 'Standard-Board');
	assert.equal(doc.querySelector('#sHotkey option[value="ctrl"]').textContent, 'Strg + Klick');
	assert.equal(doc.getElementById('sDisconnect').textContent, 'Trennen');
});
