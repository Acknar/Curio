# Curio handoff

State of the Curio project (Nextcloud app + Android app) at the end of the session of 2026-10-23 (Curio 2.1.0, Curio for Android 1.2.0), and what comes next.

## Requests, as written

1. "Familiarize yourself with the project in the github. Can you also find within claude, the previous chat sessions used to develop this project? Here is also a zip of versions with a prototype of the webclipper. I'd like to make an .apk app of this project if it can replace the webclipper with an app able to gather the descriptions and titles from instagram, pinterest, and other social media plateforms effectively."
2. ""Turn on GitHub Actions in the repo" It was already on. I want the app to be the fully fledged curio experience, with the additionnal webclipping features and share menu. Make the additionnal UI match the curio UI. I also need to fix a problem with the map that now needs an API key now from https://carto.com/basemaps/apikey/ . Can you walk me through the process and what I need to fill in?"
3. CARTO key obtained (raster tile URL `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=...`, free limit 5,000,000 requests a month). The key itself is in the chat history, not in this repository.
4. "Can you do a Curio v1.0.5 release on github so I can add the curio-1.0.6.tar.gz on the nextcloud app store to update my nextcloud server" / "v1.0.6 release I meant" / "make it 2.0.0 release actually"
5. "The new version is on the app store but I have to wait for it to be picked up by my server. While I wait, can you help me add images to the app page on the app store, i can't find any way to edit the page"
6. "Ok, I will send them over for the next session. I also need you to make the next upload of the app compatible with Nextcloud 35"
7. "Here is the updated text for the app store : [the description now in `appinfo/info.xml`] The github readme can point to the app store: https://apps.nextcloud.com/apps/curio" / "How can I force my tabdigital server to update the app list to see there is a new version of curio availiable"
8. "[4 screenshots] Ok, It's updated now and the map shows up again. Here are the photos so you can do the next version. In the next you will be able to add the .apk right? For the map API key, is there a way for all people downloading my app to use my api key to benefit from it without risking it being maxed out by a single user, maybe with a user limit?"
9. "Ok, can you add an onboarding for the first start of the app to quickly show user around and offer to download the app and tell them how to open it (the security settings in android). Do a similar onboarding process on the app to explain the webclipper capabilities and show the social media setup so the user can set that up. Test the OpenFreeMap, show me the implementation with light and dark mode. If it doesn't work, we'll need the onboarding to also help new users understand how to get an API key to have the map"
10. "I'd also like you to rework the android app icon to have the same background as the other apps, take the specific blue from nextcloud and remove the transparency"

11. "Remove step 5's "sign in with this address : [...]" to have instead " sign in with your nextcloud server address" Make onboarding screen compatible with swiping gestures. * The first screen onbaording screen is pretty useless. Have a more welcoming first screen that explains the main point of the app ("Curio turns the images, links, videos and notes you collect into visual boards you can filter, tag and share. Paste a link from Pinterest, Instagram, YouTube or any website and it pulls in the picture, title and a snapshot for you. Upload your own photos, drop in a PDF, or jot a quick note. " * Second screen is good. Show me third screen? * Signing in to social media screen can specify nothing is shared to those apps, and no data is taken beyond the post itself to become a reference board. Remove "Everything lands on a board as a tidy, browsable tile" from the description text in the webapp"

Done in 2.1.1 / Android 1.2.1: web tour install step 5 wording, swipe between steps in the web tour (`tourTouchStart/End` in `src/App.vue`) and the Android introduction (`intro.js`), new Android welcome screen with the user's text, privacy note on the sign-in screen and in App settings, sentence removed from the App Store description in `appinfo/info.xml`.

12. "[screenshot of a Curio board] Intro screen needs to be more lively, text can be bigger, more spaced, maybe use the background image, faded out and make sure text is legible on top. It has to feel more welcoming, you can do several versions with and without the image to test. Show me the second screen, what is it? third and fourth screens can be merge What is the last screen on the phone? since there isn't the curio on your phone" / "don't publish for each change I ask, this will be v2.1.1 once everything is good"
13. "[cropped board screenshot] A version with the fade but try with this cropped image. Phone version of the onboarding should not mention actions that can only be performed on the computer like : "drop images and links straight onto the board" Can you add swipe gestures to pull out the side panel and hide it? Can you work on the CSV and see if there are some common bookmarking apps and tools that use CSV and if they can be easily converted over. Is there a convention for bookmarks in CSV format?"

