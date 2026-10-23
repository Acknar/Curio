// clip.js - the share sheet. Same form and behaviour as the Curio Web Clipper
// popup (board, image + chooser, title, description, detected location,
// hashtag-derived tags, then POST /api/clip/reference), fed by extract.js instead
// of a content script, and uploading media through the phone.

/* global Android, CurioNative, CURIO, TagLogic, Cleanup, Extract, parseVideo, domainOf */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.classList.toggle('hidden', !on); };

// Platforms where the phone reads more than the Nextcloud server can (login walls,
// datacentre IP blocks). There the on-device result wins and the server only fills
// gaps; everywhere else the server's fetch is authoritative, as in the app itself.
const DEVICE_FIRST = ['instagram', 'pinterest', 'tiktok', 'x', 'reddit', 'facebook', 'threads'];

let cfg = null;
let state = null;      // { boards, tags, folders, lang }
let clip = null;       // payload from extract.js
let rawTitle = '', rawDesc = '';
const sel = {
	type: 'link',
	image: '',
	images: [],
	video: null,
	tags: [],
	hashtags: [],
	geo: null,
};

function textOn(hex) {
	if (!hex) return '#ffffff';
	const c = hex.replace('#', '');
	if (c.length < 6) return '#ffffff';
	const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111111' : '#ffffff';
}

function typeLabel(t) {
	return { image_url: 'Image', image: 'Image', video: 'Video', pdf: 'PDF', text: 'Note', link: 'Link' }[t] || 'Link';
}

function kindToType(kind) {
	return {
		image: 'image_url', image_url: 'image_url', video: 'video', pdf: 'pdf', text: 'text', link: 'link',
		'file-image': 'image', 'file-pdf': 'pdf', 'file-video': 'video',
	}[kind] || 'link';
}

const SITE_NAMES = { instagram: 'Instagram', pinterest: 'Pinterest', tiktok: 'TikTok', x: 'X', reddit: 'Reddit', youtube: 'YouTube', vimeo: 'Vimeo', facebook: 'Facebook', threads: 'Threads' };

function setLoading(txt) { $('loadingTxt').textContent = txt; }

window.CurioApp = {
	back() {
		for (const id of ['tagSug', 'geoSug']) {
			if (!$(id).classList.contains('hidden')) { show($(id), false); return true; }
		}
		return false;
	},
};

async function init() {
	wireStatic();
	cfg = CURIO.getConfig();
	if (!CURIO.configured(cfg)) {
		return showSetup('Connect Curio to your Nextcloud once, then share from any app to clip.');
	}

	const shared = CurioNative.shared();
	Extract.progress = (t) => setLoading(t);

	const statePromise = CURIO.state(cfg).catch((e) => ({ _error: e }));
	clip = await Extract.run(shared);

	// The server's own fetch, exactly like the app's add dialog, for links.
	let meta = null;
	if (clip.url && !clip.file && clip.kind !== 'text') {
		setLoading('Asking Curio about the link...');
		meta = await CURIO.fetchMeta(clip.url, cfg).catch(() => null);
	}

	state = await statePromise;
	if (state && state._error) {
		const e = state._error;
		if (e.status === 401) return showSetup('Nextcloud refused the sign-in. Reconnect Curio in the app settings.');
		if (e.status === 404) return showSetup('Curio 1.0.4 or later was not found on your Nextcloud. Update the Curio app there.');
		return showSetup('Could not reach your Nextcloud (' + (e.message || 'network error') + ').');
	}
	if (state.needsFolderSetup) {
		return showSetup('Open Curio in Nextcloud once and choose where it keeps your boards, then share again.');
	}

	TagLogic.setTags(state.tags || []);
	buildForm(meta);
	wireForm();
	show($('loading'), false);
	show($('form'), true);
}

function wireStatic() {
	$('btnClose').addEventListener('click', () => Android.close());
	$('btnCancel').addEventListener('click', () => Android.close());
	$('backdrop').addEventListener('click', () => Android.close());
	$('btnSettings').addEventListener('click', () => { Android.openSettings(); Android.close(); });
	$('btnConnect').addEventListener('click', () => { Android.openSettings(); Android.close(); });
}

function showSetup(msg) {
	show($('loading'), false);
	show($('form'), false);
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

	$('typeChip').textContent = typeLabel(sel.type);
	$('srcLabel').textContent = clip.file ? (clip.file.name || 'Shared file') : (domainOf(clip.url || clip.pageUrl) || '');

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

	renderImage();

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
	const add = (html) => { const d = document.createElement('div'); d.className = 'note'; d.innerHTML = html; box.appendChild(d); return d; };
	if ((clip.notes || []).includes('instagram-signin')) {
		const d = add('Instagram only showed a preview of this post. <a href="#">Sign in to Instagram</a> in Curio to clip private posts, full carousels and reels.');
		d.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); Android.openSettings(); Android.close(); });
	} else if (clip.url && !clip.file && clip.kind !== 'text' && !clip.title && !clip.description && !sel.images.length) {
		add('Could not read anything from ' + (SITE_NAMES[clip.site] || 'this page') + '. You can still save the link and fill in the details.');
	}
}

