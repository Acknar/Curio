// home.js - home, first-run connection and settings.
// Connection uses Nextcloud Login Flow v2: the user signs in on their server's own
// page and approves Curio, and Nextcloud hands back an app password for this phone
// (listed in Security > Devices & sessions, revocable there). Entering an app
// password by hand is the fallback for servers where the flow is unavailable.

/* global Android, CurioNative, CURIO */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.classList.toggle('hidden', !on); };

const SITE_LIST = [
	{ id: 'instagram', name: 'Instagram' },
	{ id: 'facebook', name: 'Facebook' },
	{ id: 'pinterest', name: 'Pinterest' },
	{ id: 'tiktok', name: 'TikTok' },
	{ id: 'x', name: 'X' },
];

let view = '';
let flow = null; // { poll: { token, endpoint }, login, cancelled }

function setStatus(el, cls, txt) { el.className = 'status ' + cls; el.textContent = txt; }

function showView(v) {
	const cfg = CURIO.getConfig();
	if (!CURIO.configured(cfg) && v !== 'connect') v = 'connect';
	view = v;
	for (const s of document.querySelectorAll('.view')) show(s, s.id === 'v-' + v);
	show($('btnBack'), v === 'settings');
	show($('btnGear'), v === 'home');
	$('hdTitle').textContent = v === 'settings' ? 'Settings' : 'Curio';
	if (v === 'home') renderHome();
	if (v === 'settings') renderSettings();
	if (v === 'connect' && cfg.server && !$('cServer').value) $('cServer').value = cfg.server;
	window.scrollTo(0, 0);
}

window.CurioApp = {
	show(v) { showView(v); },
	back() {
		if (view === 'settings') { showView('home'); return true; }
		return false;
	},
	refresh() {
		if (view === 'home') renderHome();
		if (view === 'settings') renderSites();
	},
};

/* ---------------- connect ---------------- */

function clientName() {
	const info = CurioNative.appInfo();
	return 'Curio for Android' + (info.device ? ' (' + info.device + ')' : '');
}

async function startLoginFlow() {
	const st = $('cStatus');
	const server = CURIO.base($('cServer').value);
	if (!server) { setStatus(st, 'err', 'Enter your Nextcloud address first.'); return; }
	setStatus(st, 'busy', 'Contacting ' + server + '...');
	$('cLogin').disabled = true;
	// Nextcloud names the app password after the User-Agent of this request.
	const res = await CurioNative.http({ method: 'POST', url: server + '/index.php/login/v2', headers: { 'User-Agent': clientName(), 'Accept': 'application/json' } });
	$('cLogin').disabled = false;
	let data = null;
	try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
	if (res.error || !data || !data.poll || !data.login) {
		setStatus(st, 'err', res.error ? 'Could not reach that address.' : 'That address did not answer like a Nextcloud server (HTTP ' + res.status + '). Check it, or use an app password below.');
		return;
	}
	setStatus(st, '', '');
	flow = { poll: data.poll, login: data.login, cancelled: false };
	show($('cWaiting'), true);
	Android.openExternal(data.login);
	pollFlow(flow, Date.now());
}

async function pollFlow(f, started) {
	while (!f.cancelled && Date.now() - started < 20 * 60 * 1000) {
		await new Promise((r) => setTimeout(r, 2000));
		if (f.cancelled) return;
		const res = await CurioNative.http({
			method: 'POST',
			url: f.poll.endpoint,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': clientName() },
			body: 'token=' + encodeURIComponent(f.poll.token),
		});
		if (res.status === 200 && res.body) {
			let d = null;
			try { d = JSON.parse(res.body); } catch (e) { d = null; }
			if (d && d.appPassword) {
				await finishConnect({ server: CURIO.base(d.server), user: d.loginName, appPassword: d.appPassword });
				return;
			}
		}
	}
	if (!f.cancelled) {
		show($('cWaiting'), false);
		setStatus($('cStatus'), 'err', 'Sign-in timed out. Try again.');
	}
}

function cancelFlow() {
	if (flow) flow.cancelled = true;
	flow = null;
	show($('cWaiting'), false);
}

async function finishConnect(c) {
	const st = $('cStatus');
	show($('cWaiting'), false);
	setStatus(st, 'busy', 'Checking Curio on your server...');
	try {
		const res = await CURIO.ping(c);
		CURIO.setConfig({ server: c.server, user: c.user, appPassword: c.appPassword, curioVersion: res.version || '' });
		setStatus(st, 'ok', 'Connected as ' + (res.user || c.user) + '.');
		showView('home');
	} catch (e) {
		// Keep the credentials so a later update of the server app just works.
		CURIO.setConfig({ server: c.server, user: c.user, appPassword: c.appPassword });
		setStatus(st, 'err', connectError(e));
	}
}

