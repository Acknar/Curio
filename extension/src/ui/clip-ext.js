// clip-ext.js - what the clip window does differently from the Android share sheet.
// Loaded after extract.js and before clip.js.
//
// On a phone the share sheet only gets a link and reads it over the network. In the
// browser the content script has already read the page the user is looking at, as
// they see it (signed in, scrolled to the post they picked). Extract.run is wrapped
// to use both:
//   - a selection becomes a note, a PDF stays a PDF;
//   - on Instagram, Pinterest, TikTok, X, Reddit, YouTube, Vimeo, Facebook and
//     Threads, the app's network chain runs first (Instagram's API with the
//     browser's sign-in, Pinterest's widget API, TikTok's page data...) and the
//     page read in the tab fills whatever it left out;
//   - any other website: the page read in the tab, then Curio's server fetch;
//   - a right-clicked link to another page is read like a link shared on a phone;
//   - a right-clicked or Ctrl+clicked image is the image imported.

/* global Look, Extract, CURIO, ExtBridge */
(function () {
	const PLATFORMS = ['instagram', 'pinterest', 'tiktok', 'x', 'reddit', 'youtube', 'vimeo', 'facebook', 'threads'];

	// The share sheet's phone wording, said the clipper's way (translated in ext-l10n.js).
	const WORDING = {
		'Open Curio': 'Open the clipper settings',
		'Connect Curio to your Nextcloud once, then share from any app to add references.': 'Connect the clipper to your Nextcloud to start clipping.',
		'Nextcloud refused the sign-in. Open Curio and connect again.': 'Nextcloud refused the sign-in. Connect the clipper again in its settings.',
		'Open Curio once and choose where it keeps your boards, then share again.': 'Open Curio once and choose where it keeps your boards, then clip again.',
	};
	const tr = Look.tr.bind(Look);
	Look.tr = (text, vars) => tr(WORDING[text] || text, vars);

	const netRun = Extract.run.bind(Extract);

	Extract.run = async function (share) {
		const dom = share && share.dom;
		if (!dom) return netRun(share);
		const ctx = dom.ctx || {};
		const pageUrl = dom.pageUrl || dom.url || '';

		if (dom.kind === 'text' || ctx.selection) {
			return this.blank({ kind: 'text', selection: dom.selection || '', title: dom.title || '', url: pageUrl, pageUrl: pageUrl, site: this.site(pageUrl) });
		}

		const url = this.cleanUrl(dom.url || pageUrl);
		const site = this.site(url);
		const pageSite = this.site(pageUrl);
		const fromPage = {
			title: dom.title || '',
			description: dom.description || '',
			images: (dom.images || []).filter(Boolean),
			video: dom.video || null,
			videoFileUrl: dom.videoFileUrl || '',
		};

		if (dom.kind === 'pdf') return this.blank({ kind: 'pdf', url: url, pageUrl: pageUrl, site: site, title: fromPage.title });

		// A link to somewhere else: the tab's page says nothing about it. Instagram and
		// Pinterest feeds are the exception, their extractor reads the post under the link.
		const scopedFeed = site === pageSite && (site === 'instagram' || site === 'pinterest');
		if (ctx.link && !ctx.target && !scopedFeed) {
			ExtBridge.renderable = false;
			return netRun({ text: url });
		}

		let out;
		if (PLATFORMS.includes(site)) {
			out = await netRun({ text: url });
			if (dom.kind && dom.kind !== 'link' && out.kind === 'link') fromPage.kind = dom.kind;
			this.fill(out, fromPage, 'page');
		} else {
			out = this.blank({ url: url, pageUrl: pageUrl, site: site, kind: dom.kind || 'link' });
			this.fill(out, fromPage, 'page');
		}

		if (ctx.target) {
			out.images = [ctx.target].concat(out.images.filter((u) => u !== ctx.target));
			out.kind = 'image';
			out.video = null;
			out.videoFileUrl = '';
		}
		out.image = out.images[0] || '';
		return out;
	};

	// Remember Curio's language for the next window (the app learns it from the Curio page).
	const state = CURIO.state.bind(CURIO);
	CURIO.state = async function (config) {
		const s = await state(config);
		if (s && s.lang) {
			const look = Object.assign({}, CURIO.getConfig().look || {}, { lang: s.lang });
			CURIO.setConfig({ look: look });
		}
		return s;
	};
})();