Status after 13 (not released; v2.1.1 on GitHub is an older build and must be deleted with its tag, then the release workflow re-run, once the user approves): welcome screen with `img/tour-welcome.webp` (the user's cropped board) faded behind larger text; organize and share steps merged; phone wording (`isPhone`, `inAndroidApp` in `src/App.vue`); sidebar swipe (`navTouchStart/End`); bookmark import parsed in the browser by `src/bookmarks.js` (tests: `node --test tests/unit/bookmarks.test.mjs`, needs `android/tests` node_modules for jsdom), sent in chunks of 25 rows to `POST /api/boards/{id}/import` as `{rows, first}` and stored by `CurioService::importRows`. Open questions to the user: apply the welcome design to the Android introduction's first screen; skip the tour's welcome screen inside the Android app.

## Done in 2.1.0 / Android 1.2.0 (requests 9 and 10)

- OpenFreeMap: with no CARTO key, the map uses OpenFreeMap vector styles (`https://tiles.openfreemap.org/styles/positron` and `/dark`) through MapLibre GL 6 inside Leaflet (`@maplibre/maplibre-gl-leaflet`), lazy-loaded as `js/curio-maplibre.js` plus the worker `js/curio-maplibre-worker.js` (copied by `npm run build`). CSP in `PageController` allows `tiles.openfreemap.org`, workers from self and blob. Verified on GitHub runners by `.github/workflows/preview.yml` (renders the map in light and dark at world and city zoom with Playwright, every request 200, force-pushes the PNGs and `report.json` to branch `previews`). It works, so no API key step was added to the onboarding; the CARTO key stays optional and the map notice only shows if the basemap fails to load.
- Curio first-run tour (`src/App.vue`, per-user flag `curio`/`onboarding_done`, `PUT /api/onboarding`): welcome, adding references, organizing, sharing, and Curio for Android (QR code, download link `https://github.com/Acknar/Curio/releases/latest/download/curio-android.apk`, install steps covering "Allow from this source" and Play Protect, server address). Not shown inside the Android app's WebView for the app step. Replay from Settings > Help.
- `android.yml` attaches the APK to each release a second time as `curio-android.apk`, which the tour link needs. Releases up to 2.0.1 do not have it; 2.1.0 is the first.
- Android introduction (`IntroActivity`, `assets/ui/intro.html/.js`, config flag `introDone`): share menu use and pinning, what is read per platform, site sign-ins with live status (`sites.js`, shared with App settings), default board. Opens over Curio on first start after connecting (also for users upgrading from 1.1.0). Replay from App settings > Help. `share_label` translated in `res/values-xx`.
- App icon: Nextcloud blue gradient background (`#0082C9` to `#30B6FF`), solid white mark, no transparency.
- All Curio strings translated in the 6 languages, including the folder picker strings that were still English.
- Tests: `android/tests` 31 passing (new `intro.test.js`). Not yet tested on a phone.

## Next steps

### 1. Screenshots on the App Store page (done in 2.0.1)

The user's four screenshots are in `screenshots/` (JPG plus 800 px thumbnails) and referenced from `appinfo/info.xml` via the `v2.0.1` tag. The plan below is what was followed; reuse it for future screenshot changes.

The App Store page has no editor: it is built from `appinfo/info.xml` of each uploaded release. Images are `<screenshot>` elements with HTTPS URLs, placed after `<repository>` and before `<dependencies>` (confirmed against the App Store schema). An optional `small-thumbnail` attribute gives a smaller image.

Plan once the user uploads 3 to 5 screenshots:

1. Crop/resize them to a consistent size (full desktop width, about 1600 px wide or more; PNG or JPG, keep each under about 1 MB) and make thumbnails (about 800 px wide).
2. Add them to a `screenshots/` folder at the repository root (not packaged: the release archive is built from an explicit file list).
3. In `appinfo/info.xml`, add one element per image, pointing at the tag of the coming release so the URLs never change:
   ```xml
   <screenshot small-thumbnail="https://raw.githubusercontent.com/Acknar/Curio/v2.0.1/screenshots/board-small.png">https://raw.githubusercontent.com/Acknar/Curio/v2.0.1/screenshots/board.png</screenshot>
   ```
4. Bump `appinfo/info.xml` `<version>` to 2.0.1, `package.json` and `package-lock.json` (lines 3 and 9) to 2.0.1, `lib/Controller/ClipController.php` ping `'version'` to `'2.0.1'`. In `CHANGELOG.md` rename `## Unreleased` to `## 2.0.1 - <date>` and add a line about the screenshots.
5. Validate: `xmllint --noout --schema info.xsd appinfo/info.xml` (schema: `https://raw.githubusercontent.com/nextcloud/appstore/master/nextcloudappstore/api/v1/release/info.xsd`).
6. Commit and push the branch. The release workflow creates tag `v2.0.1` and the release with `curio-2.0.1.tar.gz` (see Release process). Check the raw.githubusercontent.com screenshot URLs answer 200 once the tag exists.
7. The user uploads 2.0.1 to the App Store (steps below).

Suggested shots: a board in vertical masonry layout with tags shown; the map layout with the CARTO key set (no watermark); the Add reference dialog with a fetched Instagram or Pinterest post; the detail view of a reference; optionally the Android share dialog. Nothing personal should be visible: the images are public.

Also ships with 2.0.1: the new App Store description (user's text, in `appinfo/info.xml` `<description>`, laid out in Markdown) and a README link to https://apps.nextcloud.com/apps/curio.

### 2. Nextcloud 35 compatibility (done, ships with the next release)

`appinfo/info.xml` now says `<nextcloud min-version="31" max-version="35"/>`, recorded under `## Unreleased` in `CHANGELOG.md`. The version was not bumped, so no release was made; 2.0.1 carries it.

Audit against the Nextcloud 35 critical changes (`nextcloud/documentation`, branch `stable35`, `developer_manual/release_notes/critical_changes.rst`):

- PHP 8.3 minimum: all PHP files lint clean on 8.3; no implicitly nullable parameters (PHP 8.4 deprecation).
- Doctrine DBAL wrapper (`Type::lookupName`, `Column->setOptions`, `Column->setType`): not used. The `setType` calls in `CurioService` are on Curio's own `Reference` entity.
- Symfony Console 7: Curio has no console commands.
- phpseclib 3, Remote API, `IPreview::registerProvider`, calendar resource managers, `AutoCompleteEvent`, `IRootFolder` emitter hooks: not used.
- Removed front-end globals (`oc_*`, `OCDialogs`, underscore, Clipboard, dav, moment) and the Nextcloud 34 removals (jQuery, Backbone, Handlebars): not used. The frontend uses `@nextcloud/axios` and `@nextcloud/router`, plus `OC.getCanonicalLocale`, `OC.getLocale`, `OC.generateUrl`, `window.t` and `OCA.Text.createEditor`, all still present in Nextcloud 35 (checked in `nextcloud/server` `stable35`) and all with fallbacks.
- Still used but deprecated (present in 35, no removal announced): `IConfig::getAppValue/setAppValue/deleteAppValue` (deprecated 29, use `IAppConfig`) and `IConfig::getUserValue/setUserValue` (deprecated 33, use `IUserConfig`). Worth migrating in a later release; `IUserConfig` may not exist on Nextcloud 31, so that migration may need min-version raised.

Not tested on a real Nextcloud 35 server.

## Current state

Branch `claude/exciting-volta-o8u9im` holds all work. `main` is still at the original 1.0.0 commit; merging the branch into `main` has not been done (ask the user first).

### Nextcloud app

- `Curio 1.0.5` commit: the released 1.0.5 source imported from the user's zip (the repository was at 1.0.0).
- 2.0.0 (released): CARTO API key for the map. Admin-only field in Curio Settings ("Map tiles (CARTO API key)", route `PUT /api/map-key`, app config `curio/carto_api_key`, also settable with `occ config:app:set curio carto_api_key --value=KEY`). Tiles use `https://{s}.basemaps.cartocdn.com/{light_all|dark_all}/{z}/{x}/{y}{r}.png?key=KEY` with `referrerPolicy: 'strict-origin-when-cross-origin'`, so a domain-restricted key works despite Nextcloud's no-referrer policy (verified in Chromium with a no-referrer page). A notice shows on the map until a key is set. Translations for fr, es, de, it, pt, nl. `package-lock.json` added (taken from the refboard prototype, same dependencies) so `npm ci && npm run build` is reproducible. Not tested against real CARTO tiles (blocked from the build environment).
- GitHub release: https://github.com/Acknar/Curio/releases/tag/v2.0.0 with `curio-2.0.0.tar.gz`. The user uploaded it to the App Store and was waiting for their server to pick it up.
- After the server updates: paste the CARTO key in Curio Settings; optionally restrict the key to the Nextcloud host in the CARTO dashboard (host only, exact match, list www and other hosts separately).

### Android app (`android/`, version 1.2.0; 1.1.0 described below)

- Opens Curio from the user's Nextcloud full screen (MainActivity WebView, first request with HTTP Basic auth using the app password). `assets/ui/inject/curio-page.js` hides the Nextcloud top bar on the Curio page, adds "App settings" under Curio's Settings in the sidebar, reports theme/colours/language, handles back (closes dialogs, detail view, sidebar) and refreshes after a clip.
- Share target ("Add to Curio"): Curio's own Add reference dialog (`assets/ui/clip.html/.js`) styled with Curio's `src/styles.css` and translated with Curio's `l10n/*.json`, both copied into the APK at build time (Gradle task `copyCurioWeb`). App-only strings in `assets/ui/app-l10n.js` (fr, es, de formal, it, pt, nl).
- On-device extraction (`assets/ui/extract.js`): Instagram (web API with in-app sign-in, public embed, crawler page), Pinterest (widget API, page JSON), TikTok (oEmbed, page data), X (syndication), Reddit (JSON), YouTube/Vimeo (oEmbed), Facebook/Threads (crawler og tags), any page (og/JSON-LD), hidden WebView render fallback running the web clipper's `page-extractors.js`.
- Connection: Nextcloud Login Flow v2 or manual app password (`assets/ui/connect.html`). App settings (`assets/ui/settings.html`): default board for the share menu, site sign-ins, disconnect.
- Tests: `cd android/tests && npm install && npm test` (29 tests: extractors on fixtures, the real share dialog end to end in jsdom, Login Flow v2, translation coverage).
- CI: `.github/workflows/android.yml` builds the APK on pushes touching `android/`, `src/styles.css` or `l10n/`, checks the APK contains Curio's assets, uploads artifact `curio-android-apk`. Signing uses a CI key kept in the Actions cache (`curio-ci-keystore-v1`) unless `CURIO_KEYSTORE_*` secrets are set; an evicted cache means a new key and one uninstall.
- Not yet tested on a phone or against live Instagram/Pinterest. Unverified on a real server: the CSS that hides the Nextcloud 31 to 35 top bar, and Nextcloud accepting the Basic-auth first request to open a session (fallback: signing in once inside the app).

## Release process

Releases also carry the Curio for Android APK: `release.yml` calls `android.yml` (a reusable workflow, input `release_tag`), which builds the APK with the cached CI key and attaches it to the same release. Release v2.0.1 (screenshots, new description, Nextcloud 35) is published with `curio-2.0.1.tar.gz` and `curio-android-1.1.0-release.apk`. From v2.1.0 the APK is also attached as `curio-android.apk`.

`.github/workflows/release.yml` runs when a push changes `appinfo/info.xml` (or the workflow), or when a `v*` tag is pushed. It reads the version from `info.xml`, validates `info.xml` against the App Store schema, skips if release `v<version>` already exists, otherwise builds `curio-<version>.tar.gz` (top folder `curio/`: appinfo, img, js, l10n, lib, templates, src, CHANGELOG.md, COPYING, README.md, package.json, package-lock.json, webpack.config.js), creates tag `v<version>` on the pushed commit and publishes the release with the matching `CHANGELOG.md` section as notes.

App Store upload (done by the user):

```
curl -L -o curio-X.Y.Z.tar.gz https://github.com/Acknar/Curio/releases/download/vX.Y.Z/curio-X.Y.Z.tar.gz
openssl dgst -sha512 -sign ~/.nextcloud/certificates/curio.key curio-X.Y.Z.tar.gz | openssl base64
```

Then apps.nextcloud.com > Upload app release: the release download URL and the signature, Nightly unticked.

## Environment limits seen in the cloud session

- Only the session branch can be pushed; tag pushes are refused (HTTP 403). Releases therefore go through the release workflow.
- Blocked hosts: dl.google.com (Android SDK, so APKs are built only in GitHub Actions), GitHub artifact/blob storage (the APK cannot be downloaded into the session), docs.nextcloud.com, carto.com and basemaps.cartocdn.com, instagram.com, pinterest.com, photo sites. Reachable: github.com API, raw.githubusercontent.com, registry.npmjs.org, Maven Central, Gradle plugin portal.
- Nextcloud developer docs can be read from `https://raw.githubusercontent.com/nextcloud/documentation/stable35/developer_manual/...`.
- Java can be typechecked locally against `org.robolectric:android-all` from Maven Central: `javac -cp android-all.jar --release 17 android/app/src/main/java/com/acknar/curio/*.java`.
- The Curio frontend can be exercised in Chromium (Playwright at `/opt/node-tools/node_modules/playwright`) by serving a fake Nextcloud page that loads `js/curio-main.js` and mocks `/index.php/apps/curio/api/*`.

## Previous chat sessions

No earlier Claude Code session in the account is about Curio (the listed sessions are a city-building game project). Curio was developed in claude.ai chats or a claude.ai Project (the prototype README mentions a "Bookmark References" project), which are not readable from a Claude Code session.
