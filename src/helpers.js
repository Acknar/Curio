// Shared presentation helpers, ported from the v0.7.4 preview.

// Curated, coordinated tag palettes: earthy naturals, soft pastels, muted tones.
export const PALETTE_GROUPS = [
	{ name: 'Natural', colors: ['#6e7b3f', '#3f6b3a', '#b3a369', '#d9c2a3', '#c99a3b', '#e1802f', '#c56c4e', '#a8452c', '#7c5a43', '#35695f', '#4a6a8a', '#6a4a66'] },
	{ name: 'Pastel', colors: ['#a9c1a0', '#b9dbc8', '#a6d8d2', '#a9c4e0', '#b7bfe8', '#c4b6d8', '#dcb8d8', '#e7b7c4', '#f0c2b8', '#f1c9ac', '#ecdca6', '#d6dda0'] },
	{ name: 'Muted', colors: ['#a65246', '#b3703f', '#b99239', '#8a8a4a', '#6e8b63', '#4f807a', '#5e7e99', '#575e8c', '#7b6a8b', '#8a5674', '#b07385', '#6b7480'] },
]
// Flat list (defaults / random pick / backwards compat).
export const PALETTE = PALETTE_GROUPS.reduce((a, g) => a.concat(g.colors), [])

export const ICON = {
	eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
	image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
	link: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 015.66 5.66l-2 2"/><path d="M13 18l-1 1a4 4 0 01-5.66-5.66l2-2"/>',
	text: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
	tag: '<path d="M20.6 13.4L12 22l-8-8V4h10l6.6 6.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
	trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
	edit: '<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
	x: '<path d="M6 6l12 12M18 6L6 18"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
	folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8 2 2 0 11-2.5 2.5 1.6 1.6 0 00-2.9 1V21a2 2 0 11-4 0 1.6 1.6 0 00-2.9-1 2 2 0 11-2.5-2.5 1.6 1.6 0 00-1-2.9H3a2 2 0 110-4 1.6 1.6 0 001-2.9A2 2 0 116.5 4.6a1.6 1.6 0 002.9-1V3a2 2 0 114 0 1.6 1.6 0 002.9 1 2 2 0 112.5 2.5 1.6 1.6 0 001 2.9H21a2 2 0 110 4 1.6 1.6 0 00-1.6 1z"/>',
	chevron: '<path d="M9 6l6 6-6 6"/>',
	dots: '<circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
	maximize: '<path d="M3 9V4h5"/><path d="M21 9V4h-5"/><path d="M3 15v5h5"/><path d="M21 15v5h-5"/>',
	minimize: '<path d="M9 3v5H4"/><path d="M15 3v5h5"/><path d="M9 21v-5H4"/><path d="M15 21v-5h5"/>',
	check: '<path d="M20 6L9 17l-5-5"/>',
	video: '<rect x="2.5" y="6" width="12" height="12" rx="2"/><path d="M14.5 10l7-3.5v11l-7-3.5z"/>',
	eyeoff: '<path d="M17.94 17.94A10.94 10.94 0 0112 20C5 20 1.5 12 1.5 12a19.6 19.6 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 10.5 8 10.5 8a19.6 19.6 0 01-2.16 3.19"/><path d="M14.12 14.12A3 3 0 019.88 9.88"/><path d="M1 1l22 22"/>',
	pdf: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
	filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
	pin: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
	locate: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5"/>',
}

export function ic(n, s = 16) {
	return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ''}</svg>`
}

export function playSvg(s = 18) {
	return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>`
}

export const TYPE_ICON = { image: ic('image'), link: ic('link'), image_url: ic('image'), text: ic('text'), video: ic('video'), pdf: ic('pdf'), file: ic('text') }
export const TYPE_NAME = { image: 'Image', link: 'Web page', image_url: 'Image link', text: 'Text note', video: 'Video', pdf: 'PDF', file: 'File' }

