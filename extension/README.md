# Curio Web Clipper

Clip posts, images, videos, PDFs, text and pages from Instagram, Pinterest,
TikTok, X, Reddit, YouTube or any website to a Curio board in your Nextcloud,
from Firefox, Chrome, Edge, Brave or Opera.

The clipper reads the page in your browser as you see it, signed in, so it gets
what the Nextcloud server cannot fetch on its own (Instagram blocks server-side
requests from datacentre addresses). It opens Curio's own Add reference dialog,
pre-filled with the picture, title, description, place and tags.

Requires the Curio Nextcloud app 1.0.4 or later on the server (the `/api/clip/`
endpoints).

## Ways to clip

- **Toolbar button:** clips the page you are on.
- **Right-click menu:** Clip to Curio on an image, a video, a link, selected text
  or the page. A right-clicked image is the image imported; a right-clicked link
  is read like a link shared from a phone; selected text becomes a note.
- **Click hotkey:** Ctrl+click (or Alt, Shift, Cmd) on an image, a video, a PDF
  link or selected text. Set in the clipper's settings, or turned off.
- **Keyboard shortcut:** Alt+Shift+C clips the page. Change it in
  `about:addons` > gear > Manage Extension Shortcuts (Firefox) or
  `chrome://extensions/shortcuts` (Chrome, Edge, Brave).

## Where the data comes from

| Clip | Sources |
| --- | --- |
| Instagram, Pinterest, TikTok, X, Reddit, YouTube, Vimeo, Facebook, Threads | Curio for Android's extraction chain (Instagram's web API with the browser's sign-in, Pinterest's widget API, TikTok page data, X's embed endpoint, Reddit JSON, oEmbed...), then the page as read in the tab fills what is missing, then Curio's server fetch |
| Any other website | The page as read in the tab (og, Twitter card, JSON-LD, the images on the page), then Curio's server fetch |
| A link to another page | Read like a link shared on a phone |
| An image | That image, downloaded in the browser and uploaded to Curio |
| Selected text | A note, with the page as its source |

Images and reel videos are downloaded by the browser and uploaded to Curio, so
media behind a sign-in or blocked from servers still lands on the board.

## Setup

1. Install the clipper (below).
2. Its settings page opens. Enter your Nextcloud address and click **Sign in
   with Nextcloud**: sign in on your server's page and grant access. Nextcloud
   creates an app password named "Curio Web Clipper (browser on system)", listed
   and revocable under Security > Devices & sessions. Entering an app password by
   hand also works.
3. Pin the Curio button: open the extensions menu (the puzzle piece) and pin
   Curio Web Clipper.

Settings: default board, click hotkey, disconnect. Open them from the clipper's
entry in the browser's extensions page, or from the clip window when a sign-in
is refused.

Users of web clipper 1.1.0 keep their connection and settings.

## Install

### Firefox

Every Curio release on GitHub carries `curio-webclipper-firefox.xpi`, signed by
Mozilla (self-distributed, not listed on addons.mozilla.org). Click it in
Firefox and click Add when Firefox asks; if Firefox only downloads it, open it
from the downloads button in the toolbar (or drag it onto a Firefox window).
Curio's tour links to it (Settings > Help > Get the browser clipper).

The `.xpi` is only there when the repository has the AMO API secrets (see
Publishing). Without them, a release carries the unsigned
`curio-webclipper-firefox.zip`, which Firefox only loads temporarily
(`about:debugging#/runtime/this-firefox` > Load Temporary Add-on > the zip).

### Chrome, Edge, Brave, Opera

Until the clipper is on the Chrome Web Store:

1. Download `curio-webclipper-chrome.zip` from the latest release and unzip it
   into a folder you keep.
2. Open `chrome://extensions` (`edge://extensions`, `brave://extensions`,
   `opera://extensions`), turn on Developer mode and click **Load unpacked**.
3. Choose the unzipped folder.

Chrome does not update a loaded folder by itself: unzip a newer version over it
and click the reload arrow on the clipper's card.

## Publishing

### Firefox: signed .xpi on every release

1. Sign in at https://addons.mozilla.org/developers/ with the Firefox account
   that owns the add-on id `curio-webclipper@acknar.curio` (the one that signed
   earlier versions, if any).
