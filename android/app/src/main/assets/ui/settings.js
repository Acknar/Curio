// settings.js - the app's own settings: default board for the share menu, site
// sign-ins (sites.js), the introduction and the Nextcloud connection.

/* global Android, CurioNative, CURIO, Look */

const $ = (id) => document.getElementById(id);
const tr = (s, v) => Look.tr(s, v);

window.CurioApp = {
	back() { return false; },
	refresh() { renderSites($('sSites')); },
};

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
renderSites($('sSites'));
renderBoards(cfg);

$('btnBack').addEventListener('click', () => Android.close());
$('btnDone').addEventListener('click', () => Android.close());
$('sIntro').addEventListener('click', () => Android.openIntro());
$('sBoard').addEventListener('change', () => {
	const v = $('sBoard').value;
	CURIO.setConfig({ defaultBoardId: v ? Number(v) : null });
});
$('sSignOut').addEventListener('click', () => {
	Android.clearSiteSessions();
	renderSites($('sSites'));
	Android.toast(tr('Signed out of all sites'));
});
$('sDisconnect').addEventListener('click', () => {
	Android.clearServerSession();
	CURIO.setConfig({ appPassword: null, defaultBoardId: null, look: null });
	Android.openConnect();
});
