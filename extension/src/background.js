// background.js - toolbar button, right-click menu, keyboard shortcut and the
// Ctrl+click hotkey all end here: read the page through the content script, keep
// the result in storage.session and open the clip window (ui/clip.html), which is
// Curio for Android's "Add reference" dialog running on the browser bridge.
// Runs as a Firefox event page (background.scripts) and as a Chrome service worker.

/* global browser, importScripts */
if (typeof browser === 'undefined' && typeof importScripts === 'function') importScripts('browser-polyfill.min.js');

const MENU_ID = 'curio-clip';
const CLIP_WINDOW = { width: 520, height: 720 };

function buildMenus() {
	browser.contextMenus.removeAll().then(() => {
		browser.contextMenus.create({
			id: MENU_ID,
			title: browser.i18n.getMessage('menuClip') || 'Clip to Curio',
			contexts: ['image', 'video', 'link', 'selection', 'page'],
		});
	}).catch(() => {});
}

browser.runtime.onInstalled.addListener((details) => {
	buildMenus();
	injectExistingTabs();
	// First install: open the settings page, which starts with the connection.
	if (details && details.reason === 'install') browser.runtime.openOptionsPage().catch(() => {});
});
browser.runtime.onStartup.addListener(buildMenus);

// Content scripts declared in the manifest only reach pages loaded after the
// install. Inject into the tabs already open, so the hotkey works without a reload.
async function injectExistingTabs() {
	if (!browser.scripting || !browser.scripting.executeScript) return;
	let tabs = [];
	try { tabs = await browser.tabs.query({}); } catch (e) { return; }
	for (const t of tabs) {
		if (!t.id || !/^https?:/i.test(t.url || '')) continue;
		try {
			await browser.scripting.executeScript({
				target: { tabId: t.id },
				files: ['browser-polyfill.min.js', 'ui/page-extractors.js', 'content.js'],
			});
		} catch (e) { /* privileged page or no access: skip */ }
	}
}

// What the clip started from, so the clip window knows whether a specific image,
// a link or a selection was meant rather than the whole page.
function clipContext(info) {
	return {
		target: info.srcUrl && info.mediaType === 'image' ? info.srcUrl : '',
		link: !!info.linkUrl && !info.srcUrl,
		selection: !!info.hotkeyText,
	};
}

// Fallback payload when the content script is unavailable (the PDF viewer, a
// privileged page, a page the extension cannot reach).
function payloadFromInfo(info, tab) {
	const url = info.linkUrl || info.srcUrl || (tab && tab.url) || info.pageUrl || '';
	let kind = 'link';
	if (info.mediaType === 'image') kind = 'image';
	else if (info.mediaType === 'video') kind = 'video';
	else if (/\.pdf($|[?#])/i.test(url)) kind = 'pdf';
	else if (info.hotkeyText) kind = 'text';
	return {
		url: url,
		pageUrl: info.pageUrl || (tab && tab.url) || url,
		site: 'web',
		title: (tab && tab.title) || '',
		description: '',
		image: info.mediaType === 'image' ? (info.srcUrl || '') : '',
		images: info.mediaType === 'image' && info.srcUrl ? [info.srcUrl] : [],
		video: null,
		selection: (info.selectionText || '').trim(),
		kind: kind,
		ctx: clipContext(info),
	};
}

async function extractViaTab(tabId, info) {
	try {
		const data = await browser.tabs.sendMessage(tabId, { type: 'curio-get-page', info: info });
		if (data) return data;
	} catch (e) { /* content script not reachable */ }
	return null;
}

async function openClipper(data) {
	// The payload can be large: stash it and pass only its id in the URL.
	const id = 'clip-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
	const store = browser.storage.session || browser.storage.local;
	await store.set({ [id]: data });
	await browser.windows.create({
		url: browser.runtime.getURL('ui/clip.html') + '?id=' + encodeURIComponent(id),
		type: 'popup',
		width: CLIP_WINDOW.width,
		height: CLIP_WINDOW.height,
	});
}

async function clip(info, tab) {
	let data = tab && tab.id != null ? await extractViaTab(tab.id, info) : null;
	if (!data) data = payloadFromInfo(info, tab);
	data.ctx = data.ctx || clipContext(info);
	await openClipper(data);
}

browser.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId !== MENU_ID) return;
	const passInfo = {
		srcUrl: info.srcUrl,
		mediaType: info.mediaType,
		linkUrl: info.linkUrl,
		selectionText: info.selectionText,
		pageUrl: info.pageUrl,
	};
	// Right-clicking selected text (not on a link or an image) saves it as a note.
	if (info.selectionText && !info.srcUrl && !info.linkUrl) passInfo.hotkeyText = true;
	clip(passInfo, tab);
});

async function clipActiveTab(tab) {
	if (!tab) {
		try { const tabs = await browser.tabs.query({ active: true, currentWindow: true }); tab = tabs && tabs[0]; } catch (e) { tab = null; }
	}
	await clip({ pageUrl: tab && tab.url }, tab);
}

browser.action.onClicked.addListener((tab) => clipActiveTab(tab));

if (browser.commands && browser.commands.onCommand) {
	browser.commands.onCommand.addListener((command, tab) => {
		if (command === 'clip-page') clipActiveTab(tab);
	});
}

browser.runtime.onMessage.addListener((msg) => {
	if (msg && msg.type === 'curio-clip' && msg.data) openClipper(msg.data);
});
