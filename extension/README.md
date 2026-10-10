# Constellation browser extension (Team A)

One click captures the page you are on (cleaned HTML plus a screenshot) and sends it to `POST /api/ingest/capture`.

## Run it

```sh
cd extension
npm install
npm run build        # or: npm run watch
npm run mock         # fake backend on http://localhost:3000 until Team C is up
```

1. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `extension/dist`.
2. Open the extension's options page and set your user id. The backend URL defaults to `http://localhost:3000`.
3. Go to any page and click the extension icon, then "Capture this page".

The mock server saves the last capture to `mock/out/`. Open `last-capture.jpg` and `last-capture.html` there to see what was sent.

## What gets sent

Matches spec section 1.3:

```ts
{ userId, url, title, html, screenshotB64, redactions?: { x, y, w, h }[] }
```

- `html`: the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed. Only meaningful attributes are kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG at quality 70 with no `data:` prefix. If it is over 2MB, it is scaled down until it fits.
- `redactions`: empty unless the user used "Hide something". In that case the screenshot already has black boxes painted over those areas. The rects are in screenshot pixels.

## Layout

```
src/background.ts   service worker: takes the screenshot, reads the page, posts to the backend
src/content.ts      readPage(), injected into the tab
src/popup.ts        the button, status text, and the "Hide something" drawing flow
src/options.ts      user id and backend URL (chrome.storage.sync)
static/             manifest, html, css (copied into dist/)
mock/server.mjs     stand-in backend for /api/ingest/capture
```

The upload happens in the service worker, so it still finishes if the popup closes. The popup gives up after 20 seconds.

## Demo note

The default path has no blackout step. Anything visible on screen when you click goes to the backend. This is a known, accepted risk (spec section 8).
