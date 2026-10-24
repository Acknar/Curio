// End-to-end: the built clip window (Curio for Android's share dialog on the browser
// bridge) in jsdom, fed with what the content script read from a page, with a fake
// network standing in for the sites and the Curio server. Asserts on the reference
// payload that gets posted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVER, fixture, openClip, submit, waitFor } = require('./helpers');

const page = (extra) => Object.assign({
	url: 'https://blog.example.com/joinery', pageUrl: 'https://blog.example.com/joinery', site: 'web',
	title: 'A guide to Japanese joinery', description: 'Twelve classic joints and how to cut them by hand.',
	image: 'https://blog.example.com/images/joinery.jpg', images: ['https://blog.example.com/images/joinery.jpg', 'https://blog.example.com/images/saw.jpg'],
	video: null, selection: '', kind: 'link', ctx: { target: '', link: false, selection: false },
}, extra || {});

test('Website from the toolbar: the page as read in the tab, image uploaded from the browser', async () => {
	const ctx = await openClip({ clip: page() });
	const { doc, rec } = ctx;
	assert.equal(doc.getElementById('title').value, 'A guide to Japanese joinery');
	assert.equal(doc.getElementById('desc').value, 'Twelve classic joints and how to cut them by hand.');
	assert.equal(doc.getElementById('board').value, '7', 'default board preselected');
	assert.equal(doc.querySelectorAll('.imgpick-thumb').length, 2, 'image chooser');
	const ref = await submit(ctx);
	assert.equal(ref.type, 'link');
	assert.equal(ref.source_url, 'https://blog.example.com/joinery');
	assert.equal(ref.img, 'curio-upload:img1');
	assert.equal(ref.board, 7);
	assert.equal(rec.uploads[0].type, 'image/png');
	assert.equal(rec.auth, 'Basic ' + Buffer.from('tom:aaaaa-bbbbb').toString('base64'));
	const curio = rec.requests.find((r) => r.url.includes('/api/clip/reference'));
	assert.equal(curio.opts.credentials, 'omit', 'never sends cookies to Nextcloud');
	await waitFor(() => rec.closed, 3000);
});

test('Right-clicked image: that image is imported, as an image', async () => {
	const target = 'https://blog.example.com/images/saw.jpg';
	const ctx = await openClip({ clip: page({ kind: 'image', ctx: { target: target, link: false, selection: false } }) });
	assert.match(ctx.doc.getElementById('fetchMsg').textContent, /^Image link/);
	const ref = await submit(ctx);
	assert.equal(ref.type, 'image_url');
	assert.equal(ctx.rec.uploads.length, 1);
	const dl = ctx.rec.requests.find((r) => r.url === target);
	assert.ok(dl, 'downloads the clicked image');
});

test('Selected text: saved as a note with the page as its source', async () => {
	const ctx = await openClip({ clip: page({ kind: 'text', selection: 'Mortise and tenon joints need no glue.', ctx: { target: '', link: false, selection: true } }) });
	const { doc } = ctx;
	assert.ok(!doc.getElementById('bodyField').classList.contains('hidden'));
	assert.equal(doc.getElementById('body').value, 'Mortise and tenon joints need no glue.');
	const ref = await submit(ctx);
	assert.equal(ref.type, 'text');
	assert.equal(ref.body, 'Mortise and tenon joints need no glue.');
	assert.equal(ref.source_url, 'https://blog.example.com/joinery');
});

test('Right-clicked link to another page: read like a shared link, not from the open page', async () => {
	const ctx = await openClip({
		clip: page({ url: 'https://other.example.com/article', title: 'Open page title', ctx: { target: '', link: true, selection: false } }),
		fetchMeta: { type: 'link', title: 'A guide to Japanese joinery', description: 'Twelve classic joints and how to cut them by hand.', image: 'https://other.example.com/images/joinery.jpg' },
		routes: [{ match: 'https://other.example.com/article', res: { body: fixture('generic-article.html') } }],
	});
	assert.equal(ctx.doc.getElementById('title').value, 'A guide to Japanese joinery');
	const ref = await submit(ctx);
	assert.equal(ref.source_url, 'https://other.example.com/article');
});

test('Instagram post in a signed-in browser: API with the browser\'s cookies, then the page fills gaps', async () => {
	const ctx = await openClip({
		clip: {
			url: 'https://www.instagram.com/p/C8xYz12AbCd/', pageUrl: 'https://www.instagram.com/', site: 'instagram',
			title: '', description: 'Golden hour at the Calanques', image: 'https://scontent.cdninstagram.com/dom.jpg', images: ['https://scontent.cdninstagram.com/dom.jpg'],
			video: null, selection: '', kind: 'image', ctx: { target: '', link: false, selection: false },
		},
		fetchMeta: { type: 'link', title: 'Instagram', description: 'Log in to see photos', image: null },
		routes: [{ match: 'https://www.instagram.com/api/v1/media/', res: { contentType: 'application/json', body: fixture('instagram-api.json') } }],
	});
	const { doc, rec } = ctx;
	assert.equal(doc.getElementById('title').value, 'Golden hour at the Calanques de Cassis');
	const api = rec.requests.find((r) => r.url.startsWith('https://www.instagram.com/api/v1/media/'));
	assert.equal(api.opts.credentials, 'include', 'uses the browser sign-in');
	assert.equal(api.opts.headers['X-IG-App-ID'], '936619743392459');
	assert.ok(doc.querySelectorAll('.imgpick-thumb').length >= 2, 'carousel images in the chooser');
	assert.equal(doc.getElementById('geoDetectedTxt').textContent, 'Calanques de Cassis', 'tagged location used');
	const ref = await submit(ctx);
	assert.equal(ref.source_url, 'https://www.instagram.com/p/C8xYz12AbCd/');
	assert.deepEqual(ref.geo, { lat: 43.2105, lng: 5.4512, place: 'Calanques de Cassis', source: 'page' });
});

test('Instagram when the API answers nothing: the post as read in the tab', async () => {
	const ctx = await openClip({
		clip: {
			url: 'https://www.instagram.com/p/C8xYz12AbCd/', pageUrl: 'https://www.instagram.com/p/C8xYz12AbCd/', site: 'instagram',
			title: '', description: 'Golden hour at the Calanques de Cassis\nHiked from Port-Miou #provence', image: 'https://scontent.cdninstagram.com/dom.jpg', images: ['https://scontent.cdninstagram.com/dom.jpg'],
			video: null, selection: '', kind: 'image', ctx: { target: '', link: false, selection: false },
		},
		fetchMeta: { type: 'link', title: 'Instagram', description: 'Log in to see photos', image: null },
	});
	const { doc } = ctx;
	assert.equal(doc.getElementById('title').value, 'Golden hour at the Calanques de Cassis');
	assert.equal(doc.getElementById('prevImg').getAttribute('src'), 'https://scontent.cdninstagram.com/dom.jpg');
	const chips = [...doc.querySelectorAll('#hashSug .hashsug-chip')].map((c) => c.textContent);
	assert.deepEqual(chips, ['#provence']);
});

test('Clip window follows Curio\'s language, with the clipper\'s own wording', async () => {
	const ctx = await openClip({
		clip: page(),
		config: { server: SERVER, user: 'tom', appPassword: 'x', look: { lang: 'fr' } },
		routes: [],
	});
	assert.equal(ctx.doc.querySelector('.mhead h2').textContent, 'Ajouter une référence');
	assert.equal(ctx.doc.getElementById('btnConnect').textContent, 'Ouvrir les paramètres du clipper');
});
