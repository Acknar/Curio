# Changelog

All notable changes to the Curio Web Clipper are documented here. The project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions
1.0.0 to 1.1.0 were Firefox-only and kept outside this repository.

## 1.2.0 - Unreleased

### Added

- Chrome, Edge, Brave and Opera, from the same source as the Firefox version (`node build.mjs` builds both).
- Sign in with Nextcloud: enter the server address and approve the clipper on your Nextcloud's own page (Login Flow v2). Nextcloud creates an app password named after the clipper and the browser, revocable in Security > Devices & sessions, and the sign-in tab closes by itself. Entering an app password by hand still works.
- The settings page opens on first install. It shows the connection, the default board, the click hotkey (or off) and how to clip, and checks that Firefox has granted access to websites.
- Keyboard shortcut Alt+Shift+C clips the current page.
- Right-clicking selected text saves it as a note.
- On Instagram, Pinterest, TikTok, X, Reddit, YouTube, Vimeo, Facebook and Threads, the clip also runs Curio for Android's extraction chain with the browser's own sign-ins: Instagram's full caption, every carousel image, the reel video and the tagged place with coordinates; Pinterest's original-size image; TikTok's full caption and place; X's photos and video; Reddit galleries; YouTube's full description. The page as read in the tab fills whatever that leaves out.
- A right-clicked link to another page is read like a link shared from a phone, instead of taking the open page's title and picture.
- Translations in French, Spanish, German, Italian, Portuguese and Dutch, following Curio's language and accent colour.

### Changed

- The clip window is Curio's own Add reference dialog, as in Curio for Android, with Curio's stylesheet and translations, and the board picker, image chooser, place search and tag suggestions behave as in the app.
- New icon in Nextcloud blue, matching Curio for Android.
- Removed the unused notifications permission.