function renderImage() {
	const isFile = !!clip.file;
	const fileImg = isFile && sel.type === 'image';
	show($('fileCard'), isFile && !fileImg);
	if (isFile && !fileImg) {
		const sz = clip.file.size > 0 ? ' (' + (clip.file.size / 1048576).toFixed(1) + ' MB)' : '';
		$('fileCard').textContent = (sel.type === 'video' ? 'Video: ' : sel.type === 'pdf' ? 'PDF: ' : 'File: ') + (clip.file.name || 'shared') + sz;
	}
	if (fileImg) {
		// The shared photo itself, via the content:// URI the sharing app granted.
		sel.images = [];
		sel.image = '';
		show($('prevWrap'), true);
		const img = $('prevImg');
		img.src = clip.file.uri || '';
		img.onerror = () => show($('prevWrap'), false);
		show($('imgPick'), false);
		return;
	}

	const hasImg = !!sel.image && sel.type !== 'text' && !isFile;
	show($('prevWrap'), hasImg);
	if (hasImg) {
		const img = $('prevImg');
		img.src = sel.image;
		img.onerror = () => {
			// Drop a broken candidate (an "originals" size that does not exist...) and try the next.
			sel.images = sel.images.filter(u => u !== sel.image);
			sel.image = sel.images[0] || '';
			renderImage();
		};
	}
	const row = $('imgPickRow');
	row.innerHTML = '';
	const many = sel.images.filter(u => !!u);
	show($('imgPick'), hasImg && many.length > 1);
	if (many.length > 1) {
		for (const u of many) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'imgpick-thumb' + (u === sel.image ? ' sel' : '');
			const im = document.createElement('img');
			im.src = u;
			im.onerror = () => { b.remove(); };
			b.appendChild(im);
			b.addEventListener('click', () => { sel.image = u; renderImage(); });
			row.appendChild(b);
		}
	}
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
		pill.style.color = textOn(t.color);
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
	box.querySelectorAll('.chip').forEach(el => el.remove());
	show(box, sel.hashtags.length > 0);
	for (const h of sel.hashtags) {
		const c = document.createElement('button');
		c.type = 'button';
		c.className = 'chip';
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
	} else {
		show(d, false);
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
	show(box, list.length > 0 && !sel.geo);
	if (!list.length) return;
	const lbl = document.createElement('span');
	lbl.className = 'chips-lbl';
	lbl.textContent = list.length > 1 ? 'Suggested places:' : 'Suggested:';
	box.appendChild(lbl);
	for (const s of list) {
		const c = document.createElement('button');
		c.type = 'button';
		c.className = 'chip';
		c.textContent = (s.place || '').split(',')[0];
		c.title = s.place || '';
		c.addEventListener('click', () => {
			sel.geo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' };
			renderGeo();
			show(box, false);
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
				r.className = 'sug-row';
				r.textContent = s.place;
				r.addEventListener('mousedown', (ev) => {
					ev.preventDefault();
					sel.geo = { lat: s.lat, lng: s.lng, place: s.place, source: 'geocoded' };
					$('geoQuery').value = '';
					show(box, false);
					renderGeo();
					show($('geoSuggestions'), false);
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
			r.className = 'sug-row';
			const dot = document.createElement('span');
			dot.className = 'sug-dot';
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

	$('form').addEventListener('submit', onSubmit);
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

async function onSubmit(e) {
	e.preventDefault();
	const btn = $('btnAdd');
	btn.disabled = true;
	btn.textContent = 'Adding...';
	show($('err'), false);
	try {
		const mine = (state.boards || []).filter(b => b.mine);
		const board = mine.find(b => String(b.id) === $('board').value) || mine[0];
		if (!board) throw new Error('No board to add to.');
		const { ids: tagIds, dropped } = await ensureTagIds();
		const seed = Math.floor(Math.random() * 9999);
		const url = clip.url || '';
		const title = $('title').value.trim();
		const desc = $('desc').value;
		let payload;

		if (clip.file) {
			const isVideo = sel.type === 'video';
			btn.textContent = 'Uploading...';
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
				btn.textContent = 'Saving video...';
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

		btn.textContent = 'Adding...';
		await CURIO.createReference(payload, cfg);

		show($('form'), false);
		let msg = 'Added to ' + board.name + '.';
		if (dropped.length) msg += ' (New tags ' + dropped.join(', ') + ' were skipped; create them in Curio.)';
		$('doneMsg').textContent = msg;
		show($('done'), true);
		setTimeout(() => Android.close(), dropped.length ? 2600 : 1100);
	} catch (err) {
		btn.disabled = false;
		btn.textContent = 'Add to board';
		const el = $('err');
		el.textContent = (err && err.message) || 'Could not add the reference.';
		show(el, true);
	}
}

init().catch((e) => {
	show($('loading'), false);
	showSetup('Something went wrong: ' + (e && e.message ? e.message : e));
});
