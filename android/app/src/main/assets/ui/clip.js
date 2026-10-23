// clip.js - the share sheet: Curio's "Add reference" dialog (same markup, styles,
// wording and behaviour as the app's Link / URL tab), fed by extract.js from what
// was shared, uploading media through the phone, then POST /api/clip/reference.

/* global Android, CurioNative, CURIO, Look, TagLogic, Cleanup, Extract, parseVideo, domainOf */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.classList.toggle('hidden', !on); };
const tr = (s, v) => Look.tr(s, v);

// Platforms where the phone reads more than the Nextcloud server can (login walls,
// datacentre IP blocks). There the on-device result wins and the server only fills
// gaps; everywhere else the server's fetch is authoritative, as in the app itself.
const DEVICE_FIRST = ['instagram', 'pinterest', 'tiktok', 'x', 'reddit', 'facebook', 'threads'];

let cfg = null;
let state = null;      // { boards, tags, folders, lang }
let clip = null;       // payload from extract.js
let rawTitle = '', rawDesc = '';
let busy = false;
const sel = {
	type: 'link',
	image: '',
	images: [],
	video: null,
	tags: [],
	hashtags: [],
	geo: null,
};

// Curio's TYPE_NAME.
const TYPE_NAME = { image: 'Image', link: 'Web page', image_url: 'Image link', text: 'Text note', video: 'Video', pdf: 'PDF' };
const SITE_NAMES = { instagram: 'Instagram', pinterest: 'Pinterest', tiktok: 'TikTok', x: 'X', reddit: 'Reddit', youtube: 'YouTube', vimeo: 'Vimeo', facebook: 'Facebook', threads: 'Threads' };

function kindToType(kind) {
	return {
		image: 'image_url', image_url: 'image_url', video: 'video', pdf: 'pdf', text: 'text', link: 'link',
		'file-image': 'image', 'file-pdf': 'pdf', 'file-video': 'video',
	}[kind] || 'link';
}

function setMsg(html) { $('fetchMsg').innerHTML = html; }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function close() { Android.close(); }

window.CurioApp = {
	back() {
		for (const id of ['tagSug', 'geoSug']) {
			if (!$(id).classList.contains('hidden')) { show($(id), false); return true; }
		}
		return false;
	},
};

async function init() {
	Look.init($('root'));
	wireStatic();
	cfg = CURIO.getConfig();
	if (!CURIO.configured(cfg)) {
		return showSetup(tr('Connect Curio to your Nextcloud once, then share from any app to add references.'));
	}
	setMsg(tr('Fetching...'));

	const shared = CurioNative.shared();
	Extract.progress = (t) => setMsg(esc(tr(t)));

	const statePromise = CURIO.state(cfg).catch((e) => ({ _error: e }));
	clip = await Extract.run(shared);

	// The server's own fetch, exactly like the app's add dialog, for links.
	let meta = null;
	if (clip.url && !clip.file && clip.kind !== 'text') {
		setMsg(tr('Fetching...'));
		meta = await CURIO.fetchMeta(clip.url, cfg).catch(() => null);
	}

	state = await statePromise;
	if (state && state._error) {
		const e = state._error;
		if (e.status === 401) return showSetup(tr('Nextcloud refused the sign-in. Open Curio and connect again.'));
		if (e.status === 404) return showSetup(tr('Curio 1.0.4 or later was not found on your Nextcloud. Update the Curio app there.'));
		return showSetup(tr('Could not reach your Nextcloud.') + ' (' + (e.message || 'network') + ')');
	}
	if (state.needsFolderSetup) {
		return showSetup(tr('Open Curio once and choose where it keeps your boards, then share again.'));
	}

	TagLogic.setTags(state.tags || []);
	buildForm(meta);
	wireForm();
	$('btnAdd').disabled = false;
}

function wireStatic() {
	$('btnClose').addEventListener('click', close);
	$('btnCancel').addEventListener('click', close);
	$('scrim').addEventListener('click', (e) => { if (e.target === $('scrim') && !busy) close(); });
	$('btnConnect').addEventListener('click', () => Android.openCurio());
}

