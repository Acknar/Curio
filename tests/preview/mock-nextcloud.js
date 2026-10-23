// A fake Nextcloud page hosting the real Curio bundle (../../js), with the Curio API
// mocked and a Content-Security-Policy like the one PageController sends. Requests to
// any other host go to the real network (map tiles), unless a test routes them.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', '..', 'js');
const ORIGIN = 'http://cloud.test';

function page() {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{--header-height:50px;--color-primary-element:#00679e;--color-primary-element-light:#e5eff5}
html,body{margin:0;height:100%;font-family:system-ui,sans-serif}
#header{position:fixed;top:0;left:0;right:0;height:50px;background:#00679e;color:#fff;display:flex;align-items:center;padding:0 12px;z-index:2000}
#content{position:absolute;top:var(--header-height);left:0;right:0;bottom:0;display:flex}</style>
<script>window._oc_webroot='';window._oc_appswebroots={curio:'/apps/curio'};window.OC={config:{modRewriteWorking:false},getCanonicalLocale:()=>'en-US',getLocale:()=>'en'};</script>
</head><body id="body-user"><header id="header"><b>Nextcloud</b></header><div id="content" class="app-curio"><div id="curio-root"></div></div>
<script src="/apps/curio/js/curio-main.js"></script></body></html>`;
}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' * data: blob:; font-src 'self' data:; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'";

function tile(c) {
	return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${c}"/></svg>`);
}

const PLACES = [
	['Fàbrica Aymerich', 41.5636, 2.0089, '#b5651d'], ['Sagrada Família', 41.4036, 2.1744, '#c9a66b'],
	["Musée d'Orsay", 48.86, 2.3266, '#8e9aaf'], ['Cité radieuse', 43.2617, 5.3963, '#7a8b6f'],
	['Norway office', 59.91, 10.75, '#5b7c99'], ['Priory Chapel', 38.63, -90.45, '#d9c2a3'],
	['Casa Batlló', 41.3917, 2.1650, '#3f6b3a'], ['Hanoi brick house', 21.03, 105.85, '#a8452c'],
];

function state(opts) {
	return {
		currentUser: { uid: 'tom', displayName: 'Tom Bardout' },
		boards: [{ id: 1, name: 'Conception archi', color: '#0069c2', mine: true, visible: true }],
		references: (opts.only ? PLACES.filter((p) => opts.only.includes(p[0])) : PLACES).map((p, i) => ({ id: 10 + i, board: 1, type: 'image_url', title: p[0], img: tile(p[3]), tags: [], comments: [], seed: 3 + i, lat: p[1], lng: p[2], owner: 'tom', created: 1790000000 + i })),
		tags: [], folders: [],
		settings: Object.assign({ theme: 'light', layout: 'map', labels: true, sort: 'created_desc', dateFormat: 'auto' }, opts.settings || {}),
		map: opts.map || { key: '', canEdit: true },
		onboarding: opts.onboarding || { done: true },
	};
}

async function setup(context, opts = {}) {
	const log = [];
	await context.route(ORIGIN + '/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		log.push(req.method() + ' ' + u.pathname + u.search);
		if (u.pathname.startsWith('/apps/curio/js/')) {
			const f = path.join(JS, path.basename(u.pathname));
			if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
			return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(f) });
		}
		if (u.pathname.startsWith('/apps/curio/img/')) {
			const f = path.join(JS, '..', 'img', path.basename(u.pathname));
			if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
			return route.fulfill({ contentType: f.endsWith('.webp') ? 'image/webp' : 'image/svg+xml', body: fs.readFileSync(f) });
		}
		if (u.pathname.endsWith('/api/state')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state(opts)) });
		if (u.pathname.includes('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
		return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': CSP }, body: page() });
	});
	return { log, url: ORIGIN + '/index.php/apps/curio/' };
}

module.exports = { setup };
