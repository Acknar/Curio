// End-to-end: the real share sheet (clip.html + every script it loads) in jsdom,
// with a fake Android bridge and a fake network standing in for the social sites
// and the Curio server. Asserts on the reference payload the sheet posts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { UI, fixture, fakeNet, curioAsset } = require('./helpers');

const SERVER = 'https://cloud.example.com';
const API = SERVER + '/index.php/apps/curio/api/clip';

function curioRoutes(rec, fetchMeta) {
	return [
		{ match: API + '/state', res: { contentType: 'application/json', body: JSON.stringify({
			boards: [{ id: 3, name: 'Travel', mine: true }, { id: 7, name: 'Home', mine: true }, { id: 9, name: 'Shared', mine: false }],
			tags: [{ id: 11, name: 'Thailand', color: '#ff8800' }, { id: 12, name: 'Interior design', color: '#3366cc' }, { id: 13, name: 'Street food', color: '#22aa55' }],
			folders: [], lang: 'en',
		}) } },
		{ match: API + '/fetch', res: { contentType: 'application/json', body: JSON.stringify(fetchMeta || { type: 'link', title: 'Instagram', description: null, image: null }) } },
		{ match: API + '/geocode/detect', res: (spec) => { rec.detect.push(spec.url); return { contentType: 'application/json', body: JSON.stringify({ results: [] }) }; } },
		{ match: API + '/upload-video', res: (spec) => { rec.uploads.push(spec.multipart.file); return { contentType: 'application/json', body: '{"upload":"curio-upload:vid1"}' }; } },
		{ match: API + '/upload', res: (spec) => { rec.uploads.push(spec.multipart.file); return { contentType: 'application/json', body: '{"img":"curio-upload:img1"}' }; } },
		{ match: API + '/tags', res: (spec) => { const b = JSON.parse(spec.body); return { contentType: 'application/json', body: JSON.stringify({ id: 50, name: b.name }) }; } },
		{ match: API + '/reference', res: (spec) => { rec.refs.push(JSON.parse(spec.body)); rec.auth = spec.headers.Authorization; return { contentType: 'application/json', body: '{"id":1}' }; } },
	];
}

async function openSheet({ shared, routes, sessions, config }) {
	const rec = { refs: [], uploads: [], detect: [], closed: false, auth: '', clipped: false };
	const net = fakeNet([...curioRoutes(rec, routes.fetchMeta), ...routes.list]);
	const dom = await JSDOM.fromFile(path.join(UI, 'clip.html'), {
		runScripts: 'dangerously',
		resources: 'usable',
		pretendToBeVisual: true,
		beforeParse(window) {
			window.Android = {
				getConfig: () => JSON.stringify(config || { server: SERVER, user: 'tom', appPassword: 'aaaaa-bbbbb', defaultBoardId: 7 }),
				setConfig: () => {},
				getShared: () => JSON.stringify(shared),
				appInfo: () => '{"version":"1.0.0"}',
				siteSessions: () => JSON.stringify(sessions || {}),
				request: (id, specJson) => {
					const spec = JSON.parse(specJson);
					const run = spec.op === 'render' ? Promise.resolve({ error: 'no render in tests' }) : net(spec);
					run.then((res) => window.CurioNative._resolve(id, JSON.stringify(res)));
				},
				close: () => { rec.closed = true; },
				clipped: () => { rec.clipped = true; },
				asset: curioAsset,
				openSettings: () => {},
				toast: () => {},
			};
		},
	});
	const w = dom.window;
	await waitFor(() => !w.document.getElementById('btnAdd').disabled || !w.document.getElementById('setup').classList.contains('hidden'));
	return { w, doc: w.document, rec };
}

async function waitFor(fn, ms = 4000) {
	const t0 = Date.now();
	while (!fn()) {
		if (Date.now() - t0 > ms) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 20));
	}
}

async function submit(ctx) {
	ctx.doc.getElementById('btnAdd').click();
	await waitFor(() => ctx.rec.refs.length > 0 || !ctx.doc.getElementById('err').classList.contains('hidden'));
	return ctx.rec.refs[0];
}

test('Instagram reel (signed in): caption cleaned, tags matched, reel stored as a file', async () => {
	const ctx = await openSheet({
		shared: { text: 'https://www.instagram.com/reel/DAbcReel01/?igsh=xyz', files: [] },
		sessions: { instagram: true },
		routes: { list: [{ match: 'https://www.instagram.com/api/v1/media/', res: { contentType: 'application/json', body: fixture('instagram-reel-api.json') } }] },
	});
	const { doc, rec } = ctx;
	assert.match(doc.getElementById('fetchMsg').textContent, /^Video · Instagram$/);
	assert.equal(doc.getElementById('title').value, 'Street food tour in Bangkok, part 3');
	assert.equal(doc.getElementById('board').value, '7', 'default board preselected');
	const pills = [...doc.querySelectorAll('.tgpill')].map((p) => p.textContent.replace('✕', '').trim());
	assert.deepEqual(pills.sort(), ['Street food', 'Thailand']);
	await waitFor(() => rec.detect.length > 0);
	assert.match(rec.detect[0], /placename=Yaowarat\+Road/);

	const ref = await submit(ctx);
	assert.equal(ref.type, 'video');
	assert.deepEqual(ref.video, { provider: 'file', src: 'curio-upload:vid1' });
	assert.equal(ref.img, 'curio-upload:img1');
	assert.equal(ref.source_url, 'https://www.instagram.com/reel/DAbcReel01/');
	assert.equal(ref.board, 7);
	assert.deepEqual(ref.tagIds.sort(), [11, 13]);
	assert.equal(rec.uploads[0].fromUrl, 'https://scontent.cdninstagram.com/reel_cover.jpg');
	assert.equal(rec.uploads[1].fromUrl, 'https://scontent.cdninstagram.com/reel_720.mp4');
	assert.equal(rec.uploads[1].expect, 'video/');
	assert.equal(rec.auth, 'Basic ' + Buffer.from('tom:aaaaa-bbbbb').toString('base64'));
	assert.ok(rec.clipped, 'Curio is told to refresh');
	await waitFor(() => rec.closed, 3000);
});

