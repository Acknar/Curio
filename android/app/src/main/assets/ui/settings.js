// settings.js - the app's own settings: default board for the share menu, site
// sign-ins (Instagram, Facebook...) and the Nextcloud connection.

/* global Android, CurioNative, CURIO, Look */

const $ = (id) => document.getElementById(id);
const tr = (s, v) => Look.tr(s, v);

const SITES = [
	{ id: 'instagram', name: 'Instagram', color: '#c13584' },
	{ id: 'facebook', name: 'Facebook', color: '#1877f2' },
	{ id: 'pinterest', name: 'Pinterest', color: '#e60023' },
	{ id: 'tiktok', name: 'TikTok', color: '#111111' },
	{ id: 'x', name: 'X', color: '#444444' },
];

window.CurioApp = {
	back() { return false; },
	refresh() { renderSites(); },
};

function renderSites() {
	const sessions = CurioNative.siteSessions();
	const box = $('sSites');
	box.innerHTML = '';
	for (const s of SITES) {
		const on = !!sessions[s.id];
		const row = document.createElement('div');
		row.className = 'siterow';
		row.innerHTML = '<span class="owner-av" style="background:' + s.color + '">' + s.name.slice(0, 2).toUpperCase() + '</span>'
			+ '<span class="label"><b>' + s.name + '</b><span class="' + (on ? 'on' : '') + '">' + tr(on ? 'Signed in' : 'Not signed in') + '</span></span>';
		const btn = document.createElement('button');
		btn.className = 'btn';
		btn.textContent = tr(on ? 'Open' : 'Sign in');
		btn.addEventListener('click', () => Android.openSiteLogin(s.id));
		row.appendChild(btn);
		box.appendChild(row);
	}
}

async function renderBoards(cfg) {
	const selEl = $('sBoard');
	$('sBoardHint').textContent = tr('Loading...');
	try {
		const [state, ping] = await Promise.all([CURIO.state(cfg), CURIO.ping(cfg).catch(() => null)]);
		$('sVersion').textContent = ping && ping.version ? tr('Curio {version} on the server', { version: ping.version }) : '';
		for (const b of (state.boards || []).filter((x) => x.mine)) {
			const o = document.createElement('option');
			o.value = String(b.id);
			o.textContent = b.name;
			selEl.appendChild(o);
		}
		selEl.value = cfg.defaultBoardId ? String(cfg.defaultBoardId) : '';
		$('sBoardHint').textContent = '';
	} catch (e) {
		$('sBoardHint').textContent = tr('Could not reach your Nextcloud.');
	}
}

Look.init($('root'));
const cfg = CURIO.getConfig();
$('sWho').textContent = tr('{user} on {server}', { user: cfg.user || '', server: (cfg.server || '').replace(/^https?:\/\//, '') });
$('sAbout').textContent = 'Curio for Android ' + (CurioNative.appInfo().version || '');
renderSites();
renderBoards(cfg);

$('btnBack').addEventListener('click', () => Android.close());
$('btnDone').addEventListener('click', () => Android.close());
$('sBoard').addEventListener('change', () => {
	const v = $('sBoard').value;
	CURIO.setConfig({ defaultBoardId: v ? Number(v) : null });
});
$('sSignOut').addEventListener('click', () => {
	Android.clearSiteSessions();
	renderSites();
	Android.toast(tr('Signed out of all sites'));
});
$('sDisconnect').addEventListener('click', () => {
	Android.clearServerSession();
	CURIO.setConfig({ appPassword: null, defaultBoardId: null, look: null });
	Android.openConnect();
});
