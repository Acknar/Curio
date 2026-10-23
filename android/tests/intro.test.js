// The introduction (intro.html) in jsdom: steps, live site sign-in states, the
// default board and the "done" flag that keeps it from showing again.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { UI, fakeNet, curioAsset } = require('./helpers');

const SERVER = 'https://cloud.example.com';

async function openIntro(look) {
	const rec = { config: { server: SERVER, user: 'tom', appPassword: 'aaaaa-bbbbb', look }, sessions: {}, logins: [], closed: false };
	const net = fakeNet([{ match: SERVER + '/index.php/apps/curio/api/clip/state', res: { contentType: 'application/json', body: JSON.stringify({ boards: [{ id: 3, name: 'Travel', mine: true }, { id: 9, name: 'Shared', mine: false }], tags: [], folders: [] }) } }]);
	const dom = await JSDOM.fromFile(path.join(UI, 'intro.html'), {
		runScripts: 'dangerously',
		resources: 'usable',
		pretendToBeVisual: true,
		beforeParse(window) {
			window.Android = {
				getConfig: () => JSON.stringify(rec.config),
				setConfig: (p) => { Object.assign(rec.config, JSON.parse(p)); },
				siteSessions: () => JSON.stringify(rec.sessions),
				appInfo: () => '{"version":"1.2.0"}',
				request: (id, specJson) => { net(JSON.parse(specJson)).then((res) => window.CurioNative._resolve(id, JSON.stringify(res))); },
				openSiteLogin: (site) => { rec.logins.push(site); },
				close: () => { rec.closed = true; },
				asset: curioAsset,
			};
		},
	});
	const w = dom.window;
	await new Promise((r) => w.addEventListener('load', r));
	return { w, doc: w.document, rec };
}

const visible = (doc) => [...doc.querySelectorAll('section[data-step]')].filter((s) => !s.classList.contains('hidden')).map((s) => s.dataset.step);

test('introduction: steps, site sign-ins, default board, done flag', async () => {
	const { w, doc, rec } = await openIntro();
	assert.deepEqual(visible(doc), ['welcome']);
	assert.equal(doc.getElementById('iTitle').textContent, 'Welcome to Curio');
	assert.ok(doc.getElementById('btnPrev').classList.contains('hidden'));
	assert.equal(doc.querySelectorAll('#iDots button').length, 5);

	doc.getElementById('btnNext').click();
	assert.deepEqual(visible(doc), ['share']);
	doc.getElementById('btnNext').click();
	assert.deepEqual(visible(doc), ['reads']);
	assert.match(doc.getElementById('iPlatforms').textContent, /Instagram.*carousel/);

	doc.getElementById('btnNext').click();
	assert.deepEqual(visible(doc), ['sites']);
	const insta = doc.querySelector('#iSites .siterow');
	assert.match(insta.textContent, /Instagram\s*Not signed in/);
	insta.querySelector('button').click();
	assert.deepEqual(rec.logins, ['instagram']);
	// Back from the sign-in page: the row shows the new state.
	rec.sessions.instagram = true;
	w.CurioApp.refresh();
	assert.match(doc.querySelector('#iSites .siterow').textContent, /Signed in/);

	doc.getElementById('btnNext').click();
	assert.deepEqual(visible(doc), ['board']);
	assert.ok(doc.getElementById('btnNext').classList.contains('hidden'));
	const sel = doc.getElementById('iBoard');
	for (let i = 0; i < 100 && sel.options.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
	assert.deepEqual([...sel.options].map((o) => o.textContent), ['First board', 'Travel'], 'only own boards');
	sel.value = '3';
	sel.dispatchEvent(new w.Event('change'));
	assert.equal(rec.config.defaultBoardId, 3);

	// Android back goes to the previous step, then leaves.
	assert.equal(w.CurioApp.back(), true);
	assert.deepEqual(visible(doc), ['sites']);
	doc.querySelectorAll('#iDots button')[4].click();
	doc.getElementById('btnStart').click();
	assert.equal(rec.config.introDone, true);
	assert.ok(rec.closed);
});

test('introduction follows Curio\'s language', async () => {
	const { doc } = await openIntro({ theme: 'dark', lang: 'de' });
	assert.equal(doc.getElementById('iTitle').textContent, 'Willkommen bei Curio');
	assert.equal(doc.getElementById('btnNext').textContent, 'Weiter');
	assert.equal(doc.getElementById('root').getAttribute('data-rbtheme'), 'dark');
});

test('introduction: swiping changes step, vertical moves do not', async () => {
	const { w, doc } = await openIntro();
	const swipe = (x0, y0, x1, y1) => {
		const s = new w.Event('touchstart', { bubbles: true });
		s.touches = [{ clientX: x0, clientY: y0 }];
		doc.querySelector('.tour-body').dispatchEvent(s);
		const e = new w.Event('touchend', { bubbles: true });
		e.changedTouches = [{ clientX: x1, clientY: y1 }];
		doc.querySelector('.tour-body').dispatchEvent(e);
	};
	swipe(300, 400, 120, 410);
	assert.deepEqual(visible(doc), ['share'], 'swipe left: next');
	swipe(300, 400, 280, 150);
	assert.deepEqual(visible(doc), ['share'], 'scrolling is not a swipe');
	swipe(100, 400, 320, 390);
	assert.deepEqual(visible(doc), ['welcome'], 'swipe right: back');
	swipe(100, 400, 320, 390);
	assert.deepEqual(visible(doc), ['welcome'], 'stays on the first step');
});