test('Instagram post (not signed in): embed caption beats the server login wall; sign-in hint hidden', async () => {
	const ctx = await openSheet({
		shared: { text: 'https://www.instagram.com/p/C8xYz12AbCd/', files: [] },
		routes: { list: [{ match: 'https://www.instagram.com/p/C8xYz12AbCd/embed/captioned/', res: { body: fixture('instagram-embed.html') } }] },
	});
	const { doc } = ctx;
	assert.match(doc.getElementById('fetchMsg').textContent, /^Image link · Instagram$/);
	assert.equal(doc.getElementById('title').value, 'Golden hour at the Calanques de Cassis');
	assert.equal(doc.getElementById('desc').value, 'Hiked from Port-Miou with');
	assert.equal(doc.getElementById('notes').children.length, 0);
	assert.ok(doc.querySelectorAll('.imgpick-thumb').length >= 3, 'carousel chooser');
	const chips = [...doc.querySelectorAll('#hashSug .hashsug-chip')].map((c) => c.textContent);
	assert.deepEqual(chips, ['#calanques', '#provence', '#hiking']);

	// Turn one hashtag into a new tag, as in the app.
	doc.querySelector('#hashSug .hashsug-chip').click();
	const ref = await submit(ctx);
	assert.equal(ref.type, 'image_url');
	assert.equal(ref.img, 'curio-upload:img1');
	assert.deepEqual(ref.tagIds, [50]);
});

test('Pinterest short link: title + description from the device, server image list ignored', async () => {
	const ctx = await openSheet({
		shared: { text: 'Check out this Pin! https://pin.it/3xYzAbc', files: [] },
		routes: {
			fetchMeta: { type: 'image_url', title: 'Pinterest', description: 'Discover recipes', image: 'https://i.pinimg.com/736x/wrong.jpg', images: ['https://i.pinimg.com/736x/wrong.jpg'] },
			list: [
				{ match: 'https://pin.it/', res: { url: 'https://www.pinterest.com/pin/1027524789823412345/sent/?invite_code=abc', body: '' } },
				{ match: 'https://widgets.pinterest.com/', res: { contentType: 'application/json', body: fixture('pinterest-widget.json') } },
			],
		},
	});
	const { doc } = ctx;
	assert.equal(doc.getElementById('title').value, 'Warm Scandinavian living room');
	assert.equal(doc.getElementById('desc').value, 'Scandinavian living room with warm wood tones, linen sofa and a jute rug.');
	const pills = [...doc.querySelectorAll('.tgpill')].map((p) => p.textContent.replace('✕', '').trim());
	assert.deepEqual(pills, ['Interior design']);
	const ref = await submit(ctx);
	assert.equal(ref.type, 'image_url');
	assert.equal(ref.source_url, 'https://www.pinterest.com/pin/1027524789823412345/');
	assert.equal(ctx.rec.uploads[0].fromUrl, 'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg');
});

test('Photo shared from the gallery is uploaded as an image reference', async () => {
	const ctx = await openSheet({
		shared: { text: '', files: [{ index: 0, name: 'IMG_2041.jpg', mime: 'image/jpeg', size: 2048000, uri: 'content://media/external/images/1' }] },
		routes: { list: [] },
	});
	assert.equal(ctx.doc.getElementById('title').value, 'IMG_2041');
	const ref = await submit(ctx);
	assert.equal(ref.type, 'image');
	assert.equal(ref.img, 'curio-upload:img1');
	assert.equal(ctx.rec.uploads[0].shared, 0);
});

test('Not connected: the sheet asks to connect instead of clipping', async () => {
	const ctx = await openSheet({ shared: { text: 'https://example.com' }, routes: { list: [] }, config: {} });
	assert.ok(!ctx.doc.getElementById('setup').classList.contains('hidden'));
});

test('Share sheet follows Curio\'s language and theme', async () => {
	const ctx = await openSheet({
		shared: { text: 'https://www.instagram.com/p/C8xYz12AbCd/', files: [] },
		config: { server: SERVER, user: 'tom', appPassword: 'aaaaa-bbbbb', look: { theme: 'dark', primary: '#00679e', lang: 'fr' } },
		routes: { list: [{ match: 'https://www.instagram.com/p/C8xYz12AbCd/embed/captioned/', res: { body: fixture('instagram-embed.html') } }] },
	});
	const { doc } = ctx;
	assert.equal(doc.getElementById('root').getAttribute('data-rbtheme'), 'dark');
	assert.equal(doc.getElementById('root').style.getPropertyValue('--color-primary-element'), '#00679e');
	assert.equal(doc.querySelector('.mhead h2').textContent, 'Ajouter une référence');
	assert.equal(doc.getElementById('btnAdd').textContent, 'Ajouter au tableau');
	assert.match(doc.getElementById('fetchMsg').textContent, /Instagram$/);
});
