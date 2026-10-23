// Bookmark import parser (src/bookmarks.js) against sample exports.
// Run: node --test tests/unit/  (jsdom from android/tests provides DOMParser)
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseBookmarks, splitCsv } from '../../src/bookmarks.js'

const require = createRequire(import.meta.url)
const { JSDOM } = require('../../android/tests/node_modules/jsdom')
globalThis.DOMParser = new JSDOM('').window.DOMParser

test('Curio export round trip', () => {
	const rows = parseBookmarks('board,title,type,source_url,description,note,tags,created\n'
		+ 'Travel,"Calanques, Cassis",image_url,https://example.com/p,"Line one\nline two",My note,"Provence,Hiking",2026-07-01T10:00:00+00:00\n')
	assert.equal(rows.length, 1)
	assert.deepEqual(rows[0], { title: 'Calanques, Cassis', url: 'https://example.com/p', type: 'image_url', description: 'Line one\nline two', note: 'My note', tags: ['Provence', 'Hiking'], created: 1782900000, cover: '' })
})

test('Raindrop.io CSV: folder becomes a tag, note and highlights kept, cover read', () => {
	const csv = 'id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite\n'
		+ '1,Brick vaults,Look at the joints,Terracotta vaults in Vietnam,https://archdaily.com/x,Architecture/Clay,"brick, vault",2025-03-04T10:00:00.000Z,https://img.example/c.jpg,"Highlight: the mortar",true\n'
		+ '2,Unsorted link,,,https://example.org,Unsorted,,2025-03-05T10:00:00.000Z,,,false\n'
	const rows = parseBookmarks(csv)
	assert.equal(rows[0].title, 'Brick vaults')
	assert.equal(rows[0].description, 'Terracotta vaults in Vietnam')
	assert.equal(rows[0].note, 'Look at the joints\n\nHighlight: the mortar')
	assert.deepEqual(rows[0].tags, ['brick', 'vault', 'Clay'])
	assert.equal(rows[0].cover, 'https://img.example/c.jpg')
	assert.deepEqual(rows[1].tags, [], 'Unsorted is not a tag')
})

test('Pocket CSV: pipe-separated tags, unix time', () => {
	const rows = parseBookmarks('title,url,time_added,cursor,tags,status\nGreat read,https://a.com/1,1700000000,abc,design|wood,unread\n')
	assert.deepEqual(rows[0].tags, ['design', 'wood'])
	assert.equal(rows[0].created, 1700000000)
})

test('Instapaper CSV: Unread folder ignored, untitled row named after its URL', () => {
	const rows = parseBookmarks('URL,Title,Selection,Folder,Timestamp\nhttps://www.example.com/articles/pise/,,Rammed earth,Unread,1690000000\nhttps://b.com,B,,Materials,1690000001\n')
	assert.equal(rows[0].title, 'example.com/articles/pise')
	assert.equal(rows[0].description, 'Rammed earth')
	assert.deepEqual(rows[0].tags, [])
	assert.deepEqual(rows[1].tags, ['Materials'])
})

test('Semicolon CSV from a spreadsheet, and a bare list of links', () => {
	assert.equal(parseBookmarks('Name;Link;Tags\nA;https://a.com;x\n')[0].url, 'https://a.com')
	assert.deepEqual(parseBookmarks('https://a.com\nhttps://b.com/page\n').map(r => r.title), ['a.com', 'b.com/page'])
})

test('Netscape bookmark file (browsers, Raindrop, Pocket legacy)', () => {
	const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
	<DT><H3 ADD_DATE="1">Bookmarks bar</H3>
	<DL><p>
		<DT><H3>Wood</H3>
		<DL><p>
			<DT><A HREF="https://wood.example/truss" ADD_DATE="1600000000" TAGS="roof,details">Truss detail</A>
			<DD>Shed roof truss
		</DL><p>
		<DT><A HREF="https://plain.example/" ADD_DATE="1600000001">Plain</A>
	</DL><p>
	<DT><A href="https://pocket.example/a" time_added="1600000002" tags="clay">Pocket item</A>
</DL><p>`
	const rows = parseBookmarks(html, 'bookmarks.html')
	assert.equal(rows.length, 3)
	assert.deepEqual(rows[0], { title: 'Truss detail', url: 'https://wood.example/truss', type: 'link', description: 'Shed roof truss', note: '', tags: ['roof', 'details', 'Wood'], created: 1600000000, cover: '' })
	assert.deepEqual(rows[1].tags, [], 'Bookmarks bar is not a tag')
	assert.equal(rows[2].created, 1600000002)
	assert.deepEqual(rows[2].tags, ['clay'])
})

test('Pinboard JSON', () => {
	const rows = parseBookmarks(JSON.stringify([{ href: 'https://p.example', description: 'Pin title', extended: 'Longer text', tags: 'earth 3d-printing', time: '2024-01-02T03:04:05Z' }]), 'pinboard.json')
	assert.equal(rows[0].title, 'Pin title')
	assert.equal(rows[0].description, 'Longer text')
	assert.deepEqual(rows[0].tags, ['earth', '3d-printing'])
})

test('CSV splitter handles quotes, doubled quotes and CRLF', () => {
	assert.deepEqual(splitCsv('a,b\r\n"x ""y""","1\r\n2"\r\n'), [['a', 'b'], ['x "y"', '1\r\n2']])
})
