// look.js - makes the app's own screens (share sheet, connection, settings) look
// and read like Curio:
//   - Curio's stylesheet (assets/curio/styles.css, copied from src/styles.css at
//     build time) styles everything inside the .curio root;
//   - the theme, accent colour and language come from the Curio page the user last
//     opened (MainActivity stores them as config.look), else from the system;
//   - strings go through Curio's own translations (assets/curio/l10n), with
//     app-only strings in app-l10n.js;
//   - icons are Curio's (src/helpers.js ICON).

/* global Android, APP_L10N */
const Look = {
	lang: 'en',
	_curio: {},

	init(rootEl) {
		const cfg = this.config();
		const look = cfg.look || {};
		this.lang = this.pickLang(look.lang);
		this._curio = this.loadCurioL10n(this.lang);
		document.documentElement.lang = this.lang;

		const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
		const dark = look.theme ? look.theme === 'dark' : prefersDark;
		rootEl.setAttribute('data-rbtheme', dark ? 'dark' : 'light');
		const primary = this.color(look.primary);
		if (primary) {
			// Curio derives --primary from Nextcloud's accent colour variables.
			rootEl.style.setProperty('--color-primary-element', primary);
			rootEl.style.setProperty('--color-primary-element-light', this.mix(primary, dark ? '#121417' : '#ffffff', dark ? 0.78 : 0.88));
		}
		document.querySelectorAll('[data-tr]').forEach((el) => { el.textContent = this.tr(el.getAttribute('data-tr')); });
		document.querySelectorAll('[data-tr-placeholder]').forEach((el) => { el.placeholder = this.tr(el.getAttribute('data-tr-placeholder')); });
		document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = this.icon(el.getAttribute('data-icon'), Number(el.getAttribute('data-size')) || 18); });
		return dark;
	},

	config() {
		try { return JSON.parse(Android.getConfig() || '{}'); } catch (e) { return {}; }
	},

	pickLang(fromCurio) {
		const cands = [fromCurio, typeof navigator !== 'undefined' ? navigator.language : ''];
		for (const c of cands) {
			const l = String(c || '').toLowerCase().split(/[-_]/)[0];
			if (l && (l === 'en' || (APP_L10N[l]))) return l;
		}
		return 'en';
	},

	loadCurioL10n(lang) {
		if (lang === 'en') return {};
		try {
			const raw = Android.asset('curio/l10n/' + lang + '.json');
			return raw ? (JSON.parse(raw).translations || {}) : {};
		} catch (e) { return {}; }
	},

	// Same contract as Curio's tr(): text with {name} placeholders.
	tr(text, vars) {
		let s = (APP_L10N[this.lang] && APP_L10N[this.lang][text]) || this._curio[text] || text;
		if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
		return s;
	},

	color(c) {
		c = String(c || '').trim();
		if (/^#[0-9a-f]{6}$/i.test(c)) return c;
		if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
		const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
		if (m) return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
		return '';
	},

	mix(a, b, t) {
		const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
		const x = p(a), y = p(b);
		return '#' + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('');
	},

	// Text colour on a tag colour, as Curio's textOn().
	textOn(hex) {
		const c = (hex || '#888').replace('#', '');
		const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1a1a1a' : '#fff';
	},

	ICON: {
		image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
		link: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 015.66 5.66l-2 2"/><path d="M13 18l-1 1a4 4 0 01-5.66-5.66l2-2"/>',
		text: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
		x: '<path d="M6 6l12 12M18 6L6 18"/>',
		chevron: '<path d="M9 6l6 6-6 6"/>',
		check: '<path d="M20 6L9 17l-5-5"/>',
		video: '<rect x="2.5" y="6" width="12" height="12" rx="2"/><path d="M14.5 10l7-3.5v11l-7-3.5z"/>',
		pdf: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
		pin: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
		sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
		back: '<path d="M15 6l-6 6 6 6"/>',
		folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
	},

	icon(n, s) {
		s = s || 16;
		return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (this.ICON[n] || '') + '</svg>';
	},

	logo(s) {
		return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 256 256" aria-hidden="true"><g fill="currentColor"><rect x="25" y="25" width="96" height="124" rx="18"/><rect x="25" y="163" width="96" height="68" rx="18"/><rect x="135" y="25" width="96" height="68" rx="18"/><rect x="135" y="107" width="96" height="124" rx="18"/></g></svg>';
	},
};

if (typeof self !== 'undefined') self.Look = Look;
