// boot.js - loads a page's scripts in order once the bridge has read the config
// and translations (the app's scripts expect them synchronously). The scripts are
// listed in this tag's data-scripts attribute.

/* global ExtBridge */
(function () {
	const me = document.currentScript;
	const list = String(me.getAttribute('data-scripts') || '').split(',').map((s) => s.trim()).filter(Boolean);
	const gate = me.hasAttribute('data-needs-connection');

	ExtBridge.ready.then(() => {
		// The clip window of a browser that is not connected yet goes to the
		// connection first, then comes back to this clip.
		if (gate && !(ExtBridge.config.server && ExtBridge.config.user && ExtBridge.config.appPassword)) {
			location.replace('options.html' + location.search + (location.search ? '&' : '?') + 'then=clip');
			return;
		}
		for (const src of list) {
			const s = document.createElement('script');
			s.src = src;
			s.async = false;
			document.body.appendChild(s);
		}
	});
})();