function showSetup(msg) {
	show($('form'), false);
	show($('foot'), false);
	$('setupMsg').textContent = msg;
	show($('setup'), true);
}

/* ---------------- form ---------------- */

function buildForm(m) {
	sel.type = kindToType(clip.kind);
	sel.video = clip.video || null;

	const serverContent = !!(m && (m.title || m.description || m.image || (Array.isArray(m.images) && m.images.length) || m.video));
	const deviceFirst = DEVICE_FIRST.includes(clip.site);
	const deviceContent = !!(clip.title || clip.description);

	let baseTitle, baseDesc;
	if (serverContent && (!deviceFirst || !deviceContent)) {
		baseTitle = m.raw_title || m.title || clip.title || '';
		baseDesc = m.raw_desc || m.description || clip.description || '';
	} else {
		baseTitle = clip.title || '';
		baseDesc = clip.description || '';
		if (serverContent) {
			if (!baseTitle && !deviceFirst) baseTitle = m.raw_title || m.title || '';
			if (!baseDesc) baseDesc = m.raw_desc || m.description || '';
		}
	}

	if (m && m.type && clip.kind === 'link' && ['image_url', 'video', 'pdf'].includes(m.type)) sel.type = m.type;
	if (sel.type === 'video' && m && m.video && (!sel.video || !deviceFirst)) sel.video = m.video;
	if (clip.geo && clip.geo.lat != null) sel.geo = clip.geo;
	else if (m && m.geo && m.geo.lat != null) sel.geo = { lat: m.geo.lat, lng: m.geo.lng, place: m.geo.place || '', source: 'page' };

	const pv = clip.video || parseVideo(clip.url || '');
	if (pv && sel.type !== 'video' && !['text', 'image', 'pdf'].includes(sel.type) && clip.site !== 'tiktok') sel.type = 'video';
	if (sel.type === 'video' && !sel.video && !clip.file) sel.video = pv || null;

	// Images: the device's (scoped, full-resolution) first, then the server's,
	// except on device-first platforms where the server mostly sees a login wall.
	const imgSet = [];
	const pushImg = (u) => { if (u && !imgSet.includes(u)) imgSet.push(u); };
	(clip.images || []).forEach(pushImg);
	if (m && (!deviceFirst || !imgSet.length)) { pushImg(m.image); (Array.isArray(m.images) ? m.images : []).forEach(pushImg); }
	if (sel.type === 'video' && sel.video && sel.video.thumb) pushImg(sel.video.thumb);
	sel.images = imgSet;
	sel.image = imgSet[0] || '';
	// An "image" with no image to import is just a link.
	if (sel.type === 'image_url' && !sel.image && !/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(clip.url || '')) sel.type = 'link';

	rawTitle = baseTitle;
	rawDesc = baseDesc;

	// The app's title/description cleanup (engagement counts, quotes, @mentions,
	// emoji, short headline + de-duplicated description).
	const refined = Cleanup.refineMeta(baseTitle, baseDesc, clip.url || clip.pageUrl || '');
	clip.title = refined.title;
	clip.description = refined.description;

	renderNotes();

	const isText = sel.type === 'text';
	show($('descField'), !isText);
	show($('bodyField'), isText);
	show($('locField'), !isText);
	if (isText) $('body').value = clip.selection || clip.description || '';

	$('title').value = TagLogic.stripHashtags(clip.title || '') || '';

	if (!isText) {
		$('desc').value = TagLogic.stripHashtags(clip.description || '');
		const capTags = TagLogic.extractHashtags((clip.title || '') + ' \n ' + (clip.description || '')).tags;
		const remaining = [];
		for (const h of capTags) {
			const matches = TagLogic.matchHashtagTags(h);
			if (matches.length) { for (const mt of matches) addTag(mt, true); }
			else remaining.push(h);
		}
		sel.hashtags = remaining;
		for (const t of TagLogic.autoTagMatches(($('title').value || '') + ' \n ' + ($('desc').value || ''))) addTag(t, true);
	}

	renderPreview();

	const boardSel = $('board');
	boardSel.innerHTML = '';
	const mine = (state.boards || []).filter(b => b.mine);
	for (const b of mine) {
		const opt = document.createElement('option');
		opt.value = String(b.id);
		opt.textContent = b.name;
		boardSel.appendChild(opt);
	}
	const wantBoard = (cfg.defaultBoardId && mine.some(b => b.id === cfg.defaultBoardId)) ? cfg.defaultBoardId : (mine[0] && mine[0].id);
	if (wantBoard) boardSel.value = String(wantBoard);

	renderTags();
	renderHashSug();
	renderGeo();
	if (!isText) detectLocation();
}

