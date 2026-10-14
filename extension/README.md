# Constellation browser extension (Team A)

Click "Start capturing" in the popup. A window opens where you choose what Constellation can see:

- **Windows and screens:** "Add a window or screen" opens Chrome's picker. Pick one app window (Spotify, Excel, Slack) or a whole screen. Press it again to add more.
- **Chrome tabs:** tick the tabs you allow. A ticked tab is captured, page HTML included, while it is the tab showing in its window.

Then press "Start capturing" in that window. Every 5 seconds the extension sends one capture per source to `POST /api/ingest/capture`. Nothing you did not pick is read, including other Chrome tabs. Sources can be added or removed while capturing. The toolbar icon shows a red "ON" badge while it is sending.

- A shared window or screen sends `source: "window"` or `"screen"`, `html: ""`, `url: "desktop://<kind>/<id>"`, and `title` like "Window 1".
- A ticked tab sends `source: "tab"` with its real URL, title, and cleaned HTML.
- A source that has not changed since its last send is skipped. Windows and screens are compared with a small grayscale thumbnail, so the cursor or the menu bar clock alone does not trigger a send.
- Closing the chooser window, pressing "Stop capturing", or closing the browser stops everything. It never starts on its own.

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
3. Click the extension icon, then "Start capturing". The first time, the popup asks for your user id. In the window that opens, add windows or screens and tick tabs, then press "Start capturing". Keep that window open (minimizing is fine).

The mock server saves the last capture to `mock/out/`. Open `last-capture.jpg` and `last-capture.html` there to see what was sent.

## What gets sent

Matches spec section 1.3:

```ts
{ userId, url, title, html, screenshotB64, redactions?: { x, y, w, h }[], source?: "tab" | "window" | "screen" }
```

- `html`: empty if the page could not be read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed. Only meaningful attributes are kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG of that window, screen (up to 1920x1200), or tab at quality 70 with no `data:` prefix. If it is over 2MB, it is scaled down until it fits.
- `redactions`: empty unless the user used "Hide something", a one off send available while capturing is stopped. In that case the screenshot already has black boxes painted over those areas. The rects are in screenshot pixels.

## Layout

```
src/background.ts   service worker: the 5 second loop, change detection, page read, post to backend
src/capture.ts      the chooser window: picks windows/screens/tabs, holds the streams, returns frames on request
src/recording.ts    recording on/off and progress, in chrome.storage.session
src/content.ts      readPage(), injected into the tab
src/popup.ts        start/stop button, live status, and the "Hide something" drawing flow
src/options.ts      user id and backend URL (chrome.storage.sync)
static/             manifest, html, css (copied into dist/)
mock/server.mjs     stand-in backend for /api/ingest/capture
```

The loop runs in the service worker, so it keeps going after the popup closes. A 30 second alarm restarts it if Chrome puts the worker to sleep.

## Demo note

While capturing is on, everything visible in the chosen windows, screens, and tabs is sent every 5 seconds, with no blackout step. Sharing a whole screen includes notifications, so turn on Do Not Disturb for demos, or share specific windows instead. Stop capturing before opening anything private. This is a known, accepted risk (spec section 8).
