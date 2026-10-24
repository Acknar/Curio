// options.js - the clipper's settings page, opened on install, from the clip window
// when the browser is not connected yet (?then=clip&id=...), and from the browser's
// extension settings. Connection uses Nextcloud Login Flow v2, as Curio for Android
// does: the user signs in on their server's page and Nextcloud hands back an app
// password for this browser, listed and revocable in Security > Devices & sessions.
// Entering an app password by hand is the fallback.

/* global browser, Android, CurioNative, CURIO, Look, ExtBridge */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.classList.toggle('hidden', !on); };
const tr = (s, v) => Look.tr(s, v);
const params = new URLSearchParams(location.search);

let flow = null; // { poll: { token, endpoint }, login, tabId, cancelled }
let hostGranted = true;

Look.ICON.mouse = '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>';
Look.ICON.keyboard = '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>';
Look.ICON.cursor = '<path d="M5 3l14 7-6 2-2 6z"/>';

function setStatus(cls, txt) { const el = $('cStatus'); el.className = 'status ' + cls; el.textContent = txt; }

// Nextcloud names the app password after the User-Agent of the Login Flow request.
function clientName() {
	const info = CurioNative.appInfo();
	return 'Curio Web Clipper' + (info.device ? ' (' + info.device + ')' : '');
}

/* ---------------- website access (Firefox can withhold it) ---------------- */

async function checkHostAccess() {
	try { hostGranted = await browser.permissions.contains({ origins: ['<all_urls>'] }); } catch (e) { hostGranted = true; }
	show($('hostAccess'), !hostGranted);
	return hostGranted;
}

// Must run straight from the click: permission prompts need the user's gesture.
function askHostAccess() {
	if (hostGranted) return Promise.resolve(true);
	return browser.permissions.request({ origins: ['<all_urls>'] }).then((ok) => {
		hostGranted = !!ok;
		show($('hostAccess'), !hostGranted);
		return hostGranted;
	}).catch(() => false);
}

/* ---------------- Login Flow v2 ---------------- */

function waiting(on) {
	show($('cWaiting'), on);
	$('cWaitBtns').classList.toggle('hidden', !on);
	$('cLogin').disabled = on;
}

async function startLoginFlow() {
	const granted = await askHostAccess();
	if (!granted) { setStatus('err', tr('The clipper needs access to websites to read the page you clip and to reach your Nextcloud.')); return; }
	const server = CURIO.base($('cServer').value);
	if (!server) { setStatus('err', tr('Enter your Nextcloud address first.')); return; }
	setStatus('', tr('Connecting...'));
	$('cLogin').disabled = true;
	const res = await CurioNative.http({ method: 'POST', url: server + '/index.php/login/v2', headers: { 'User-Agent': clientName(), 'Accept': 'application/json' } });
	$('cLogin').disabled = false;
	let data = null;
	try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
	if (res.error || !data || !data.poll || !data.login) {
		setStatus('err', res.error ? tr('Could not reach that address.') : tr('That address did not answer like a Nextcloud server. Check it, or use an app password below.'));
		return;
	}
	setStatus('', '');
	flow = { poll: data.poll, login: data.login, tabId: null, cancelled: false };
	waiting(true);
	openLogin(flow);
	pollFlow(flow, Date.now());
}

async function openLogin(f) {
	try {
		const tab = await browser.tabs.create({ url: f.login });
		f.tabId = tab && tab.id;
	} catch (e) {
		window.open(f.login, '_blank');
	}
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
				waiting(false);
				// Close Nextcloud's "Account connected" tab and come back here.
				if (f.tabId != null) browser.tabs.remove(f.tabId).catch(() => {});
				browser.tabs.getCurrent().then((t) => t && browser.tabs.update(t.id, { active: true })).catch(() => {});
				await finishConnect({ server: CURIO.base(d.server), user: d.loginName, appPassword: d.appPassword });
				return;
			}
		}
	}
	if (!f.cancelled) {
		waiting(false);
		setStatus('err', tr('Sign-in timed out. Try again.'));
	}
}

function cancelFlow() {
	if (flow) flow.cancelled = true;
	flow = null;
	waiting(false);
}

/* ---------------- connect / disconnect ---------------- */

function connectError(e) {
	if (e.code === 'network') return tr('Could not reach that address.');
	if (e.status === 401) return tr('Sign-in refused. Check the username and app password.');
	if (e.status === 404) return tr('Signed in, but Curio 1.0.4 or later was not found on this Nextcloud. Install or update the Curio app there.');
	return (e.message || 'Error');
}

// Curio's accent colour, from the server's theming, so the clipper's screens match.
async function serverLook(c) {
	const look = Object.assign({}, CURIO.getConfig().look || {});
	try {
		const res = await CurioNative.http({ url: CURIO.base(c.server) + '/ocs/v2.php/cloud/capabilities?format=json', headers: CURIO.headers(c, { 'OCS-APIRequest': 'true' }) });
		const caps = JSON.parse(res.body || '{}').ocs.data.capabilities;
		const color = caps && caps.theming && (caps.theming['color-element'] || caps.theming.color);
		if (color) look.primary = color;
	} catch (e) { /* keep Curio's default blue */ }
	try {
		const st = await CURIO.state(c);
		if (st && st.lang) look.lang = st.lang;
	} catch (e) { /* keep the browser's language */ }
	return look;
}