function renderNotes() {
	const box = $('notes');
	box.innerHTML = '';
	const add = (html) => { const d = document.createElement('div'); d.className = 'sheet-note'; d.innerHTML = html; box.appendChild(d); return d; };
	if ((clip.notes || []).includes('instagram-signin')) {
		const d = add(esc(tr('Instagram only showed a preview of this post.')) + ' <a href="#">' + esc(tr('Sign in to Instagram')) + '</a> ' + esc(tr('to add private posts, full carousels and reels.')));
		d.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); Android.openSettings(); close(); });
	}
}

// The fetch preview row: picture + what was found, like Curio's .fetchprev.
function renderPreview() {
	const isFile = !!clip.file;
	const site = SITE_NAMES[clip.site] || domainOf(clip.url || clip.pageUrl) || '';
	const kind = tr(TYPE_NAME[sel.type] || 'Web page');

	if (isFile) {
		show($('fileBox'), sel.type !== 'image');
		const sz = clip.file.size > 0 ? ' (' + (clip.file.size / 1048576).toFixed(1) + ' MB)' : '';
		$('fileIcon').innerHTML = Look.icon(sel.type === 'video' ? 'video' : sel.type === 'pdf' ? 'pdf' : 'image', 18);
		$('fileName').textContent = (clip.file.name || 'shared') + sz;
		if (sel.type === 'image') {
			// The shared photo itself, via the content:// URI the sharing app granted.
			setPreview(clip.file.uri || '', '<b>' + esc(kind) + '</b>');
		} else {
			show($('prevRow'), false);
		}
		show($('imgPick'), false);
		return;
	}
	if (sel.type === 'text') {
		show($('prevRow'), false);
		show($('imgPick'), false);
		return;
	}
	const msg = '<b>' + esc(kind) + '</b>' + (site ? ' · ' + esc(site) : '');
	setPreview(sel.image, msg);

	const row = $('imgPickRow');
	row.innerHTML = '';
	const many = sel.images.filter(u => !!u);
	show($('imgPick'), many.length > 1);
	if (many.length > 1) {
		for (const u of many) {
			const b = document.createElement('button');
			b.className = 'imgpick-thumb' + (u === sel.image ? ' sel' : '');
			const im = document.createElement('img');
			im.src = u;
			im.onerror = () => { b.remove(); sel.images = sel.images.filter(x => x !== u); };
			b.appendChild(im);
			b.addEventListener('click', () => { sel.image = u; renderPreview(); });
			row.appendChild(b);
		}
	}
}

function setPreview(src, msg) {
	show($('prevRow'), true);
	$('prevRow').classList.toggle('loading', !src);
	setMsg(msg);
	const img = $('prevImg');
	if (!src) { img.removeAttribute('src'); return; }
	img.src = src;
	img.onerror = () => {
		// Drop a broken candidate (an "originals" size that does not exist...) and try the next.
		if (clip.file) { $('prevRow').classList.add('loading'); return; }
		sel.images = sel.images.filter(u => u !== sel.image);
		sel.image = sel.images[0] || '';
		renderPreview();
	};
}

/* ---------------- tags ---------------- */

function addTag(t, silent) {
	if (!t || sel.tags.some(x => x.id === t.id)) return;
	sel.tags.push(t);
	if (!silent) renderTags();
}

