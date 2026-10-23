// Reads bookmark exports into rows Curio can import. There is no standard CSV
// layout for bookmarks, so CSV columns are matched by name across the common
// exports (Curio's own, Raindrop.io, Pocket, Instapaper, Diigo, spreadsheets);
// the Netscape bookmark file (bookmarks.html), which every browser and most
// bookmark services export, and Pinboard-style JSON are read too.
//
// Each row: { title, url, type, description, note, tags: [], created, cover }.

const ALIASES = {
	url: ['url', 'source_url', 'link', 'href', 'uri', 'address', 'website', 'given_url', 'resolved_url', 'bookmark'],
	title: ['title', 'name', 'given_title', 'resolved_title', 'page title', 'bookmark title'],
	description: ['description', 'excerpt', 'summary', 'selection', 'extended', 'desc'],
	note: ['note', 'notes', 'comment', 'comments', 'annotation', 'annotations', 'highlights'],
	tags: ['tags', 'tag', 'labels', 'label', 'keywords', 'categories'],
	folder: ['folder', 'collection', 'category', 'list', 'group'],
	created: ['created', 'created_at', 'time_added', 'timestamp', 'date', 'added', 'date_added', 'add_date', 'saved', 'time'],
	cover: ['cover', 'image', 'image_url', 'thumbnail', 'thumb', 'preview'],
	type: ['type'],
}

const TYPES = ['link', 'image', 'image_url', 'text', 'video', 'pdf', 'file']

// Folder names that only say where a bookmark sat in the source app.
const GENERIC_FOLDERS = ['unread', 'archive', 'archived', 'starred', 'unsorted', 'read later', 'imported', 'home',
	'bookmarks', 'bookmarks bar', 'bookmarks toolbar', 'bookmarks menu', 'other bookmarks', 'mobile bookmarks', 'favorites bar', 'favourites bar']

export function parseBookmarks(text, fileName = '') {
	const src = String(text || '').replace(/^﻿/, '')
	const head = src.slice(0, 2000).toLowerCase()
	if (/\.json$/i.test(fileName) || /^\s*[[{]/.test(src)) {
		try { return fromJson(JSON.parse(src)) } catch (e) { /* not JSON after all */ }
	}
	if (/\.html?$/i.test(fileName) || head.includes('netscape-bookmark-file') || /<dt>\s*<a\s/i.test(head) || /<a\s+href=/i.test(head)) {
		return fromHtml(src)
	}
	return fromCsv(src)
}

/* ---------- CSV ---------- */

export function splitCsv(text) {
	const firstLine = text.slice(0, text.search(/\r?\n|$/))
	const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length - 1])
	const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ','
	const rows = []
	let row = []
	let field = ''
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
			} else field += c
		} else if (c === '"' && field === '') {
			quoted = true
		} else if (c === delim) {
			row.push(field); field = ''
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++
			row.push(field); field = ''
			if (row.some(v => v !== '')) rows.push(row)
			row = []
		} else field += c
	}
	row.push(field)
	if (row.some(v => v !== '')) rows.push(row)
	return rows
}

