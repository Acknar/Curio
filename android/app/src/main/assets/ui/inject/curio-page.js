// curio-page.js - injected by MainActivity into the Curio page of the user's
// Nextcloud, so the web app reads as a native one:
//   - hides Nextcloud's top bar and outer margins on the Curio page only;
//   - adds "App settings" under Curio's own Settings entry in the sidebar;
//   - reports Curio's theme, colours and language, which the app's own screens
//     (share sheet, settings) reuse so they look the same;
//   - lets the Android back button close Curio's dialogs and sidebar first.
// Safe to run more than once per page.
(function () {
	if (window.__curioAndroid) return;
	window.__curioAndroid = true;
	if (!/\/apps\/curio(\/|$)/.test(location.pathname)) return;

	var css = document.createElement('style');
	css.id = 'curio-android';
	css.textContent = [
		':root, body { --header-height: 0px !important; --body-container-margin: 0px !important; --body-container-radius: 0px !important; }',
		'#header, header#header, #skip-actions, .header-menu, #unified-search { display: none !important; }',
		'#content, #content-vue { margin: 0 !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }',
		'body { overflow: hidden; }',
	].join('\n');
	(document.head || document.documentElement).appendChild(css);

	var LABEL = { en: 'App settings', fr: "Paramètres de l'app", es: 'Ajustes de la app', de: 'App-Einstellungen', it: "Impostazioni dell'app", pt: 'Definições da app', nl: 'App-instellingen' };
	var ICON = '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/></svg>';
	function lang() { return (document.documentElement.getAttribute('lang') || navigator.language || 'en').toLowerCase().split(/[-_]/)[0]; }

	function addSettingsEntry() {
		var foot = document.querySelector('.curio .side-footer');
		if (!foot || foot.querySelector('[data-curio-android]')) return;
		var b = document.createElement('button');
		b.setAttribute('data-curio-android', '1');
		b.innerHTML = '<span>' + ICON + '</span> ' + (LABEL[lang()] || LABEL.en);
		b.addEventListener('click', function () { window.CurioAndroid && CurioAndroid.openAppSettings(); });
		foot.appendChild(b);
	}

	var lastLook = '';
	function syncLook() {
		var c = document.querySelector('.curio');
		if (!c || !window.CurioAndroid) return;
		var cs = getComputedStyle(c);
		var look = JSON.stringify({
			theme: c.getAttribute('data-rbtheme') || 'light',
			primary: cs.getPropertyValue('--primary').trim(),
			bg: cs.getPropertyValue('--bg').trim(),
			surface: cs.getPropertyValue('--surface').trim(),
			lang: lang(),
		});
		if (look !== lastLook) { lastLook = look; CurioAndroid.syncLook(look); }
	}

	function tick() { addSettingsEntry(); syncLook(); }
	tick();
	setInterval(tick, 800);

	// Back button: close the topmost Curio overlay, like Escape on desktop. The detail
	// view ignores Escape (it can hold unsaved edits), so use its own close button.
	window.__curioAndroidBack = function () {
		var c = document.querySelector('.curio');
		if (!c) return 'none';
		var detailClose = document.querySelector('.curio .modal.detail .mediabtn.closef');
		var scrims = document.querySelectorAll('.curio .scrim');
		var top = scrims.length ? scrims[scrims.length - 1] : null;
		if (top && detailClose && top.contains(detailClose)) { detailClose.click(); return 'closed'; }
		if (document.querySelector('.curio .typemenu') || top) {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			return 'closed';
		}
		var backdrop = document.querySelector('.curio .side-backdrop');
		if (backdrop) { backdrop.click(); return 'closed'; }
		return 'none';
	};

	// After a clip from the share menu: reload the board data in place.
	window.__curioAndroidRefresh = function () {
		try {
			var app = document.getElementById('curio-root').__vue_app__;
			app._instance.proxy.fetchState();
		} catch (e) {
			location.reload();
		}
	};
})();