async function finishConnect(c) {
	setStatus('', tr('Connecting...'));
	try {
		const res = await CURIO.ping(c);
		CURIO.setConfig({ server: c.server, user: c.user, appPassword: c.appPassword, curioVersion: res.version || '' });
		setStatus('ok', tr('Connected as {user}.', { user: res.user || c.user }));
		CURIO.setConfig({ look: await serverLook(c) });
		// Opened from a clip window: carry on with that clip.
		if (params.get('then') === 'clip') {
			setTimeout(() => location.replace('clip.html?id=' + encodeURIComponent(params.get('id') || '')), 300);
			return;
		}
		setTimeout(() => location.reload(), 300);
	} catch (e) {
		setStatus('err', connectError(e));
	}
}

async function manual(save) {
	const granted = await askHostAccess();
	if (!granted) { setStatus('err', tr('The clipper needs access to websites to read the page you clip and to reach your Nextcloud.')); return; }
	const v = { server: CURIO.base($('cServer').value), user: $('mUser').value.trim(), appPassword: $('mPw').value.trim() };
	if (!v.server || !v.user || !v.appPassword) { setStatus('err', tr('Fill in the address, username and app password.')); return; }
	if (save) return finishConnect(v);
	setStatus('', tr('Connecting...'));
	try {
		const res = await CURIO.ping(v);
		setStatus('ok', tr('Connected as {user}.', { user: res.user || v.user }));
	} catch (e) {
		setStatus('err', connectError(e));
	}
}

function disconnect() {
	CURIO.setConfig({ appPassword: null, defaultBoardId: null, look: null, curioVersion: null });
	location.reload();
}

/* ---------------- connected: settings ---------------- */

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
		$('sBoardHint').textContent = e.status === 401 ? tr('Nextcloud refused the sign-in. Connect the clipper again in its settings.') : tr('Could not reach your Nextcloud.');
	}
}

async function renderHowTo() {
	let keys = 'Alt+Shift+C';
	try {
		const cmds = await browser.commands.getAll();
		const c = cmds.find((x) => x.name === 'clip-page');
		if (c && c.shortcut) keys = c.shortcut;
	} catch (e) { /* keep the default */ }
	const menu = browser.i18n.getMessage('menuClip') || 'Clip to Curio';
	const rows = [
		['cursor', tr('Click the Curio button in the toolbar to clip the page you are on. If you do not see it, open the extensions menu (the puzzle piece) and pin Curio Web Clipper.')],
		['mouse', tr('Right-click an image, a video, a link or selected text and choose {menu}.', { menu: menu })],
		['image', tr('Hold the click hotkey and click an image, a video, a PDF link or selected text.')],
		['keyboard', tr('Press {keys} to clip the page you are on. You can change this shortcut in your browser\'s extension shortcut settings.', { keys: keys })],
	];
	const ul = $('howTo');
	ul.innerHTML = '';
	for (const [ic, text] of rows) {
		const li = document.createElement('li');
		const s = document.createElement('span');
		s.innerHTML = Look.icon(ic, 17);
		li.appendChild(s);
		const t = document.createElement('span');
		t.textContent = text;
		li.appendChild(t);
		ul.appendChild(li);
	}
}

function showConnected(cfg) {
	show($('connected'), true);
	$('sWho').textContent = tr('{user} on {server}', { user: cfg.user || '', server: (cfg.server || '').replace(/^https?:\/\//, '') });
	$('sHotkey').value = cfg.hotkeyEnabled === false ? 'off' : (cfg.hotkeyMod || 'ctrl');
	renderBoards(cfg);
	renderHowTo();
}

function showConnect(cfg) {
	show($('connect'), true);
	if (cfg.server) $('cServer').value = cfg.server;
	if (cfg.user) $('mUser').value = cfg.user;
	checkHostAccess();
	setTimeout(() => { if (!$('cServer').value) $('cServer').focus(); }, 30);
}

Look.init($('root'));
$('logo').innerHTML = Look.logo(26);
$('sAbout').textContent = 'Curio Web Clipper ' + (CurioNative.appInfo().version || '');
const cfg = CURIO.getConfig();
if (CURIO.configured(cfg)) showConnected(cfg);
else showConnect(cfg);

$('cAllow').addEventListener('click', () => askHostAccess());
$('cLogin').addEventListener('click', startLoginFlow);
$('cServer').addEventListener('keydown', (e) => { if (e.key === 'Enter') startLoginFlow(); });
$('cReopen').addEventListener('click', () => { if (flow) openLogin(flow); });
$('cCancel').addEventListener('click', cancelFlow);
$('mTest').addEventListener('click', () => manual(false));
$('mSave').addEventListener('click', () => manual(true));
$('sDisconnect').addEventListener('click', disconnect);
$('sBoard').addEventListener('change', () => {
	const v = $('sBoard').value;
	CURIO.setConfig({ defaultBoardId: v ? Number(v) : null });
});
$('sHotkey').addEventListener('change', () => {
	const v = $('sHotkey').value;
	if (v === 'off') CURIO.setConfig({ hotkeyEnabled: false });
	else CURIO.setConfig({ hotkeyEnabled: true, hotkeyMod: v });
});
