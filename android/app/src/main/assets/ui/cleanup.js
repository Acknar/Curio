// cleanup.js - title/description cleanup ported verbatim in behaviour from the
// Curio app's FetcherService (refineSocialMeta + helpers), so a clipped caption
// reads exactly like one fetched inside the app: engagement counts, wrapping
// quotes, @mentions, emoji/pictographs/decorative dots removed, and a long
// social caption turned into a short headline + description. Hashtag stripping
// stays in taglogic.js (extractHashtags/stripHashtags), applied afterwards, to
// match the app's order.

const Cleanup = {
	// Emoji + pictographs + decorative dots/bullets + variation selectors.
	EMOJI_RE: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2022}\u{2023}\u{2043}\u{2219}\u{00B7}\u{200D}\u{20E3}\u{2122}\u{2139}\u{FE0E}\u{FE0F}]/gu,

	// Collapse runs of spaces/tabs but KEEP newlines, so a caption's line structure
	// (headline on the first line, details below) survives cleanup and can drive a
	// clean title/description split.
	tidySpaces(text) {
		return String(text || '')
			.replace(/[^\S\n]{2,}/gu, ' ')
			.replace(/[^\S\n]+([.,!?;:])/gu, '$1')
			.replace(/[^\S\n]+\n/gu, '\n')
			.replace(/\n[^\S\n]+/gu, '\n')
			.replace(/\n{3,}/gu, '\n\n');
	},

	stripEmoji(text) {
		text = String(text || '').replace(this.EMOJI_RE, '');
		return this.tidySpaces(text).trim();
	},

	stripMentions(text) {
		const h = '@[\\p{L}0-9_]+(?:\\.[\\p{L}0-9_]+)*';
		text = String(text || '');
		// Parenthetical groups of only mentions + separators (may span newlines).
		text = text.replace(new RegExp('\\(\\s*' + h + '(?:(?:[\\s,;&]+|\\s+(?:and|et|x|und|y|e)\\s+)' + h + ')*\\s*\\)', 'gu'), '');
		// Runs of one or more mentions joined by same-line separators.
		text = text.replace(new RegExp(h + '(?:(?:[ \\t,;&]+|[ \\t]+(?:and|et|x|und|y|e)[ \\t]+)' + h + ')*', 'gu'), '');
		text = text.replace(/\([^\S\n]*\)/gu, '');
		text = this.tidySpaces(text);
		text = text.replace(/([([{])[^\S\n]+/gu, '$1');
		text = text.replace(/^[\s\-,;:&]+/u, '').replace(/[\s\-,;:&]+$/u, '');
		return text.trim();
	},

	// Split a cleaned caption into a headline title + a description, robustly:
	//  - a short first line becomes the title, the rest becomes the description;
	//  - a long unbroken first line yields a teaser title (first sentence, or a
	//    clause/word-boundary cut) and keeps the full text as the description.
	// This avoids the "random" mid-sentence cuts that happen when newlines are lost.
	splitHeadline(text) {
		const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
		if (!lines.length) return { title: '', description: '' };
		const first = lines[0];
		const rest = lines.slice(1).join('\n');
		const MAX = 90;
		const noDot = (s) => s.replace(/\.\s*$/u, '').trim() || s;

		// Multi-line caption: the first line IS the headline (predictable), the rest
		// is the description. A pathologically long first line becomes a teaser.
		if (lines.length > 1) {
			if (Array.from(first).length <= MAX) return { title: noDot(first), description: rest };
			const s = this.firstSentence(first);
			const title = (s && Array.from(s).length <= MAX) ? s : this.shortTitle(first);
			const full = [first, rest].join('\n');
			return /…$/u.test(title) ? { title: title, description: full } : { title: title, description: this.stripLead(full, title) || full };
		}

		// Single-line caption: split at the first sentence when that meaningfully
		// shortens it; otherwise the whole (short) line is the title, or a teaser.
		const sentence = this.firstSentence(first);
		if (sentence && Array.from(sentence).length >= 8 && Array.from(sentence).length < Array.from(first).length && Array.from(sentence).length <= MAX) {
			return { title: sentence, description: this.stripLead(first, sentence) };
		}
		if (Array.from(first).length <= MAX) return { title: noDot(first), description: '' };
		return { title: this.shortTitle(first), description: first };
	},

	firstSentence(text) {
		text = String(text || '').replace(/\s+/gu, ' ').trim();
		if (text === '') return '';
		let s;
		const m = text.match(/^(.+?[.!?])(\s|$)/u);
		s = m ? m[1].trim() : text;
		s = s.replace(/\.+$/u, '').trim();
		const arr = Array.from(s);
		if (arr.length > 120) s = arr.slice(0, 120).join('').replace(/\s+$/u, '') + '...';
		return s;
	},

	leadTitle(text) {
		const firstLine = (String(text || '').split(/\r\n|\r|\n/u)[0] || text || '').trim();
		return this.firstSentence(firstLine !== '' ? firstLine : text);
	},

	shortTitle(s) {
		s = String(s || '').trim();
		const max = 72;
		if (Array.from(s).length <= max) return s;
		const m = s.match(/^([\s\S]{20,72}?)\s*[,;:–—―-]\s/u);
		if (m) return m[1].replace(/[\s,;:–—-]+$/u, '').trim();
		let cut = Array.from(s).slice(0, max).join('');
		const sp = cut.lastIndexOf(' ');
		if (sp !== -1 && sp > Math.floor(max * 0.55)) cut = cut.slice(0, sp);
		return cut.replace(/[\s,;:.\-]+$/u, '').trim() + '…';
	},

	stripLead(full, title) {
		full = String(full || '');
		const needle = String(title || '').replace(/[.!?…]+$/u, '').trim();
		if (needle === '' || full.toLowerCase().indexOf(needle.toLowerCase()) !== 0) return full.trim();
		let rest = full.slice(needle.length);
		if (rest !== '' && !/^[\s.!?…:;,\-]/u.test(rest)) return full.trim();
		rest = rest.replace(/^[\s.!?…:;,\-]+/u, '');
		return rest.trim();
	},

	// Port of FetcherService::refineSocialMeta. Returns { title, description }.
	refineMeta(title, desc, url) {
		desc = String(desc || '').trim();
		const out = { title: String(title || ''), description: desc };
		if (desc === '') return out;

		let host = '';
		try { host = new URL(url).hostname.toLowerCase(); } catch (e) { host = ''; }
		const isSocial = /(^|\.)(instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|threads\.net)$/.test(host);

		let cleaned = desc;
		const colon = desc.indexOf(':');
		const prefix = colon !== -1 ? desc.slice(0, Math.min(colon, 200)) : '';
		const looksLikePrefix = prefix !== '' && (
			/[\d][\d.,\s]*[kmb]?\s*(likes?|comments?|views?)/iu.test(prefix)
			|| /\bon\s+(instagram|facebook|tiktok|threads|x)\b/iu.test(prefix)
			|| /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/.]\d{1,2})/iu.test(prefix)
		);
		if (colon !== -1 && looksLikePrefix) {
			cleaned = desc.replace(/^[\s\S]*?:\s*/u, '');
		}
		cleaned = cleaned.trim();
		// Drop wrapping straight/curly quotes, incl. a dangling closing quote after a period.
		cleaned = cleaned.replace(/^["'“”‘’\s]+/u, '').replace(/["'“”‘’\s]+$/u, '');
		cleaned = cleaned.replace(/\s*["“”‘’]\s*[.。]?\s*$/u, '');
		cleaned = cleaned.replace(/^\s*[.。]?\s*["“”‘’]\s*/u, '');
		cleaned = cleaned.trim();
		cleaned = this.stripMentions(cleaned);
		cleaned = this.stripEmoji(cleaned);

		const haveTitle = String(out.title || '').trim() !== '';
		if (isSocial || !haveTitle) {
			// Derive a headline from the caption (social captions have no separate title;
			// neither does a page whose og:title was empty).
			const sp = this.splitHeadline(cleaned);
			if (sp.title) { out.title = sp.title; out.description = sp.description; }
			else out.description = cleaned;
		} else {
			// A real title already exists (Pinterest / YouTube / most web pages): keep it,
			// and just use the cleaned caption as the description. Never clobber a good title.
			out.description = cleaned;
		}
		return out;
	},
};

if (typeof self !== 'undefined') self.Cleanup = Cleanup;