function renderTags() {
	const wrap = $('tagPills');
	wrap.querySelectorAll('.tgpill').forEach(el => el.remove());
	const input = $('tagInput');
	for (const t of sel.tags) {
		const pill = document.createElement('span');
		pill.className = 'tgpill';
		pill.style.background = t.color || '#888';
		pill.style.color = Look.textOn(t.color);
		pill.textContent = t.name + ' ';
		const x = document.createElement('span');
		x.className = 'x';
		x.textContent = '✕';
		x.addEventListener('click', () => { sel.tags = sel.tags.filter(y => y.id !== t.id); renderTags(); });
		pill.appendChild(x);
		wrap.insertBefore(pill, input);
	}
}

function renderHashSug() {
	const box = $('hashSug');
	box.querySelectorAll('.hashsug-chip').forEach(el => el.remove());
	show(box, sel.hashtags.length > 0);
	for (const h of sel.hashtags) {
		const c = document.createElement('button');
		c.className = 'hashsug-chip';
		c.textContent = '#' + h;
		c.addEventListener('click', () => {
			const matches = TagLogic.matchHashtagTags(h);
			if (matches.length) { for (const mt of matches) addTag(mt, true); }
			else addTag({ id: 'new:' + h, name: h, color: '#888', _new: true }, true);
			sel.hashtags = sel.hashtags.filter(x => x !== h);
			renderTags();
			renderHashSug();
		});
		box.appendChild(c);
	}
}

function tagSuggestions(q) {
	const n = q.trim().toLowerCase();
	if (!n) return [];
	const have = new Set(sel.tags.map(t => t.id));
	return (state.tags || []).filter(t => !have.has(t.id) && (t.name || '').toLowerCase().includes(n)).slice(0, 8);
}

/* ---------------- location ---------------- */

function renderGeo() {
	const d = $('geoDetected');
	if (sel.geo && sel.geo.lat != null) {
		show(d, true);
		$('geoDetectedTxt').textContent = sel.geo.place || (Number(sel.geo.lat).toFixed(4) + ', ' + Number(sel.geo.lng).toFixed(4));
		$('geoQuery').placeholder = tr('Change location...');
	} else {
		show(d, false);
		$('geoQuery').placeholder = tr('Search a place or address...');
	}
}

async function detectLocation() {
	if (sel.geo) return;
	show($('geoBusy'), true);
	try {
		const hashtags = [...sel.tags.map(t => t.name), ...sel.hashtags].join(' ');
		const params = {
			title: (rawTitle || $('title').value || '').trim(),
			desc: (rawDesc || $('desc').value || '').trim(),
			hashtags: hashtags,
			lang: (state.lang || ''),
		};
		// A place the platform itself tagged (Instagram location, TikTok POI...).
		if (clip.placeHint) params.placename = clip.placeHint;
		const res = await CURIO.detect(params, cfg);
		const list = (res && res.results) || [];
		renderGeoSuggestions(list);
	} catch (e) { /* best-effort */ }
	finally { show($('geoBusy'), false); }
}

function renderGeoSuggestions(list) {
	const box = $('geoSuggestions');
	box.innerHTML = '';
	show(box, list.length > 0);
	if (!list.length) return;
	const lbl = document.createElement('span');
	lbl.className = 'hashsug-lbl';
	lbl.textContent = list.length > 1 ? tr('Suggested places:') : tr('Suggested:');
	box.appendChild(lbl);
	for (const s of list) {
		const c = document.createElement('button');
		c.className = 'hashsug-chip';
		c.title = s.place || '';
		c.innerHTML = Look.icon('pin', 12) + ' ' + esc((s.place || '').split(',')[0]);
		c.addEventListener('click', () => {
			sel.geo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' };
			box.querySelectorAll('.hashsug-chip').forEach(x => x.classList.toggle('hashsug-chip-on', x === c));
			renderGeo();
		});
		box.appendChild(c);
	}
}