function connectError(e) {
	if (e.code === 'network') return 'Could not reach that address.';
	if (e.status === 401) return 'Sign-in refused. Check the username and app password.';
	if (e.status === 404) return 'Signed in, but Curio 1.0.4 or later was not found on this Nextcloud. Install or update the Curio app there.';
	return 'Failed: ' + (e.message || 'unknown error');
}

function manualValues() {
	return { server: CURIO.base($('cServer').value), user: $('mUser').value.trim(), appPassword: $('mPw').value.trim() };
}

async function manualTest(save) {
	const st = $('cStatus');
	const v = manualValues();
	if (!v.server || !v.user || !v.appPassword) { setStatus(st, 'err', 'Fill in the address, username and app password.'); return; }
	if (save) return finishConnect(v);
	setStatus(st, 'busy', 'Connecting...');
	try {
		const res = await CURIO.ping(v);
		setStatus(st, 'ok', 'Connected as ' + (res.user || v.user) + '. Curio ' + (res.version || '') + '.');
	} catch (e) {
		setStatus(st, 'err', connectError(e));
	}
}

/* ---------------- home ---------------- */

function renderHome() {
	const cfg = CURIO.getConfig();
	$('hUser').textContent = cfg.user;
	$('hServer').textContent = cfg.server.replace(/^https?:\/\//, '');
	$('hAvatar').textContent = (cfg.user || '?').slice(0, 2).toUpperCase();
	const sessions = CurioNative.siteSessions();
	show($('hSites'), !sessions.instagram);
}

/* ---------------- settings ---------------- */

async function renderSettings() {
	const cfg = CURIO.getConfig();
	$('sWho').textContent = cfg.user + ' on ' + cfg.server.replace(/^https?:\/\//, '');
	const info = CurioNative.appInfo();
	$('sAbout').textContent = 'Curio for Android ' + (info.version || '');
	renderSites();

	const selEl = $('sBoard');
	$('sBoardStatus').textContent = 'Loading boards...';
	try {
		const [state, ping] = await Promise.all([CURIO.state(cfg), CURIO.ping(cfg).catch(() => null)]);
		$('sVersion').textContent = ping && ping.version ? 'Curio ' + ping.version + ' on the server' : '';
		selEl.innerHTML = '<option value="">First board</option>';
		for (const b of (state.boards || []).filter((x) => x.mine)) {
			const o = document.createElement('option');
			o.value = String(b.id);
			o.textContent = b.name;
			selEl.appendChild(o);
		}
		selEl.value = cfg.defaultBoardId ? String(cfg.defaultBoardId) : '';
		$('sBoardStatus').textContent = state.needsFolderSetup ? 'Open Curio in Nextcloud once to choose where it keeps your boards.' : '';
	} catch (e) {
		$('sBoardStatus').textContent = 'Could not load boards: ' + connectError(e);
	}
}

function renderSites() {
	const sessions = CurioNative.siteSessions();
	const box = $('sSites');
	box.innerHTML = '';
	for (const s of SITE_LIST) {
		const row = document.createElement('div');
		row.className = 'site';
		const left = document.createElement('div');
		const name = document.createElement('div');
		name.className = 'site-name';
		name.textContent = s.name;
		const stt = document.createElement('div');
		stt.className = 'site-state' + (sessions[s.id] ? ' on' : '');
		stt.textContent = sessions[s.id] ? 'Signed in' : 'Not signed in';
		left.appendChild(name);
		left.appendChild(stt);
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'btn';
		btn.textContent = sessions[s.id] ? 'Open' : 'Sign in';
		btn.addEventListener('click', () => Android.openSiteLogin(s.id));
		row.appendChild(left);
		row.appendChild(btn);
		box.appendChild(row);
	}
}

/* ---------------- wiring ---------------- */

function wire() {
	$('cLogin').addEventListener('click', startLoginFlow);
	$('cReopen').addEventListener('click', () => { if (flow) Android.openExternal(flow.login); });
	$('cCancel').addEventListener('click', cancelFlow);
	$('mTest').addEventListener('click', () => manualTest(false));
	$('mSave').addEventListener('click', () => manualTest(true));

	$('btnGear').addEventListener('click', () => showView('settings'));
	$('btnBack').addEventListener('click', () => showView('home'));
	$('hBoards').addEventListener('click', () => Android.openBoards());
	$('hSitesBtn').addEventListener('click', () => Android.openSiteLogin('instagram'));

	$('sBoard').addEventListener('change', () => {
		const v = $('sBoard').value;
		CURIO.setConfig({ defaultBoardId: v ? Number(v) : null });
		Android.toast('Default board saved');
	});
	$('sSignOutSites').addEventListener('click', () => {
		Android.clearSiteSessions();
		renderSites();
		Android.toast('Signed out of all sites');
	});
	$('sDisconnect').addEventListener('click', () => {
		CURIO.setConfig({ appPassword: null, user: null, defaultBoardId: null });
		showView('connect');
	});
}

wire();
showView((location.hash || '').replace('#', '') || 'home');
