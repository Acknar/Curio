# Changelog

All notable changes to Curio for Android are documented here. The project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.2 - 2026-10-25

### Fixed

- Instagram, when a post is read from the rendered page (the last fallback): only the video belonging to that post is taken, never the first video found on the page, and the post is the one in the page's address.

## 1.2.1 - 2026-10-23

### Changed

- Introduction: swipe left or right to move between screens. New first screen explaining what Curio does, with larger text over a faded picture of a Curio board. "What Curio reads" and the site sign-ins are one screen: each platform shows what is read and, for Instagram, Pinterest, TikTok, Facebook and X, its sign-in status and button. It states that nothing is posted or shared to those sites and that only the shared post is read (also in App settings).
- Platform logos in their brand colours on the introduction's "What Curio reads" screen and in App settings' site sign-ins (icons from Simple Icons, CC0).
- Only one welcome screen: Curio's own tour, shown inside the app after the introduction, now starts at "Add references".

## 1.2.0 - 2026-10-23

### Added

- Introduction on first start, after connecting: how to add references from the share menu of any app (and pin "Add to Curio" there), what is read on Instagram, Pinterest, TikTok, YouTube, X, Reddit and other sites, signing in to Instagram, Facebook, Pinterest, TikTok and X with live sign-in status, and the default board for the share menu. It can be replayed from App settings, under Help.
- "Add to Curio" in the share menu is translated in French, Spanish, German, Italian, Portuguese and Dutch.

### Changed

- New app icon in the style of Nextcloud's own apps: Nextcloud blue gradient background and a solid white Curio mark, with no transparency.

## 1.1.0 - 2026-10-23

### Added

- The app opens straight into Curio from your Nextcloud, full screen, with Nextcloud's top bar hidden. Back closes Curio's dialogs and sidebar first. "App settings" sits under Curio's own Settings in the sidebar.
- The share dialog, connection screen and app settings now use Curio's own stylesheet, icons and translations, and follow the theme, accent colour and language of your Curio. App-only strings are translated in French, Spanish, German, Italian, Portuguese and Dutch.
- Curio refreshes after something is added from the share menu.
- Offline screen with Retry when the server cannot be reached; a page that lands on the Nextcloud login after the session expires signs in again with the app password.

### Changed

- "Disconnect" now ends only the Nextcloud session on the phone and keeps site sign-ins.

## 1.0.0 - 2026-10-23

First version: share target replacing the Curio Web Clipper, with on-device extraction for Instagram, Pinterest, TikTok, X, Reddit, YouTube, Vimeo, Facebook, Threads and any web page; Nextcloud Login Flow v2; boards viewer.