export function grad(seed) {
	const a = PALETTE[seed % 14]; const b = PALETTE[(seed * 3 + 4) % 14]
	return `linear-gradient(${(seed * 47) % 360}deg, ${a}, ${b})`
}

export function svgThumb(seed) {
	const a = PALETTE[seed % 14]; const b = PALETTE[(seed * 3 + 4) % 14]; const ang = (seed * 47) % 360
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1' gradientTransform='rotate(${ang} .5 .5)'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='400' height='400' fill='url(#g)'/><circle cx='${80 + (seed * 17) % 240}' cy='${90 + (seed * 23) % 200}' r='${50 + (seed * 11) % 80}' fill='rgba(255,255,255,.15)'/><circle cx='${260 - (seed * 13) % 200}' cy='${280 - (seed * 19) % 180}' r='${40 + (seed * 7) % 70}' fill='rgba(0,0,0,.10)'/></svg>`
	return `url(data:image/svg+xml;base64,${btoa(svg)})`
}

export function initials(n) {
	return (n || '').split(' ').map(s => s[0]).join('').slice(0, 2)
}

export function textOn(hex) {
	const c = (hex || '#888').replace('#', '')
	const r = parseInt(c.substr(0, 2), 16); const g = parseInt(c.substr(2, 2), 16); const b = parseInt(c.substr(4, 2), 16)
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1a1a1a' : '#fff'
}

function esc(s) {
	return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function mdInline(s) {
	return esc(s)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^_]+)__/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

export function mdToHtml(md) {
	const lines = (md || '').split('\n'); let html = ''; let list = null
	const close = () => { if (list) { html += '</' + (list === 'ol' ? 'ol' : 'ul') + '>'; list = null } }
	for (const raw of lines) {
		const line = raw.replace(/\s+$/, ''); let m
		if (!line.trim()) { close(); continue }
		if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { close(); const lvl = Math.min(m[1].length + 2, 6); html += '<h' + lvl + '>' + mdInline(m[2]) + '</h' + lvl + '>'; continue }
		if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) { if (list !== 'ulc') { close(); html += '<ul class="md-check">'; list = 'ulc' } const done = m[1].trim() !== ''; html += '<li class="' + (done ? 'done' : '') + '"><span class="cbx">' + (done ? ic('check', 11) : '') + '</span><span>' + mdInline(m[2]) + '</span></li>'; continue }
		if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul' } html += '<li>' + mdInline(m[1]) + '</li>'; continue }
		if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol' } html += '<li>' + mdInline(m[1]) + '</li>'; continue }
		close(); html += '<p>' + mdInline(line) + '</p>'
	}
	close(); return html
}

export function parseVideo(url) {
	let m
	if ((m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i))) return { provider: 'youtube', id: m[1], embed: 'https://www.youtube.com/embed/' + m[1], thumb: 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' }
	if ((m = url.match(/vimeo\.com\/(\d+)/i))) return { provider: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] }
	if ((m = url.match(/(?:instagram\.com|instagr\.am)\/(reel|reels|tv)\/([\w-]+)/i))) { const k = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase(); return { provider: 'instagram', id: m[2], embed: 'https://www.instagram.com/' + k + '/' + m[2] + '/embed' } }
	if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return { provider: 'file', src: url }
	return null
}

export function videoWatchUrl(r) {
	const v = r.video || {}
	if (v.provider === 'youtube') return 'https://www.youtube.com/watch?v=' + v.id
	if (v.provider === 'vimeo') return 'https://vimeo.com/' + v.id
	if (v.provider === 'instagram') return r.source_url || ('https://www.instagram.com/reel/' + v.id + '/')
	if (v.src) return v.src
	return r.source_url || (r.domain ? ('https://' + r.domain) : '#')
}

// derive a short source label from a url
export function domainOf(url) {
	if (!url) return ''
	try { return new URL(url).hostname.replace(/^www\./, '') } catch (e) { return (url.split('/')[2] || '').replace(/^www\./, '') }
}
