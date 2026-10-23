# Changelog

All notable changes to Curio are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.1.1 - 2026-10-23

### Added

- Import bookmarks from other apps. Settings > Import bookmarks reads Curio's own CSV, CSV exports from Raindrop.io, Pocket, Instapaper and Diigo, any spreadsheet with a link or title column (comma, semicolon or tab separated), a plain list of links, the bookmarks file every browser exports (Netscape bookmark format, also produced by Raindrop.io, Pinboard, linkding, Karakeep and Pocket's older export), and Pinboard JSON. Titles, descriptions, notes, tags, folders (as tags) and dates are kept, and Raindrop.io covers are downloaded. Large files are imported in chunks with progress. A row now updates the reference with the same link, or the same title when it has no link, instead of matching by title only.
- Swipe right to pull out the sidebar on a phone or tablet, left to put it away. On the grid and vertical layouts the swipe works anywhere on the board; on the horizontal layout and the map it starts from the left edge.

### Changed

- New first-run welcome screen: larger, more spaced text over a faded picture of a Curio board, and a "Take the tour" button. The organize and share steps are merged into one.
- On phones the tour leaves out what needs a computer (dropping files onto the board, CSV export) and, inside the Android app, mentions sharing to Curio from other apps.

- First-run tour: swipe left or right to move between steps on touch screens. The last install step now says to sign in with your Nextcloud server address instead of showing the address.
- App Store description: shorter opening paragraph.

## 2.1.0 - 2026-10-23

### Added

- First-run tour. The first time each user opens Curio, a short tour shows how to add references, organize them with tags, boards and layouts, and share boards. Its last step offers Curio for Android: a QR code and a download link to the latest APK, with step-by-step instructions for allowing the install in Android's security settings and the server address to sign in with. The tour can be replayed from Settings, under Help, which also has a "Get the Android app" button.
- The map works without any API key: when no CARTO key is set, it uses OpenFreeMap vector basemaps (light and dark styles, OpenStreetMap data), rendered with MapLibre GL inside the existing Leaflet map. MapLibre is loaded only when the map layout is opened. A CARTO key set by an administrator is still used when present.

### Changed

- The map notice now appears only if the basemap fails to load, and points to the optional CARTO key.
- Translations completed for French, Spanish, German, Italian, Portuguese and Dutch, including the Curio folder picker and tag moves, which were still in English.

## 2.0.1 - 2026-10-23

### Changed

- New App Store description, with screenshots.
- GitHub releases now also carry the Curio for Android APK.
- Supports Nextcloud 35 (supported range now 31 to 35). Checked against the Nextcloud 35 critical changes (PHP 8.3 minimum, database wrapper, Symfony Console 7, removed front-end globals and back-end APIs); Curio uses none of the removed APIs, so only the supported range changed.

## 2.0.0 - 2026-10-23

### Added

- Curio for Android, a companion app kept in the `android/` folder of the repository (not part of this Nextcloud package). It opens your Curio boards full screen and adds references from the share menu of Instagram, Pinterest, TikTok, X, Reddit, YouTube or any app, replacing the web clipper on phones. It uses the `/api/clip/` endpoints and an app password created through Nextcloud's login flow.

### Fixed

- Map view: CARTO now requires an API key for its basemaps, and tiles requested without one carry an "API key required" watermark. Administrators can paste a free key from carto.com/basemaps/apikey in Curio's Settings (a new "Map tiles (CARTO API key)" field, shown to administrators only), or set it with `occ config:app:set curio carto_api_key --value=YOUR_KEY`. The key applies to every user on the server. Until a key is set, the map shows a notice pointing to Settings (or, for other users, asking them to contact their administrator).
- Map tiles now send the page origin as the referrer. Nextcloud pages send none by default, which made a CARTO key restricted to the Nextcloud domain refuse every tile.

## 1.0.5 - 2026-07-31

### Fixed

- App icon consistency with first-party apps. Restored `img/app-dark.svg` as a solid black version of the icon (removed in an earlier round). Verified against the Nextcloud 34 source and the Notes, Deck and Tasks apps: the primary `app.svg` is white and Nextcloud applies `filter: invert()` to it for the app menu and top bar (so white on a dark background, black on a bright one, exactly like every other app), while the black `app-dark.svg` is used in light-background contexts such as the Apps management list, update notifications and activity icons. Without it, Curio rendered inconsistently in those places. Both icon files are now genuinely solid with no `fill-opacity`.

## 1.0.4 - 2026-07-31

### Added

- Web clipper video upload. A new `POST /api/clip/upload-video` endpoint accepts video bytes the clipper fetched in the user's logged-in browser (an Instagram reel the server cannot download from a datacentre IP) and stores them as a local, playable file. A video reference whose `video.src` is an upload marker now materialises from that uploaded file, and the temporary upload copy is dropped once the file is written to the board folder. The reel's poster is uploaded separately (as the reference `img`) so the card still has a thumbnail.

