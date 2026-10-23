// sites.js - the site sign-ins list (Instagram, Facebook...), shared by App settings
// and the introduction. Each row shows the live sign-in state and opens the site's
// own page in SiteLoginActivity.

/* global Android, CurioNative, Look */

const SITES = [
	{ id: 'instagram', name: 'Instagram', color: '#c13584' },
	{ id: 'facebook', name: 'Facebook', color: '#1877f2' },
	{ id: 'pinterest', name: 'Pinterest', color: '#e60023' },
	{ id: 'tiktok', name: 'TikTok', color: '#111111' },
	{ id: 'x', name: 'X', color: '#444444' },
];

function renderSites(box) {
	const tr = (s, v) => Look.tr(s, v);
	const sessions = CurioNative.siteSessions();
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
