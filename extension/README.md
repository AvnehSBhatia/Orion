# Constellation browser extension (Team A)

Click "Start capturing" and pick your entire screen in Chrome's share picker. Every 5 seconds the extension sends a frame of the whole screen to `POST /api/ingest/capture`, so it works in any app, not just Chrome. Click "Stop capturing" (in the popup or the small capture window) to stop. The toolbar icon shows a red "ON" badge while it is sending.

- When a Chrome tab is in front, the payload also carries that tab's URL, title, and cleaned HTML, with `source: "browser"`.
- When another app is in front, `html` is empty, `url` is `desktop://screen`, `title` is `Desktop`, and `source: "desktop"`.
- Near identical frames are skipped (a small grayscale thumbnail is compared), so the cursor or the menu bar clock alone does not trigger a send.
- Closing the capture window, clicking Chrome's "Stop sharing", or closing the browser all stop capturing. It never starts on its own.

On macOS, Chrome needs Screen Recording permission: System Settings > Privacy & Security > Screen & System Audio Recording > Google Chrome on, then restart Chrome.

## Run it

```sh
cd extension
npm install
npm run build        # or: npm run watch
npm run mock         # fake backend on http://localhost:3000 until Team C is up
```

1. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `extension/dist`.
2. Open the extension's options page and set your user id. The backend URL defaults to `http://localhost:3000`.
3. Click the extension icon, then "Start capturing". The first time, the popup asks for your user id. A small window opens and asks you to pick your entire screen. Keep it open (minimizing is fine).

The mock server saves the last capture to `mock/out/`. Open `last-capture.jpg` and `last-capture.html` there to see what was sent.

## What gets sent

Matches spec section 1.3:

```ts
{ userId, url, title, html, screenshotB64, redactions?: { x, y, w, h }[], source?: "browser" | "desktop" }
```

- `html`: empty if the page could not be read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed. Only meaningful attributes are kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG of the whole screen (up to 1920x1200) at quality 70 with no `data:` prefix. If it is over 2MB, it is scaled down until it fits.
- `redactions`: empty unless the user used "Hide something", a one off send available while capturing is stopped. In that case the screenshot already has black boxes painted over those areas. The rects are in screenshot pixels.

## Layout

```
src/background.ts   service worker: the 5 second loop, change detection, page read, post to backend
src/capture.ts      the small capture window: holds the screen share, returns frames on request
src/recording.ts    recording on/off and progress, in chrome.storage.session
src/content.ts      readPage(), injected into the tab
src/popup.ts        start/stop button, live status, and the "Hide something" drawing flow
src/options.ts      user id and backend URL (chrome.storage.sync)
static/             manifest, html, css (copied into dist/)
mock/server.mjs     stand-in backend for /api/ingest/capture
```

The loop runs in the service worker, so it keeps going after the popup closes. A 30 second alarm restarts it if Chrome puts the worker to sleep.

## Demo note

While capturing is on, anything visible on the whole screen (any app, notifications included) is sent every 5 seconds, with no blackout step. Turn on Do Not Disturb for demos. Stop capturing before opening anything private. This is a known, accepted risk (spec section 8).
