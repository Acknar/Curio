// connect.js - first run. Connection uses Nextcloud Login Flow v2: the user signs
// in on their server's own page and approves Curio, and Nextcloud hands back an app
// password for this phone (listed in Security > Devices & sessions, revocable
// there). Entering an app password by hand is the fallback.

/* global Android, CurioNative, CURIO, Look */

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.classList.toggle('hidden', !on); };
const tr = (s, v) => Look.tr(s, v);

let flow = null; // { poll: { token, endpoint }, login, cancelled }

function setStatus(cls, txt) { const el = $('cStatus'); el.className = 'status ' + cls; el.textContent = txt; }

function clientName() {
	const info = CurioNative.appInfo();
	return 'Curio for Android' + (info.device ? ' (' + info.device + ')' : '');
}

function waiting(on) {
	show($('cWaiting'), on);
	$('cWaitBtns').classList.toggle('hidden', !on);
	$('cLogin').disabled = on;
}

async function startLoginFlow() {
	const server = CURIO.base($('cServer').value);
	if (!server) { setStatus('err', tr('Enter your Nextcloud address first.')); return; }
	setStatus('', tr('Connecting...'));
	$('cLogin').disabled = true;
	// Nextcloud names the app password after the User-Agent of this request.
	const res = await CurioNative.http({ method: 'POST', url: server + '/index.php/login/v2', headers: { 'User-Agent': clientName(), 'Accept': 'application/json' } });
	$('cLogin').disabled = false;
	let data = null;
	try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = null; }
	if (res.error || !data || !data.poll || !data.login) {
		setStatus('err', res.error ? tr('Could not reach that address.') : tr('That address did not answer like a Nextcloud server. Check it, or use an app password below.'));
		return;
	}
	setStatus('', '');
	flow = { poll: data.poll, login: data.login, cancelled: false };
	waiting(true);
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
				waiting(false);
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

async function finishConnect(c) {
	setStatus('', tr('Connecting...'));
	try {
		const res = await CURIO.ping(c);
		CURIO.setConfig({ server: c.server, user: c.user, appPassword: c.appPassword, curioVersion: res.version || '' });
		setStatus('ok', tr('Connected as {user}.', { user: res.user || c.user }));
		Android.openCurio();
	} catch (e) {
		setStatus('err', connectError(e));
	}
}

function connectError(e) {
	if (e.code === 'network') return tr('Could not reach that address.');
	if (e.status === 401) return tr('Sign-in refused. Check the username and app password.');
	if (e.status === 404) return tr('Signed in, but Curio 1.0.4 or later was not found on this Nextcloud. Install or update the Curio app there.');
	return (e.message || 'Error');
}

async function manual(save) {
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

Look.init($('root'));
$('logo').innerHTML = Look.logo(34);
const prev = CURIO.getConfig();
if (prev.server) $('cServer').value = prev.server;
if (prev.user) $('mUser').value = prev.user;
$('cLogin').addEventListener('click', startLoginFlow);
$('cReopen').addEventListener('click', () => { if (flow) Android.openExternal(flow.login); });
$('cCancel').addEventListener('click', cancelFlow);
$('mTest').addEventListener('click', () => manual(false));
$('mSave').addEventListener('click', () => manual(true));