function fromCsv(text) {
	const rows = splitCsv(text)
	if (!rows.length) return []
	const header = rows[0].map(h => h.trim().toLowerCase())
	const col = {}
	for (const [key, names] of Object.entries(ALIASES)) {
		if (key === 'note') {
			col.note = names.map(n => header.indexOf(n)).filter(i => i >= 0)
		} else {
			const i = names.map(n => header.indexOf(n)).find(x => x >= 0)
			if (i !== undefined) col[key] = i
		}
	}
	// A file with no header row: a plain list of links, one per line.
	if (col.url === undefined && col.title === undefined) {
		return rows.map(r => r.find(v => /^https?:\/\//i.test(v.trim()))).filter(Boolean).map(u => normalize({ url: u }))
	}
	const get = (r, i) => (i === undefined ? '' : String(r[i] ?? '').trim())
	return rows.slice(1).map(r => normalize({
		url: get(r, col.url),
		title: get(r, col.title),
		type: get(r, col.type),
		description: get(r, col.description),
		note: col.note.map(i => get(r, i)).filter(Boolean).join('\n\n'),
		tags: get(r, col.tags),
		folder: get(r, col.folder),
		created: get(r, col.created),
		cover: get(r, col.cover),
	})).filter(Boolean)
}

/* ---------- Netscape bookmark file ---------- */

function fromHtml(text) {
	const doc = new DOMParser().parseFromString(text, 'text/html')
	const out = []
	for (const a of doc.querySelectorAll('a[href]')) {
		const dt = a.closest('dt')
		let dd = dt && dt.nextElementSibling && dt.nextElementSibling.tagName === 'DD' ? dt.nextElementSibling : null
		if (!dd && dt) dd = dt.querySelector('dd')
		const row = normalize({
			url: a.getAttribute('href'),
			title: a.textContent,
			description: dd ? dd.textContent : '',
			tags: a.getAttribute('tags') || '',
			folder: folderOf(a),
			created: a.getAttribute('add_date') || a.getAttribute('time_added') || '',
			cover: a.getAttribute('data-cover') || '',
		})
		if (row) out.push(row)
	}
	return out
}

// The innermost <H3> folder heading above a link (<DT><H3>Name</H3><DL>...</DL>).
function folderOf(a) {
	for (let n = a.parentElement; n; n = n.parentElement) {
		if (n.tagName !== 'DL') continue
		let prev = n.previousElementSibling
		if (prev && prev.tagName === 'P') prev = prev.previousElementSibling
		if (prev && prev.tagName === 'H3') return prev.textContent
		if (prev && prev.tagName === 'DT' && prev.querySelector('h3')) return prev.querySelector('h3').textContent
		const h3 = n.parentElement && n.parentElement.tagName === 'DT' ? n.parentElement.querySelector(':scope > h3') : null
		if (h3) return h3.textContent
	}
	return ''
}

/* ---------- JSON (Pinboard, or any list of bookmark objects) ---------- */

function fromJson(data) {
	const list = Array.isArray(data) ? data : (data.bookmarks || data.items || data.posts || data.links || [])
	if (!Array.isArray(list)) return []
	return list.map(o => {
		if (!o || typeof o !== 'object') return null
		const pick = (names) => { for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n]; return '' }
		// Pinboard: href, description (the title), extended (the description), space-separated tags.
		const pinboard = 'href' in o && 'extended' in o
		const tags = pick(ALIASES.tags)
		return normalize({
			url: pinboard ? o.href : pick(ALIASES.url),
			title: pinboard ? o.description : pick(ALIASES.title),
			description: pinboard ? o.extended : pick(ALIASES.description),
			note: pick(ALIASES.note),
			tags: Array.isArray(tags) ? tags.map(t => (typeof t === 'object' && t ? t.name : t)) : (pinboard ? String(tags).split(/\s+/) : tags),
			folder: pick(ALIASES.folder),
			created: pick(ALIASES.created),
			cover: pick(ALIASES.cover),
		})
	}).filter(Boolean)
}

/* ---------- shared ---------- */

function normalize(r) {
	const url = String(r.url || '').trim()
	const okUrl = /^https?:\/\//i.test(url) ? url : ''
	let title = String(r.title || '').replace(/\s+/g, ' ').trim()
	if (!title && okUrl) title = titleFromUrl(okUrl)
	if (!title) return null
	const tags = splitTags(r.tags)
	const folder = String(r.folder || '').split('/').pop().trim()
	if (folder && !GENERIC_FOLDERS.includes(folder.toLowerCase()) && !tags.some(t => t.toLowerCase() === folder.toLowerCase())) tags.push(folder)
	const type = String(r.type || '').trim().toLowerCase()
	const cover = String(r.cover || '').trim()
	return {
		title: title.slice(0, 250),
		url: okUrl,
		type: TYPES.includes(type) ? type : 'link',
		description: String(r.description || '').trim(),
		note: String(r.note || '').trim(),
		tags,
		created: toUnix(r.created),
		cover: /^https?:\/\//i.test(cover) ? cover : '',
	}
}

function splitTags(v) {
	if (Array.isArray(v)) return [...new Set(v.map(t => String(t || '').trim()).filter(Boolean))]
	const s = String(v || '').trim()
	if (!s) return []
	const sep = s.includes('|') ? '|' : s.includes(',') ? ',' : s.includes(';') ? ';' : null
	const parts = sep ? s.split(sep) : [s]
	return [...new Set(parts.map(t => t.trim().replace(/^#/, '')).filter(Boolean))]
}

function toUnix(v) {
	const s = String(v ?? '').trim()
	if (!s) return null
	if (/^\d+(\.\d+)?$/.test(s)) {
		const n = Number(s)
		return Math.round(n > 1e12 ? n / 1000 : n)
	}
	const t = Date.parse(s)
	return Number.isNaN(t) ? null : Math.round(t / 1000)
}

function titleFromUrl(u) {
	try {
		const x = new URL(u)
		const path = decodeURIComponent(x.pathname).replace(/\/+$/, '')
		return (x.hostname.replace(/^www\./, '') + path).slice(0, 120)
	} catch (e) { return u }
}
