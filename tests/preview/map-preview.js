// Screenshots of the map layout with the real OpenFreeMap basemap, light and dark,
// world view and zoomed in. Usage: node map-preview.js <outdir>
const fs = require('fs');
const { chromium } = require('playwright');
const { setup } = require('./mock-nextcloud');

const out = process.argv[2] || 'previews';
fs.mkdirSync(out, { recursive: true });

(async () => {
	const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
	const report = [];
	for (const theme of ['light', 'dark']) {
		const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
		const { url } = await setup(ctx, { settings: { theme, layout: 'map' } });
		const ofm = [];
		ctx.on('requestfinished', async (r) => { if (r.url().includes('openfreemap')) { const res = await r.response(); ofm.push((res ? res.status() : 0) + ' ' + r.url().replace(/^https:\/\/tiles\.openfreemap\.org/, '')); } });
		const p = await ctx.newPage();
		const errors = [];
		p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
		p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
		await p.goto(url);
		await p.waitForTimeout(9000);
		await p.screenshot({ path: `${out}/map-${theme}-world.png` });
		// Zoom into Barcelona through Leaflet.
		await p.evaluate(() => {
			const app = document.getElementById('curio-root').__vue_app__._instance.proxy;
			app._map.setView([41.395, 2.165], 14);
		});
		await p.waitForTimeout(7000);
		await p.screenshot({ path: `${out}/map-${theme}-barcelona.png` });
		const attribution = await p.evaluate(() => (document.querySelector('.leaflet-control-attribution') || {}).innerText || '');
		const notice = await p.evaluate(() => (document.querySelector('.rb-map-keynote') || {}).innerText || '');
		report.push({ theme, attribution, notice, errors, openfreemapRequests: ofm.length, sample: ofm.slice(0, 12) });
		await ctx.close();
	}
	await browser.close();
	fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
})();