let geoTimer = null;
function onGeoInput() {
	const q = $('geoQuery').value.trim();
	clearTimeout(geoTimer);
	if (q.length < 3) { show($('geoSug'), false); return; }
	geoTimer = setTimeout(async () => {
		try {
			const res = await CURIO.suggest(q, state.lang, cfg);
			const rows = (res && res.results) || [];
			const box = $('geoSug');
			box.innerHTML = '';
			show(box, rows.length > 0);
			for (const s of rows) {
				const r = document.createElement('div');
				r.className = 'tagsug-row';
				r.innerHTML = '<span class="geo-sug-ic">' + Look.icon('pin', 13) + '</span><span class="geo-sug-txt">' + esc(s.place) + '</span>';
				r.addEventListener('mousedown', (ev) => {
					ev.preventDefault();
					sel.geo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' };
					$('geoQuery').value = '';
					show(box, false);
					renderGeo();
				});
				box.appendChild(r);
			}
		} catch (e) { show($('geoSug'), false); }
	}, 380);
}

/* ---------------- wiring ---------------- */

function wireForm() {
	$('geoClear').addEventListener('click', () => { sel.geo = null; renderGeo(); detectLocation(); });
	$('geoQuery').addEventListener('input', onGeoInput);
	$('geoQuery').addEventListener('blur', () => setTimeout(() => show($('geoSug'), false), 150));

	const tagInput = $('tagInput');
	tagInput.addEventListener('input', () => {
		const box = $('tagSug');
		// A typed comma or semicolon commits the tag, as in the app.
		if (/[,;]/.test(tagInput.value)) {
			const name = tagInput.value.replace(/[,;]/g, '').trim();
			if (name) commitTyped(name);
			tagInput.value = '';
			show(box, false);
			return;
		}
		const sugs = tagSuggestions(tagInput.value);
		box.innerHTML = '';
		show(box, sugs.length > 0 && tagInput.value.trim().length > 0);
		for (const t of sugs) {
			const r = document.createElement('div');
			r.className = 'tagsug-row';
			const dot = document.createElement('span');
			dot.className = 'tagsug-c';
			dot.style.background = t.color || '#888';
			r.appendChild(dot);
			r.appendChild(document.createTextNode(t.name));
			r.addEventListener('mousedown', (ev) => { ev.preventDefault(); addTag(t); tagInput.value = ''; show(box, false); });
			box.appendChild(r);
		}
	});
	tagInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			const sugs = tagSuggestions(tagInput.value);
			if (sugs.length) addTag(sugs[0]);
			else if (tagInput.value.trim()) commitTyped(tagInput.value.trim());
			tagInput.value = '';
			show($('tagSug'), false);
		}
	});
	tagInput.addEventListener('blur', () => setTimeout(() => show($('tagSug'), false), 150));

	$('btnAdd').addEventListener('click', onSubmit);
}

function commitTyped(name) {
	const exact = (state.tags || []).find(t => (t.name || '').toLowerCase() === name.toLowerCase());
	addTag(exact || { id: 'new:' + name, name: name, color: '#888', _new: true });
}

/* ---------------- submit ---------------- */

// Download an image on the phone and store it in Curio; falls back to the URL so
// the server can try itself.
async function resolveImg(imgUrl) {
	if (!imgUrl) return null;
	if (typeof imgUrl === 'string' && imgUrl.startsWith('curio-upload:')) return imgUrl;
	try {
		const up = await CURIO.uploadImageFromUrl(imgUrl, clip.imageHeaders || {}, cfg);
		return up && up.img ? up.img : imgUrl;
	} catch (e) {
		return imgUrl;
	}
}

// Download a video file (Instagram reel, X video) on the phone and store it in
// Curio as a playable file. Returns a { provider:'file', src } video, or null.
async function storeVideo(mp4Url) {
	try {
		const up = await CURIO.uploadVideoFromUrl(mp4Url, clip.imageHeaders || {}, cfg);
		if (up && up.upload) return { provider: 'file', src: up.upload };
	} catch (e) { /* keep the embed */ }
	return null;
}