## 1.0.3 - 2026-07-31

### Changed

- Sidebar boards now show the owner's initials circle instead of a plain colour dot, matching how shared boards are shown.
- On a reference card, the owner circle is now at the top-left and is hidden along with the other card chrome when titles and tags are turned off, so a labels-off grid is pure images.

### Added

- The share box now suggests matching Nextcloud users as you type, by name or username.
- Web clipper API. A new set of endpoints under `/api/clip/` lets the Curio Web Clipper browser extension (and any external client) add references from outside Nextcloud. The endpoints are `ping`, `state`, `fetch`, `geocode/detect`, `geocode/suggest`, `upload` and `reference`, each delegating to the same service logic the in-app add dialog uses, so a clipped reference is identical to one added inside the app. Authentication is a Nextcloud app password sent in the Authorization header; the endpoints are CSRF-exempt and CORS-enabled, which is safe because authentication is an explicit app-password token rather than an ambient session cookie, and all board-write permission checks run server-side, unchanged.

### Fixed

- Mobile: the source/URL pill is hidden on reference cards to reduce clutter (the owner circle remains).
- App logo: shipped as a single solid white `app.svg`, all four tiles at full opacity (an earlier build had two tiles at 50 percent opacity, which read as a faded, transparent logo), and removed the unused `app-dark.svg`. Nextcloud tints the top-bar icon itself, so the icon must be white; if it still looks wrong after updating, it is a cached copy of the old icon (see below).
- Instagram fetch: reverted the browser User-Agent tried in 1.0.2. Instagram serves its full preview data to crawler-style requests and an empty shell to browser-style ones, so the browser User-Agent returned less. This restores the previous behaviour.

## 1.0.2 - 2026-07-31

### Fixed

- App logo colour: `app.svg` is now white and `app-dark.svg` is black, matching Nextcloud's own convention (verified against first-party apps) where Nextcloud shows the base icon on the coloured top bar and the `-dark` variant on a light top bar. The two files were the wrong way round, so the logo was the opposite colour of every other app icon.
- Instagram imports on hosted Nextcloud servers: page and media fetches now send a real desktop-browser User-Agent instead of a bot-style one. Instagram serves a login wall or blocks bot-style requests, and does so far more aggressively from datacentre IPs than from home connections, which is why an import could work on a self-hosted box but fail on a cloud host. Fetch failures, including Instagram login walls, are logged so the cause is visible.

## 1.0.1 - 2026-07-30

### Changed

- Tags created from the add-reference dialog or a preview now go to Ungrouped instead of the first folder. Tags made from a folder's + button still land in that folder.
- In a tag field, Enter now accepts the highlighted suggestion instead of creating a new tag from the typed letters; a comma or semicolon commits the typed text as-is and starts the next tag.
- The board colour swatch in the sidebar is now clickable and opens the board editor, matching the tag swatches.
- App icons replaced.

### Added

- Drag a tag onto a folder in the sidebar to move it into that folder.
- Move a reference to another board from its preview: the board it belongs to is shown next to the owner, and clicking it opens a picker.
- Check off a note's checklist items straight from the preview, without opening the editor.

### Fixed

- The rename pencil now stays beside long reference titles instead of wrapping underneath.
- Mobile: dialogs no longer overlap the Nextcloud top bar or get cropped at the bottom of the screen.
- Mobile: reference titles and tag pills are smaller so cards are less crowded, and the multi-board heading no longer crowds out the layout controls.
- YouTube: the full video description is now imported instead of the truncated summary Nextcloud receives in the page's Open Graph tags.
- Link fetches that fail are now logged with the host and HTTP status, so a site that blocks the server (for example returning 403 or 429) is visible in nextcloud.log.

## 1.0.0 - 2026-07-29

First public release.

### Added

- Visual boards for images, web pages, videos, PDFs and text notes, with every reference stored as a real file in Nextcloud Files.
- Link fetching that pulls the image, title and a saved page snapshot from Pinterest, Instagram, YouTube and any website, with a chooser when a page offers more than one image.
- Direct upload of photos, videos and PDFs, plus plain text notes.
- Tags as native Nextcloud system tags, grouped into folders, with automatic matching of hashtags written in a title or note.
- Type and tag filters, search, and square, vertical-masonry and map layouts, with a jump index for long boards.
- Board sharing built on Nextcloud's own shares and permissions (view or edit), so collaborators' changes are attributed to them, plus per-reference comments.
- Location detection from captions and page metadata, written into image EXIF so it travels with the file.
- CSV export and import per board.
- First-run setup that lets you create a new folder or pick an existing one as the place Curio keeps its boards, with a re-prompt if that folder is later moved or removed.
- Interface translations for French, Spanish, German, Italian, Portuguese and Dutch, following the Nextcloud language and falling back to English.
