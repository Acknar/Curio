// content.js - runs on every page. Two jobs:
//   1) Watch for the hotkey (default Ctrl+click) on an image, video, PDF link or a
//      text selection, and start a clip.
//   2) Answer the background's request to read the current page or target.
// The page itself is read by page-extractors.js (CurioExtract), the same file Curio
// for Android runs in its hidden WebView.

/* global browser, content, CurioExtract */
(function () {
	// Injected twice (manifest + injectExistingTabs after an update): keep one set of
	// listeners per version of the clipper.
	const version = browser.runtime.getManifest().version;
	if (window.__curioClipper === version) return;
	window.__curioClipper = version;

	let cfg = { hotkeyEnabled: true, hotkeyMod: 'ctrl' };

	browser.storage.local.get({ hotkeyEnabled: true, hotkeyMod: 'ctrl' }).then((c) => { cfg = c; }).catch(() => {});
	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		if (changes.hotkeyEnabled) cfg.hotkeyEnabled = changes.hotkeyEnabled.newValue;
		if (changes.hotkeyMod) cfg.hotkeyMod = changes.hotkeyMod.newValue;
	});

	function modPressed(e) {
		switch (cfg.hotkeyMod) {
			case 'alt': return e.altKey && !e.ctrlKey && !e.metaKey;
			case 'shift': return e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
			case 'meta': return e.metaKey;
			case 'ctrl':
			default: return e.ctrlKey && !e.altKey;
		}
	}

	function eligible(el) {
		if (!el || !el.closest) return null;
		const tag = el.tagName ? el.tagName.toLowerCase() : '';
		if (tag === 'img' || tag === 'video') return el;
		return el.closest('img, video, a[href$=".pdf"], a[href*=".pdf?"]');
	}

	// Instagram (and others) cover their media with a transparent clickable overlay,
	// so e.target is the overlay. Look at everything under the cursor instead.
	function mediaAtPoint(e) {
		if (!document.elementsFromPoint) return null;
		let stack;
		try { stack = document.elementsFromPoint(e.clientX, e.clientY); } catch (err) { return null; }
		for (const node of stack || []) {
			const t = node.tagName ? node.tagName.toLowerCase() : '';
			if (t === 'img' || t === 'video') return node;
		}
		return null;
	}

	function context(info) {
		return {
			target: info.srcUrl && info.mediaType === 'image' ? info.srcUrl : '',
			link: !!info.linkUrl && !info.srcUrl,
			selection: !!info.hotkeyText,
		};
	}

	function read(info) {
		let data;
		try { data = CurioExtract.page(info); } catch (err) {
			data = { url: location.href, pageUrl: location.href, site: 'web', title: document.title || '', description: '', image: '', images: [], video: null, selection: (info.selectionText || '').trim(), kind: info.hotkeyText ? 'text' : 'link' };
		}
		data.ctx = context(info);
		return data;
	}

	document.addEventListener('click', function (e) {
		if (!cfg.hotkeyEnabled || e.button !== 0 || !modPressed(e)) return;
		const sel = (window.getSelection ? String(window.getSelection()) : '').trim();
		const el = eligible(e.target) || mediaAtPoint(e);
		if (!el && !sel) return; // not on media and nothing selected: leave the browser alone
		e.preventDefault();
		e.stopPropagation();
		const info = el ? CurioExtract.fromElement(el) : { pageUrl: location.href, hotkeyText: true };
		info.selectionText = info.selectionText || sel;
		browser.runtime.sendMessage({ type: 'curio-clip', data: read(info) }).catch(() => {});
	}, true);

	// Instagram's own API for one post, asked from the Instagram tab the way the site
	// asks it: same origin, the signed-in cookies and the page's CSRF token. From
	// the clip window, a separate origin, Instagram can refuse the same request.
	async function igMedia(pk, appId) {
		if (!/(^|\.)instagram\.com$/.test(location.hostname) || !/^\d+$/.test(String(pk))) return null;
		// Firefox runs a content script's fetch as the extension; content.fetch is the page's.
		const pageFetch = (typeof content !== 'undefined' && content && content.fetch) ? content.fetch.bind(content) : fetch;
		const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
		try {
			const res = await pageFetch('/api/v1/media/' + pk + '/info/', {
				credentials: 'include',
				headers: { 'X-IG-App-ID': String(appId || ''), 'X-ASBD-ID': '129477', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf, 'Accept': '*/*' },
			});
			if (!res.ok) return null;
			const data = JSON.parse(await res.text());
			return data && Array.isArray(data.items) && data.items[0] ? data.items[0] : null;
		} catch (err) {
			return null;
		}
	}

	browser.runtime.onMessage.addListener((msg) => {
		if (msg && msg.type === 'curio-get-page') {
			try { return Promise.resolve(read(msg.info || {})); } catch (err) { return Promise.resolve(null); }
		}
		if (msg && msg.type === 'curio-ig-media') return igMedia(msg.pk, msg.appId);
	});
})();
