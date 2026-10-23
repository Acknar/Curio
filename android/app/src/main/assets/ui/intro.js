// intro.js - shown once after connecting (and from App settings): how the share
// menu works, what it reads on each platform, site sign-ins and the default board.
// Steps are the <section data-step> blocks of intro.html.

/* global Android, CURIO, Look, renderSites */

const $ = (id) => document.getElementById(id);
const tr = (s, v) => Look.tr(s, v);

const PLATFORMS = [
	{ name: 'Instagram', color: '#c13584', reads: 'Caption, every photo of a carousel, reels as videos' },
	{ name: 'Pinterest', color: '#e60023', reads: 'Title, description and the full-size image' },
	{ name: 'TikTok', color: '#111111', reads: 'Caption and cover picture' },
	{ name: 'YouTube, Vimeo', short: 'YT', color: '#ff0033', reads: 'Title, description and the video, playable in Curio' },
	{ name: 'X, Reddit, Threads, Facebook', short: 'X', color: '#444444', reads: 'Post text and pictures' },
	{ name: 'Any website', short: 'www', color: '#0082c9', reads: 'Title, description and main image' },
];

const steps = [...document.querySelectorAll('section[data-step]')];
let step = 0;

function show(i) {
	step = Math.max(0, Math.min(steps.length - 1, i));
	steps.forEach((s, k) => s.classList.toggle('hidden', k !== step));
	const cur = steps[step];
	$('iTitle').textContent = tr(cur.getAttribute('data-title'));
	$('iArt').innerHTML = Look.icon(cur.getAttribute('data-art'), 30);
	[...$('iDots').children].forEach((d, k) => d.classList.toggle('on', k === step));
	$('btnPrev').classList.toggle('hidden', step === 0);
	$('btnNext').classList.toggle('hidden', step === steps.length - 1);
	$('btnStart').classList.toggle('hidden', step !== steps.length - 1);
	document.getElementById('root').scrollTop = 0;
}

function finish() {
	CURIO.setConfig({ introDone: true });
	Android.close();
}

function renderPlatforms() {
	const box = $('iPlatforms');
	for (const p of PLATFORMS) {
		const row = document.createElement('div');
		row.className = 'siterow';
		const av = document.createElement('span');
		av.className = 'owner-av';
		av.style.background = p.color;
		av.textContent = p.short || p.name.slice(0, 2).toUpperCase();
		const label = document.createElement('span');
		label.className = 'label';
		const b = document.createElement('b');
		b.textContent = p.name === 'Any website' ? tr('Any website') : p.name;
		const sub = document.createElement('span');
		sub.textContent = tr(p.reads);
		label.append(b, sub);
		row.append(av, label);
		box.appendChild(row);
	}
}

async function renderBoards() {
	const cfg = CURIO.getConfig();
	const selEl = $('iBoard');
	$('iBoardHint').textContent = tr('Loading...');
	try {
		const state = await CURIO.state(cfg);
		for (const b of (state.boards || []).filter((x) => x.mine)) {
			const o = document.createElement('option');
			o.value = String(b.id);
			o.textContent = b.name;
			selEl.appendChild(o);
		}
		selEl.value = cfg.defaultBoardId ? String(cfg.defaultBoardId) : '';
		$('iBoardHint').textContent = '';
	} catch (e) {
		$('iBoardHint').textContent = tr('Could not reach your Nextcloud.');
	}
}

window.CurioApp = {
	back() {
		if (step > 0) { show(step - 1); return true; }
		return false;
	},
	refresh() { renderSites($('iSites')); },
};

Look.init($('root'));
$('btnSkip').title = tr('Skip the introduction');
steps.forEach((s, k) => {
	const d = document.createElement('button');
	d.title = tr(s.getAttribute('data-title'));
	d.addEventListener('click', () => show(k));
	$('iDots').appendChild(d);
});
renderPlatforms();
renderSites($('iSites'));
renderBoards();
show(0);

$('btnPrev').addEventListener('click', () => show(step - 1));
$('btnNext').addEventListener('click', () => show(step + 1));
$('btnStart').addEventListener('click', finish);
$('btnSkip').addEventListener('click', finish);
$('iBoard').addEventListener('change', () => {
	const v = $('iBoard').value;
	CURIO.setConfig({ defaultBoardId: v ? Number(v) : null });
});
