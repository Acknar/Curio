const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, loadScripts, fakeNet } = require('./helpers');

function setup(routes, sessions) {
	const ctx = loadScripts(['taglogic.js', 'cleanup.js', 'extract.js']);
	const E = ctx.Extract;
	const log = [];
	E.http = fakeNet(routes || [], log);
	E.render = async () => ({ error: 'render-disabled-in-tests' });
	E.sessions = () => sessions || {};
	return { E, ctx, log };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const json = (name) => ({ body: fixture(name), contentType: 'application/json' });
const html = (name) => ({ body: fixture(name), contentType: 'text/html; charset=utf-8' });

test('finds and cleans shared URLs', () => {
	const { E } = setup();
	assert.equal(E.findUrl('Look at this https://www.instagram.com/reel/C9abc/?igsh=MWQ1 nice'), 'https://www.instagram.com/reel/C9abc/?igsh=MWQ1');
	assert.equal(E.cleanUrl('https://www.instagram.com/reel/C9abc/?igsh=MWQ1ZGUx'), 'https://www.instagram.com/reel/C9abc/');
	assert.equal(E.cleanUrl('https://x.com/archfan/status/18123?s=46&t=abc'), 'https://x.com/archfan/status/18123');
	assert.equal(E.cleanUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=xyz&t=42'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
	assert.equal(E.cleanUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dfb&h=x'), 'https://example.com/a');
	assert.equal(E.findUrl('(https://example.com/page).'), 'https://example.com/page');
});

test('recognises sites and short links', () => {
	const { E } = setup();
	assert.equal(E.site('https://www.instagram.com/p/x/'), 'instagram');
	assert.equal(E.site('https://fr.pinterest.com/pin/123/'), 'pinterest');
	assert.equal(E.site('https://www.pinterest.co.uk/pin/123/'), 'pinterest');
	assert.equal(E.site('https://m.youtube.com/watch?v=a'), 'youtube');
	assert.equal(E.site('https://twitter.com/a/status/1'), 'x');
	assert.equal(E.site('https://www.threads.net/@a/post/x'), 'threads');
	assert.ok(E.isShort('https://pin.it/3xYzAbc'));
	assert.ok(E.isShort('https://vm.tiktok.com/ZMabc/'));
	assert.ok(E.isShort('https://www.reddit.com/r/woodworking/s/AbC123'));
	assert.ok(!E.isShort('https://www.pinterest.com/pin/123/'));
});

test('Instagram shortcode to media id', () => {
	const { E } = setup();
	assert.equal(E.igPk('A'), '0');
	assert.equal(E.igPk('B'), '1');
	assert.equal(E.igPk('BA'), '64');
	assert.equal(E.igPk('_'), '63');
	// 39-character private-post codes use their first 11 characters.
	assert.equal(E.igPk('C8xYz12AbCd' + 'x'.repeat(28)), E.igPk('C8xYz12AbCd'));
});

test('Instagram embed page: caption, carousel and place from the embedded JSON', () => {
	const { E } = setup();
	const part = E.igParseEmbed(fixture('instagram-embed.html'));
	assert.match(part.description, /^Golden hour at the Calanques de Cassis 🌅\nHiked from Port-Miou/);
	assert.match(part.description, /#calanques #provence #hiking$/);
	assert.deepEqual(plain(part.images.slice(0, 1)), ['https://scontent-cdg4-1.cdninstagram.com/v/t51.29350-15/449_n.jpg?stp=dst-jpg_e35_p1080x1080&_nc_ht=x']);
	assert.ok(part.images.includes('https://scontent.cdninstagram.com/v/full_1.jpg?a=1&b=2'));
	assert.ok(part.images.includes('https://scontent.cdninstagram.com/v/full_2.jpg'));
	assert.equal(part.placeHint, 'Calanques de Cassis');
});

test('Instagram embed page without JSON falls back to the caption block', () => {
	const { E } = setup();
	const part = E.igParseEmbed(fixture('instagram-embed-dom-only.html'));
	assert.equal(part.description, 'Tarte tatin, the real recipe.\nButter, sugar, apples. That is all. #baking');
	assert.deepEqual(plain(part.images), ['https://scontent.cdninstagram.com/v/only.jpg?x=1&y=2']);
});

test('Instagram API item: carousel images, location with coordinates', () => {
	const { E } = setup();
	const item = JSON.parse(fixture('instagram-api.json')).items[0];
	const part = E.igFromItem(item);
	assert.deepEqual(plain(part.images), ['https://scontent.cdninstagram.com/c1_1440.jpg', 'https://scontent.cdninstagram.com/c2_poster.jpg']);
	assert.equal(part.kind, 'image');
	assert.deepEqual(plain(part.geo), { lat: 43.2105, lng: 5.4512, place: 'Calanques de Cassis', source: 'page' });
	assert.equal(part.videoFileUrl, undefined);
});

test('Instagram API reel: video file and place hint', () => {
	const { E } = setup();
	const part = E.igFromItem(JSON.parse(fixture('instagram-reel-api.json')).items[0]);
	assert.equal(part.kind, 'video');
	assert.equal(part.videoFileUrl, 'https://scontent.cdninstagram.com/reel_720.mp4');
	assert.equal(part.placeHint, 'Yaowarat Road');
});

test('run(): Instagram post without sign-in uses the public embed', async () => {
	const { E, log } = setup([
		{ match: 'https://www.instagram.com/p/C8xYz12AbCd/embed/captioned/', res: html('instagram-embed.html') },
	]);
	const out = await E.run({ text: 'https://www.instagram.com/p/C8xYz12AbCd/?igsh=abc' });
	assert.equal(out.site, 'instagram');
	assert.equal(out.url, 'https://www.instagram.com/p/C8xYz12AbCd/');
	assert.equal(out.kind, 'image');
	assert.match(out.description, /Calanques de Cassis/);
	assert.ok(out.images.length >= 3);
	assert.equal(out.placeHint, 'Calanques de Cassis');
	assert.ok(out.via.includes('instagram-embed'));
	assert.ok(!log.some((s) => s.url.includes('/api/v1/')), 'API not called without a session');
});

test('run(): Instagram with sign-in uses the API first, with cookies', async () => {
	const { E, log } = setup([
		{ match: 'https://www.instagram.com/api/v1/media/', res: json('instagram-reel-api.json') },
	], { instagram: true });
	const out = await E.run({ text: 'https://www.instagram.com/reel/DAbcReel01/' });
	assert.equal(out.kind, 'video');
	assert.equal(out.videoFileUrl, 'https://scontent.cdninstagram.com/reel_720.mp4');
	assert.equal(out.video.provider, 'instagram');
	assert.match(out.description, /Street food tour/);
	const api = log.find((s) => s.url.includes('/api/v1/media/'));
	assert.equal(api.cookies, true);
	assert.equal(api.headers['X-IG-App-ID'], '936619743392459');
	assert.ok(!log.some((s) => s.url.includes('/embed/')), 'embed skipped once the API answered');
});

test('run(): Instagram crawler page as last plain source, cleaned by Cleanup', async () => {
	const { E, ctx } = setup([
		{ match: 'https://www.instagram.com/p/C8xYz12AbCd/', res: (spec) => (spec.url.includes('/embed/') ? { status: 404, body: '' } : html('instagram-page-crawler.html')) },
	]);
	const out = await E.run({ text: 'https://www.instagram.com/p/C8xYz12AbCd/' });
	assert.match(out.description, /^1,204 likes/);
	assert.ok(out.notes.includes('instagram-signin'));
	const refined = ctx.Cleanup.refineMeta(out.title, out.description, out.url);
	// Same cleanup as the app: engagement prefix, quotes, @mention and emoji removed.
	// og:description flattens the caption to one line, so it all becomes the title;
	// the embed and API sources keep the line breaks for a proper title/description split.
	assert.equal(refined.title, 'Golden hour at the Calanques de Cassis Hiked from Port-Miou with #calanques');
});

test('run(): pin.it short link resolves, widget API gives title and description', async () => {
	const { E } = setup([
		{ match: 'https://pin.it/', res: { url: 'https://www.pinterest.com/pin/1027524789823412345/sent/?invite_code=abc&sfo=1', body: '' } },
		{ match: 'https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=1027524789823412345', res: json('pinterest-widget.json') },
	]);
	const out = await E.run({ text: 'Check out this Pin! https://pin.it/3xYzAbc' });
	assert.equal(out.url, 'https://www.pinterest.com/pin/1027524789823412345/');
	assert.equal(out.title, 'Warm Scandinavian living room');
	assert.match(out.description, /^Scandinavian living room/);
	assert.deepEqual(plain(out.images), ['https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg', 'https://i.pinimg.com/564x/ab/cd/ef/abcdef.jpg']);
	assert.equal(out.kind, 'image');
});

test('Pinterest page bootstrap JSON is used when the widget API fails', async () => {
	const { E } = setup([
		{ match: 'https://www.pinterest.com/pin/9988776655443322/', res: html('pinterest-page.html') },
	]);
	const out = await E.run({ text: 'https://www.pinterest.fr/pin/9988776655443322/' });
	assert.equal(out.title, 'Ceramic mug glaze ideas');
	assert.equal(out.description, 'Speckled glaze on stoneware, fired at cone 6.');
	assert.equal(out.images[0], 'https://i.pinimg.com/originals/99/88/77/998877.jpg');
});

test('Pinterest pin ids from slugged URLs', () => {
	const { E } = setup();
	assert.equal(E.pinId('https://www.pinterest.com/pin/cozy-reading-nook--123456789012/'), '123456789012');
	assert.equal(E.pinId('https://www.pinterest.com/pin/123456789012/'), '123456789012');
});

test('run(): TikTok oEmbed plus page data with the tagged place', async () => {
	const { E } = setup([
		{ match: 'https://vm.tiktok.com/', res: { url: 'https://www.tiktok.com/@foodie.anna/video/7412345678901234567?_t=8abc&_r=1', body: '' } },
		{ match: 'https://www.tiktok.com/oembed', res: { contentType: 'application/json', body: JSON.stringify({ title: 'Best croissant in Paris? Honest review 🥐 #paris #bakery', author_unique_id: 'foodie.anna', thumbnail_url: 'https://p16-sign.tiktokcdn.com/oembed_thumb.jpeg' }) } },
		{ match: 'https://www.tiktok.com/@foodie.anna/video/', res: html('tiktok-page.html') },
	]);
	const out = await E.run({ text: 'https://vm.tiktok.com/ZMabc/' });
	assert.equal(out.url, 'https://www.tiktok.com/@foodie.anna/video/7412345678901234567');
	assert.match(out.description, /^Best croissant in Paris/);
	assert.ok(out.images.includes('https://p16-sign.tiktokcdn.com/origin_cover.jpeg'));
	assert.equal(out.placeHint, 'Du Pain et des Idées, Paris');
	assert.equal(out.imageHeaders.Referer, 'https://www.tiktok.com/');
});

test('run(): X post via the syndication endpoint', async () => {
	const { E, log } = setup([
		{ match: 'https://cdn.syndication.twimg.com/tweet-result', res: json('tweet.json') },
	]);
	const out = await E.run({ text: 'https://x.com/archfan/status/1812345678901234567?s=46' });
	assert.equal(out.description, 'The new library in Aarhus is stunning. Concrete, glass and so much light.');
	assert.deepEqual(plain(out.images), ['https://pbs.twimg.com/media/GQabc1.jpg?name=large', 'https://pbs.twimg.com/media/GQabc2.jpg?name=large']);
	assert.equal(out.kind, 'image');
	assert.match(log[0].url, /token=[0-9a-z]+$/);
});

test('run(): Reddit post JSON', async () => {
	const { E, log } = setup([
		{ match: 'https://www.reddit.com/r/woodworking/comments/1abc/', res: json('reddit.json') },
	]);
	const out = await E.run({ text: 'https://www.reddit.com/r/woodworking/comments/1abc/my_first_dovetail/?share_id=x&utm_medium=android_app' });
	assert.equal(out.title, 'My first hand-cut dovetail joint');
	assert.equal(out.description, 'Took about 3 hours. Walnut and maple.');
	assert.equal(out.images[0], 'https://i.redd.it/abc123.jpg');
	assert.equal(out.images[1], 'https://preview.redd.it/abc123.jpg?width=1080&auto=webp&s=xyz');
	assert.match(log[0].url, /\/comments\/1abc\/my_first_dovetail\.json\?raw_json=1/);
});

test('run(): YouTube Shorts link, full description from the page', async () => {
	const { E } = setup([
		{ match: 'https://www.youtube.com/oembed', res: { contentType: 'application/json', body: JSON.stringify({ title: 'How to sharpen a chisel', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }) } },
		{ match: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', res: html('youtube-page.html') },
	]);
	const out = await E.run({ text: 'https://youtube.com/shorts/dQw4w9WgXcQ?si=abc' });
	assert.equal(out.kind, 'video');
	assert.equal(out.video.provider, 'youtube');
	assert.equal(out.title, 'How to sharpen a chisel');
	assert.match(out.description, /^In this video I show my full sharpening routine\.\nStones/);
});

test('run(): generic page metadata with relative og:image', async () => {
	const { E } = setup([
		{ match: 'https://blog.example.com/joinery', res: html('generic-article.html') },
	]);
	const out = await E.run({ text: 'https://blog.example.com/joinery', subject: 'Joinery guide' });
	assert.equal(out.title, 'A guide to Japanese joinery');
	assert.equal(out.description, 'Twelve classic joints and how to cut them by hand.');
	assert.deepEqual(plain(out.images), ['https://blog.example.com/images/joinery.jpg']);
});

test('run(): text without a link becomes a note; files are passed through', async () => {
	const { E } = setup();
	const note = await E.run({ text: 'Remember: buy linseed oil', subject: 'Shopping' });
	assert.equal(note.kind, 'text');
	assert.equal(note.selection, 'Remember: buy linseed oil');
	assert.equal(note.title, 'Shopping');
	const img = await E.run({ files: [{ index: 0, name: 'IMG_2041.jpg', mime: 'image/jpeg', size: 1000 }] });
	assert.equal(img.kind, 'file-image');
	assert.equal(img.title, 'IMG_2041');
	const pdf = await E.run({ files: [{ index: 0, name: 'plans.pdf', mime: 'application/pdf' }] });
	assert.equal(pdf.kind, 'file-pdf');
	const vid = await E.run({ files: [{ index: 0, name: 'clip.mp4', mime: 'video/mp4' }] });
	assert.equal(vid.kind, 'file-video');
});

test('run(): render fallback fills an empty result', async () => {
	const { E } = setup([]);
	E.render = async (url) => ({ title: 'Rendered', description: 'From the live page', images: ['https://cdn.example.com/a.jpg'], kind: 'image', finalUrl: url });
	const out = await E.run({ text: 'https://spa.example.com/item/42' });
	assert.equal(out.description, 'From the live page');
	assert.ok(out.via.includes('render'));
});
