// page-extractors.js (shared with Curio for Android) on Instagram pages built in
// jsdom: which post is clipped, and which video file goes with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'ui', 'page-extractors.js'), 'utf8');

function pageAt(url, body) {
	const dom = new JSDOM('<!DOCTYPE html><html><head><meta property="og:image" content="https://scontent.cdninstagram.com/first.jpg"></head><body>' + body + '</body></html>', { url: url, runScripts: 'outside-only' });
	dom.window.eval(SRC + '\n;window.CurioExtract = CurioExtract;');
	return dom.window.CurioExtract;
}

const item = (code, mp4, extra) => Object.assign({ code: code, media_type: 2, product_type: 'clips', video_versions: [{ width: 480, url: mp4 + '?w=480' }, { width: 720, url: mp4 }] }, extra || {});
const json = (o) => '<script type="application/json">' + JSON.stringify(o) + '</script>';

test('Reels viewer: the reel in the address bar, with its own video from the page data', () => {
	const data = { require: [{ feed: { items: [item('FIRSTreel1', 'https://scontent.cdninstagram.com/first.mp4'), item('PLAYING02', 'https://scontent.cdninstagram.com/playing.mp4')] } }] };
	const X = pageAt('https://www.instagram.com/reels/PLAYING02/',
		'<a href="/reel/FIRSTreel1/">suggested</a><div><video></video></div>' + json(data));
	const d = X.page({ pageUrl: 'https://www.instagram.com/reels/PLAYING02/' });
	assert.equal(d.kind, 'video');
	assert.equal(d.url, 'https://www.instagram.com/reel/PLAYING02/');
	assert.equal(d.videoFileUrl, 'https://scontent.cdninstagram.com/playing.mp4', 'largest version of the reel playing');
});

test('A reel whose data is not on the page gets no video file, never another reel\'s', () => {
	const data = { feed: { items: [item('FIRSTreel1', 'https://scontent.cdninstagram.com/first.mp4')] } };
	const X = pageAt('https://www.instagram.com/reels/LATERreel3/', '<div><video></video></div>' + json(data) +
		'<script>var x = {"url":"https://scontent.cdninstagram.com/dash_segment_only_video.mp4","video_versions":1}; // LATERreel3</script>');
	const d = X.page({ pageUrl: 'https://www.instagram.com/reels/LATERreel3/' });
	assert.equal(d.url, 'https://www.instagram.com/reel/LATERreel3/');
	assert.equal(d.videoFileUrl, '');
});

test('Home feed: a right-clicked post link names the post', () => {
	const X = pageAt('https://www.instagram.com/', '<article><a href="/p/POSTlink9/"><img src="https://scontent.cdninstagram.com/a.jpg" width="600"></a></article>');
	const d = X.page({ pageUrl: 'https://www.instagram.com/', linkUrl: 'https://www.instagram.com/reel/OTHERreel7/' });
	assert.equal(d.url, 'https://www.instagram.com/reel/OTHERreel7/');
});
