// taglogic.js - client-side hashtag, tag-matching and URL helpers, ported
// verbatim in behaviour from the Curio app (src/App.vue + src/helpers.js) so the
// clipper auto-tags a caption exactly the way the in-app add dialog does.

const TagLogic = {
	tags: [], // set to the account's tag list before use

	setTags(tags) { this.tags = Array.isArray(tags) ? tags : []; },

	normTag(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },

	fuzzyTagMatch(h) {
		const n = this.normTag(h);
		if (!n) return null;
		return this.tags.find(t => this.normTag(t.name) === n) || null;
	},

	splitHashtag(h) {
		return String(h || '')
			.replace(/[_\-]+/g, ' ')
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
			.replace(/([a-zA-Z])([0-9])/g, '$1 $2')
			.replace(/([0-9])([a-zA-Z])/g, '$1 $2')
			.split(/\s+/).map(w => w.trim()).filter(Boolean);
	},

	segmentByTags(norm) {
		if (!norm) return [];
		const entries = this.tags.map(t => ({ t, n: this.normTag(t.name) })).filter(e => e.n.length >= 3);
		const n = norm.length;
		const memo = {};
		const solve = (i) => {
			if (i === n) return [];
			if (i in memo) return memo[i];
			for (const e of entries) {
				if (norm.startsWith(e.n, i)) {
					const rest = solve(i + e.n.length);
					if (rest) return (memo[i] = [e.t, ...rest]);
				}
			}
			return (memo[i] = null);
		};
		const r = solve(0);
		return (r && r.length >= 2) ? r : [];
	},

	matchHashtagTags(h) {
		const out = new Map();
		const whole = this.fuzzyTagMatch(h);
		if (whole) out.set(whole.id, whole);
		const words = this.splitHashtag(h);
		let wordHit = false;
		if (words.length > 1) {
			for (const w of words) {
				const m = this.fuzzyTagMatch(w);
				if (m) { out.set(m.id, m); wordHit = true; }
			}
		}
		if (!whole && !wordHit) {
			for (const t of this.segmentByTags(this.normTag(h))) out.set(t.id, t);
		}
		return Array.from(out.values());
	},

	autoTagMatches(text) {
		const hay = String(text || '');
		if (!hay.trim()) return [];
		const out = [];
		for (const t of this.tags) {
			const name = (t.name || '').trim();
			if (name.length < 2) continue;
			const esc = name.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
			let re;
			try { re = new RegExp('(?<![\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'iu'); }
			catch (e) { re = new RegExp('\\b' + esc + '\\b', 'i'); }
			if (re.test(hay)) out.push(t);
		}
		return out;
	},

	stripHashtags(text) {
		return (text || '')
			.replace(/#[\p{L}0-9_]{1,50}/gu, '')
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/\s+([.,!?;:])/g, '$1')
			.trim();
	},

	extractHashtags(text) {
		const tags = [];
		const re = /#([\p{L}0-9_]{1,50})/gu;
		let m;
		while ((m = re.exec(text || '')) !== null) tags.push(m[1]);
		return { text: this.stripHashtags(text), tags: [...new Set(tags)] };
	},
};

function parseVideo(url) {
	let m;
	if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i))) return { provider: 'youtube', id: m[1], embed: 'https://www.youtube.com/embed/' + m[1], thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' };
	if ((m = url.match(/vimeo\.com\/(\d+)/i))) return { provider: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] };
	if ((m = url.match(/(?:instagram\.com|instagr\.am)\/(reel|reels|tv)\/([\w-]+)/i))) { const k = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase(); return { provider: 'instagram', id: m[2], embed: 'https://www.instagram.com/' + k + '/' + m[2] + '/embed' }; }
	if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return { provider: 'file', src: url };
	return null;
}

function detectUrlType(u) {
	if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(u)) return 'image_url';
	if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(u) || /\.(mp4|webm|ogg)(\?|#|$)/i.test(u)) return 'video';
	if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf';
	return 'link';
}

function domainOf(url) {
	if (!url) return '';
	try { return new URL(url).hostname.replace(/^www\./, ''); }
	catch (e) { return (url.split('/')[2] || '').replace(/^www\./, ''); }
}
