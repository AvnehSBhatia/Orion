# Constellation browser extension (Team A)

Click "Start capturing" and, every 5 seconds, the extension sends a screenshot of the active tab plus its cleaned HTML to `POST /api/ingest/capture`. Click "Stop capturing" to stop. The toolbar icon shows a red "ON" badge while it is sending.

- If the screen and HTML have not changed since the last send, that beat is skipped, so the backend does not reprocess identical captures.
- HTML is best effort. If a page refuses script injection, the screenshot is still sent with `html: ""`.
- `chrome://` pages and other restricted pages are skipped.
- Capturing stops when the browser closes. It never starts on its own.

## Run it

```sh
cd extension
npm install
npm run build        # or: npm run watch
npm run mock         # fake backend on http://localhost:3000 until Team C is up
```

1. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `extension/dist`.
2. Open the extension's options page and set your user id. The backend URL defaults to `http://localhost:3000`.
3. Go to any page, click the extension icon, then "Start capturing". The first time, the popup asks for your user id.

The mock server saves the last capture to `mock/out/`. Open `last-capture.jpg` and `last-capture.html` there to see what was sent.

## What gets sent

Matches spec section 1.3:

```ts
{ userId, url, title, html, screenshotB64, redactions?: { x, y, w, h }[] }
```

- `html`: empty if the page could not be read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed. Only meaningful attributes are kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG at quality 70 with no `data:` prefix. If it is over 2MB, it is scaled down until it fits.
- `redactions`: empty unless the user used "Hide something", a one off send available while capturing is stopped. In that case the screenshot already has black boxes painted over those areas. The rects are in screenshot pixels.

## Layout

```
src/background.ts   service worker: the 5 second loop, screenshot, page read, post to backend
src/recording.ts    recording on/off and progress, in chrome.storage.session
src/content.ts      readPage(), injected into the tab
src/popup.ts        start/stop button, live status, and the "Hide something" drawing flow
src/options.ts      user id and backend URL (chrome.storage.sync)
static/             manifest, html, css (copied into dist/)
mock/server.mjs     stand-in backend for /api/ingest/capture
```

The loop runs in the service worker, so it keeps going after the popup closes. A 30 second alarm restarts it if Chrome puts the worker to sleep.

## Demo note

While capturing is on, anything visible in the active Chrome tab is sent every 5 seconds, with no blackout step. Stop capturing before opening anything private. This is a known, accepted risk (spec section 8).
