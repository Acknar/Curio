# Curio for Android

Curio on your phone. The app opens your Curio boards from your Nextcloud, full
screen, with everything Curio does there (boards, tags, filters, layouts, map,
sharing, comments). On top of that it replaces the Curio Web Clipper: share a
post from Instagram, Pinterest, TikTok, X, Reddit, YouTube or any browser to
**Add reference** and it opens Curio's own add dialog, pre-filled with the title,
description, place and tags read from the post.

Requires the Curio Nextcloud app 1.0.4 or later on the server (the `/api/clip/`
endpoints, including `upload-video`). 1.0.6 adds the map tiles key.

## What it does

- **The full Curio app.** Curio from your server, with Nextcloud's top bar hidden
  so it reads as an app. Back closes Curio's dialogs and sidebar first. An **App
  settings** entry sits under Curio's own Settings in the sidebar.
- **Share target.** Links, photos, videos and PDFs shared from any app open
  Curio's "Add reference" dialog over the app you came from. Selected text can be
  saved as a note from the text selection menu.
- **Looks and reads like Curio.** The app's own screens (share dialog,
  connection, app settings) use Curio's stylesheet and Curio's translations,
  copied from this repository at build time, and follow the theme, accent colour
  and language of your Curio. Strings only the app uses are translated in the same
  six languages.
- **Reads posts on the phone.** Titles, captions and images are fetched from the
  phone's own connection, which social sites do not block the way they block a
  datacentre-hosted Nextcloud. The Curio server's own fetch still runs and fills
  any gaps, exactly like the in-app add dialog.
- **Same result as the web clipper.** Caption cleanup (engagement counts, quotes,
  @mentions, emoji, headline + description split), hashtag to tag matching and
  location detection are the web clipper's own code.
- **Site sign-ins.** Optionally sign in to Instagram, Facebook, Pinterest, TikTok
  or X in App settings, on the site's own page. The share menu then reads posts
  the way you see them: private accounts, full carousels, reels as video files.
  Curio never sees those passwords.

## Where the data comes from

Each platform has a chain of sources, tried in order; the first one that yields a
caption wins and the rest only fill gaps. If every plain request comes back
empty, the page is rendered in a hidden WebView (with your site sign-ins) and
the web clipper's page extractor reads the live page.

| Platform | Sources, in order |
| --- | --- |
| Instagram | Instagram web API (when signed in: caption, all carousel images, reel video file, tagged location with coordinates), public embed page (caption, uncropped images, carousel), crawler page (og:description), rendered page |
| Pinterest | Pinterest widget API (title, description, original-size image), pin page bootstrap data, og tags |
| TikTok | oEmbed (caption, cover), video page data (full caption, cover, photo-post images, tagged place) |
| X / Twitter | Twitter embed (syndication) endpoint (text, all photos, video file), oEmbed |
| Reddit | Post JSON (title, text, image or gallery) |
| YouTube | oEmbed (title, thumbnail), watch page (full description); embeds as video |
| Vimeo | oEmbed |
| Facebook, Threads | Crawler page (og tags) |
| Any website | og / Twitter card / JSON-LD metadata, then the Curio server's fetch |

Short links (pin.it, vm.tiktok.com, t.co, reddit.com/s/..., fb.watch...) are
resolved first, and share-tracking parameters (igsh, utm_*, si, s/t on X...) are
removed from the saved source URL.

A place tagged on the post (Instagram location, TikTok place, X place) is passed
to Curio's location detection as a hint; an Instagram location with coordinates
is used directly.

## Setup

1. Install the APK (see Build). Android asks to allow installs from the app you
   open it with (Files, browser) the first time.
2. Open Curio, enter your Nextcloud address and tap **Sign in with Nextcloud**.
   Sign in on your server's page and grant access. Nextcloud creates an app
   password named "Curio for Android (device)" that you can revoke under
   Security > Devices & sessions. Entering an app password by hand also works.
3. Optional: sidebar > App settings > Site sign-ins > Instagram.
4. In any app, Share > Add to Curio. Long-press it in the share menu to pin it.

## Build

The APK is built by GitHub Actions (`.github/workflows/android.yml`) on every
push that touches `android/`. Download it from the run's **Artifacts**
(`curio-android-apk`). Pushing a tag named `android-v1.0.0` also publishes it as
a GitHub release.

Locally, with the Android SDK installed (Android Studio, or the command-line
tools with platform 35):

```
cd android
./gradlew assembleRelease
```

The APK is written to `app/build/outputs/apk/release/`.

### Signing

Without signing secrets, CI signs the APK with a key it keeps in the Actions
cache, so a new build installs over the previous one. GitHub drops caches unused
for 7 days, after which a new key is made and the app must be uninstalled once
before the next update. For a permanent key, create one once:

```
keytool -genkeypair -v -keystore curio.keystore -alias curio -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 curio.keystore
```

and add these repository secrets (Settings > Secrets and variables > Actions):
`CURIO_KEYSTORE_BASE64` (the base64 output), `CURIO_KEYSTORE_PASSWORD`,
`CURIO_KEY_ALIAS` (`curio`), `CURIO_KEY_PASSWORD`. Switching keys requires
uninstalling the debug-signed app once.

## Tests

```
cd android/tests
npm install
npm test
```

The tests load the app's scripts with jsdom: extractor unit tests against
fixture pages and API responses for each platform, end-to-end runs of the real
share sheet with a fake Android bridge and a fake Curio server (asserting the
reference payload that gets posted), and the Nextcloud Login Flow v2.

## Layout

- `app/src/main/java/com/acknar/curio/`
  - `MainActivity` - Curio from the server, full screen, with a minimal page bridge.
  - `ShareActivity` - share target; turns the intent into a payload for the dialog.
  - `ConnectActivity`, `SettingsActivity` - first-run connection and app settings.
  - `SiteLoginActivity` - in-app sign-in to a social site.
  - `WebShellActivity`, `NativeBridge` - WebView host and the JavaScript bridge.
  - `Http` - native HTTP (no CORS, custom User-Agent, site cookies, multipart upload from a URL or a shared file).
  - `Renderer` - hidden WebView that runs the page extractor on a live page.
- `app/src/main/assets/ui/`
  - `clip.html/.js` - the share dialog (Curio's Add reference dialog).
  - `connect.html/.js` - connection (Nextcloud Login Flow v2 or app password).
  - `settings.html/.js` - app settings.
  - `inject/curio-page.js` - injected into the Curio page: hides Nextcloud's top bar, adds App settings, reports theme and language, back handling.
  - `look.js`, `app.css`, `app-l10n.js` - Curio's theme, icons and translations for the app's screens.
- `../src/styles.css`, `../l10n/*.json` - copied into the APK at build time (Gradle task `copyCurioWeb`).
  - `extract.js` - per-platform extraction chains.
  - `curio.js` - Curio clip API client (port of the web clipper's common.js).
  - `taglogic.js`, `cleanup.js`, `page-extractors.js` - from the web clipper 1.1.0, unchanged.
  - `native.js` - promise wrapper around the bridge.
