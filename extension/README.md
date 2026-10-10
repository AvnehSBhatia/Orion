# Orion browser extension

Join your org once, click "Start capturing", and every 5 seconds the extension sends a screenshot of the active tab plus its cleaned HTML to `POST /api/ingest/capture`. Click "Stop capturing" to stop. While it is sending, the toolbar icon switches to the pink "live" version of the Orion mark and shows an "ON" badge.

- If the screen and HTML have not changed since the last send, that beat is skipped, so the backend does not reprocess identical captures.
- HTML is best effort. If a page refuses script injection, the screenshot is still sent with `html: ""`.
- `chrome://` pages and other restricted pages are skipped.
- Capturing stops when the browser closes. It never starts on its own.

## Run it

```sh
npm run dev          # in the repo root: the backend on http://localhost:3001
cd extension
npm install
npm run build        # or: npm run watch
```

1. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `extension/dist`.
2. Click the Orion icon. The first time, the popup asks you to join: your org id (create orgs with `POST /api/orgs`; `demo` always exists), your name, and one sentence about what you do. The popup checks the org with `GET /api/orgs/:orgId`, then joins with `POST /api/users`, and keeps the user id the backend returns. Your role sentence tells DeepSeek what counts as your work.
3. Go to any page and click "Start capturing". The popup shows how many captures were sent and how many the backend kept as work (repeats and pages with no work on them are not kept).

The settings page edits the same name, role, and org, plus the Orion URL (default `http://localhost:3001`). Saving with the same org updates you in place, so your history stays attached.

`npm run mock` starts a stand-in backend on the same port. It accepts any org id for joining and saves the last capture to `mock/out/` (`last-capture.jpg`, `last-capture.html`). Use it only when the real backend is not running.

## What the backend does with a capture

- OCR reads the screenshot. If its text matches the part of the page that is on screen (embedding cosine 0.95 or more), only the text is stored. Otherwise the screenshot is shrunk to WebP and kept, and the model also reads its text.
- DeepSeek reads the page and updates the org's graph. This takes about 10 to 15 seconds, so the request timeout is 60 seconds and a beat is skipped while a send is in flight.
- A capture that repeats your last capture of the same URL within 30 minutes (same page text, and same screenshot text when the screenshot was kept) is answered with `duplicateOf` and stores nothing new. This covers screens that change by a pixel every beat, such as a blinking cursor or a clock.
- If DeepSeek finds no work on the page (personal email, shopping, social media), nothing is stored and the response has `notWork: true`.
- An unknown user id gets a 404. The popup goes back to the join form.

## What gets sent

Matches spec section 1.3:

```ts
{ orgId, userId, url, title, html, screenshotB64, redactions?: { x, y, w, h }[] }
```

- `html`: empty if the page could not be read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed. Only meaningful attributes are kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG at quality 70 with no `data:` prefix. If it is over 2MB, it is scaled down until it fits.
- `redactions`: empty unless the user used "Hide something", a one off send available while capturing is stopped. In that case the screenshot already has black boxes painted over those areas. The rects are in screenshot pixels.

## Layout

```
src/background.ts   service worker: the 5 second loop, screenshot, page read, post to backend
src/recording.ts    recording on/off and progress, in chrome.storage.session
src/content.ts      readPage(), injected into the tab
src/popup.ts        join form, start/stop button, live stats, and the "Hide something" drawing flow
src/options.ts      name, role, org, and Orion URL (chrome.storage.sync)
src/settings.ts     settings storage, org lookup, and joining
src/logo.ts         the Orion mark as an SVG string, shared by the pages and the icon script
src/motion.ts       all animation, on anime.js v4, with a reduced-motion fallback
scripts/icons.mjs   renders the mark to static/icons/ (npm run icons; needs sharp from the repo root)
static/             manifest, html, css, icons (copied into dist/)
mock/server.mjs     stand-in backend for /api/ingest/capture
```

The loop runs in the service worker, so it keeps going after the popup closes. A 30 second alarm restarts it if Chrome puts the worker to sleep.

## Demo note

While capturing is on, anything visible in the active Chrome tab is sent every 5 seconds, with no blackout step. Stop capturing before opening anything private. This is a known, accepted risk (spec section 8).
