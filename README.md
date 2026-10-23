# Curio

A Nextcloud app for curating images, links, videos, PDFs and text notes into
visual boards, right inside Nextcloud.

Paste a link and Curio pulls in the picture, title and a saved snapshot. Upload
your own photos, drop in a PDF, or jot a note. Everything lands on a board as a
browsable tile. Organise boards with colored tags and folders, filter by type or
tag, and switch between square, vertical-masonry and map layouts. Share a board
with others using Nextcloud's own sharing and permissions.

Every reference is stored as a real file in your Nextcloud Files, in a folder you
choose on first launch. Drop a file into that folder and it appears on the board;
rename or remove it and the board follows.

## Requirements

- Nextcloud 31 to 34
- PHP 8.1+
- `imagick` recommended for PDF page previews

## Install

Install from the Nextcloud App Store, or place this folder at
`custom_apps/curio` (or `apps/curio`) and enable it:

```
occ app:enable curio
```

## Build

The frontend bundle in `js/` is prebuilt. To rebuild it after changing `src/`:

```
npm install
npm run build
```

## License

Curio is licensed under the GNU Affero General Public License v3.0 or later.
See [COPYING](COPYING).
