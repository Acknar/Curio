// sites.js - the site sign-ins list (Instagram, Facebook...), shared by App settings
// and the introduction. Each row shows the live sign-in state and opens the site's
// own page in SiteLoginActivity.

/* global Android, CurioNative, Look, brandAvatar */

const SITES = [
	{ id: 'instagram', name: 'Instagram' },
	{ id: 'facebook', name: 'Facebook' },
	{ id: 'pinterest', name: 'Pinterest' },
	{ id: 'tiktok', name: 'TikTok' },
	{ id: 'x', name: 'X' },
];

function renderSites(box) {
	const tr = (s, v) => Look.tr(s, v);
	const sessions = CurioNative.siteSessions();
	box.innerHTML = '';
	for (const s of SITES) {
		const on = !!sessions[s.id];
		const row = document.createElement('div');
		row.className = 'siterow';
		row.innerHTML = brandAvatar([s.id])
			+ '<span class="label"><b>' + s.name + '</b><span class="' + (on ? 'on' : '') + '">' + tr(on ? 'Signed in' : 'Not signed in') + '</span></span>';
		const btn = document.createElement('button');
		btn.className = 'btn';
		btn.textContent = tr(on ? 'Open' : 'Sign in');
		btn.addEventListener('click', () => Android.openSiteLogin(s.id));
		row.appendChild(btn);
		box.appendChild(row);
	}
}