2. Tools > Manage API Keys (https://addons.mozilla.org/developers/addon/api/key/)
   > Generate new credentials. Copy the JWT issuer and the JWT secret.
3. In GitHub, Acknar/Curio > Settings > Secrets and variables > Actions > New
   repository secret: `AMO_JWT_ISSUER` (the issuer) and `AMO_JWT_SECRET` (the
   secret).

The release workflow then signs the clipper for self-distribution
(`web-ext sign --channel=unlisted`) and attaches the `.xpi`. Mozilla signs each
version once: a later Curio release with the same clipper version reuses the
`.xpi` from the earlier release, so bump the version in `src/manifest.json` (and
`package.json`) whenever the clipper changes.

To list it publicly on addons.mozilla.org instead (searchable, automatic
updates), submit the same zip in the Developer Hub choosing "On this site". A
listed add-on is reviewed, and the broad site access may draw a question: it is
there to read the page you clip and to reach your own Nextcloud.

### Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (one-time 5 USD fee).
2. New item > upload `curio-webclipper-<version>-chrome.zip` from a release.
3. Fill in the listing: description, the 128 px icon (`src/icons/icon-128.png`),
   at least one 1280x800 screenshot, category Productivity. Privacy practices:
   single purpose "save the page or post the user clips to their own Nextcloud";
   host permission justification "reads the page the user clips and sends it to
   the Nextcloud server they configured"; no data collected or sold.
4. Submit for review. Once published, set `CLIPPER_CHROME_STORE_URL` in
   `src/App.vue` (Curio's tour then shows Add to Chrome instead of the unpacked
   steps). Edge users can install from the Chrome Web Store too.

## Build and tests

```
cd extension
npm install
npm test              # builds dist/chrome, then the tests
node build.mjs        # dist/firefox, dist/chrome and both zips
```

The GitHub workflow `.github/workflows/extension.yml` does the same on every
push that touches the clipper or the files it shares, runs Mozilla's linter
(`web-ext lint`) and uploads both packages as the artifact `curio-webclipper`.
`release.yml` calls it to attach the packages to each Curio release.

The tests load the built pages in jsdom with a fake `browser` API and a fake
network: the clip window end to end for a website, an image, a selection, a link,
Instagram with and without the API, translations; the settings page's Login Flow
v2 and settings.

## How it is built

The clipper is Curio for Android's share dialog running in the browser. The
Android app's screens talk to a JavaScript bridge (`window.Android`);
`src/ui/bridge.js` is the browser's version of that bridge:

- config in `browser.storage.local`;
- HTTP through `fetch` from the extension page (host permissions lift CORS),
  with a `declarativeNetRequest` session rule adding the headers `fetch` cannot
  set (User-Agent, Referer) to that one request;
- the app's hidden-WebView render is replaced by the page read in the tab by
  `page-extractors.js`, the extractor both share;
- Curio's translations are read up front, because the app reads them
  synchronously. `src/ui/boot.js` loads the app's scripts once that is done.

`src/ui/clip-ext.js` adapts the dialog to the browser: it merges what the tab
showed with the Android extraction chain, and words the few phone-specific
messages for the clipper.

`build.mjs` copies, unchanged, from `android/app/src/main/assets/ui/`:
`clip.html` (scripts rewired to boot.js), `clip.js`, `extract.js`,
`page-extractors.js`, `curio.js`, `taglogic.js`, `cleanup.js`, `look.js`,
`native.js`, `app-l10n.js`, `app.css`; and Curio's `src/styles.css` and
`l10n/*.json`. A fix to any of them reaches the app and the clipper together.

## Files

- `src/manifest.json` - one manifest; `build.mjs` keeps the Firefox keys
  (`background.scripts`, `browser_specific_settings`, `theme_icons`) or the
  Chrome ones (`background.service_worker`, `minimum_chrome_version`).
- `src/background.js` - toolbar button, right-click menu, keyboard shortcut,
  hotkey routing, the clip window.
- `src/content.js` - the click hotkey and reading the page (with
  `ui/page-extractors.js`).
- `src/ui/bridge.js`, `src/ui/boot.js` - the browser bridge and script loader.
- `src/ui/clip-ext.js`, `src/ui/ext.css` - the clip window's browser additions.
- `src/ui/options.html/.js` - settings: connection (Login Flow v2 or app
  password), default board, click hotkey, how to clip.
- `src/ui/ext-l10n.js` - the clipper's own strings in fr, es, de, it, pt, nl.
- `src/_locales/` - name, description and menu label for the browser and stores.
- `src/icons/` - toolbar icons (blue for light toolbars, white for dark) and the
  app icon in Nextcloud blue.

## Security

- The clipper talks to the one Nextcloud server you connect, with the app
  password in the Authorization header and no cookies.
- Curio's clip endpoints are CSRF-exempt and CORS-enabled, which is safe because
  authentication is an explicit app password, not an ambient session cookie. All
  of Curio's board permission checks run on the server.
- Site requests (Instagram, Pinterest...) carry the browser's own cookies for
  that site and go only to that site. Nothing is posted there.
- Nothing is stored outside the browser's extension storage, and nothing is sent
  to any third party.

## Licence

AGPL-3.0-or-later, like Curio. `browser-polyfill.min.js` is Mozilla's
webextension-polyfill (MPL-2.0), taken from npm at build time.