async function ensureTagIds() {
	const ids = [];
	const failed = [];
	for (const t of sel.tags) {
		if (t && typeof t.id === 'number') { ids.push(t.id); continue; }
		if (t && t._new) {
			try {
				const created = await CURIO.createTag(t.name, cfg);
				if (created && typeof created.id === 'number') ids.push(created.id);
				else failed.push(t.name);
			} catch (e) { failed.push(t.name); }
		}
	}
	return { ids, dropped: failed };
}

function toast(msg, kind) {
	const t = document.createElement('div');
	t.className = 'toast ' + (kind || '');
	t.textContent = msg;
	$('toasts').appendChild(t);
}

async function onSubmit() {
	if (busy) return;
	busy = true;
	const btn = $('btnAdd');
	btn.disabled = true;
	show($('err'), false);
	try {
		const mine = (state.boards || []).filter(b => b.mine);
		const board = mine.find(b => String(b.id) === $('board').value) || mine[0];
		if (!board) throw new Error(tr('No board to add to.'));
		const { ids: tagIds, dropped } = await ensureTagIds();
		const seed = Math.floor(Math.random() * 9999);
		const url = clip.url || '';
		const title = $('title').value.trim();
		const desc = $('desc').value;
		let payload;

		if (clip.file) {
			const isVideo = sel.type === 'video';
			btn.textContent = tr('Uploading...');
			const up = await CURIO.uploadShared(clip.file.index || 0, clip.file.name, isVideo, cfg);
			if (isVideo) {
				payload = { type: 'video', title: title || 'Video', video: { provider: 'file', src: up.upload }, img: null, desc, tagIds, seed };
			} else {
				payload = { type: sel.type === 'pdf' ? 'pdf' : 'image', title: title || 'Untitled upload', img: up.img, desc, tagIds, seed };
			}
		} else if (sel.type === 'text') {
			payload = { type: 'text', title: title || 'Untitled note', body: $('body').value, tagIds, seed };
			if (url) payload.source_url = url;
		} else if (sel.type === 'video') {
			let v = sel.video || parseVideo(url);
			const posterSrc = sel.image || (v && v.thumb ? v.thumb : null);
			const img = posterSrc ? await resolveImg(posterSrc) : null;
			if (clip.videoFileUrl) {
				btn.textContent = tr('Uploading...');
				const stored = await storeVideo(clip.videoFileUrl);
				if (stored) v = stored;
			}
			payload = { type: 'video', title: title || 'Video', source_url: url, video: v, img: img, desc, tagIds, seed };
		} else if (sel.type === 'image_url') {
			const img = await resolveImg(sel.image || url);
			payload = { type: 'image_url', title: title || (url.split('/').pop() || 'image'), source_url: url, img: img, desc, tagIds, seed };
		} else if (sel.type === 'pdf') {
			payload = { type: 'pdf', title: title || decodeURIComponent((url.split('/').pop() || 'document')).replace(/\.pdf$/i, ''), source_url: url, desc, tagIds, seed };
		} else {
			const img = sel.image ? await resolveImg(sel.image) : null;
			payload = { type: 'link', title: title || url || 'New reference', source_url: url, img: img, desc, tagIds, seed };
		}
		payload.board = board.id;
		if (sel.geo && sel.geo.lat != null && sel.geo.lng != null) {
			payload.geo = { lat: sel.geo.lat, lng: sel.geo.lng, place: sel.geo.place || null, source: sel.geo.source || 'page' };
		}

		btn.textContent = tr('Add to board');
		await CURIO.createReference(payload, cfg);
		Android.clipped();

		show($('scrim'), false);
		let msg = tr('Added to {board}.', { board: board.name });
		if (dropped.length) msg += ' ' + tr('New tags {tags} were skipped.', { tags: dropped.join(', ') });
		toast(msg, 'success');
		setTimeout(close, dropped.length ? 2600 : 1200);
	} catch (err) {
		busy = false;
		btn.disabled = false;
		btn.textContent = tr('Add to board');
		const el = $('err');
		el.textContent = (err && err.message) || tr('Could not add the reference.');
		show(el, true);
	}
}

init().catch((e) => {
	showSetup(tr('Something went wrong:') + ' ' + (e && e.message ? e.message : e));
});
