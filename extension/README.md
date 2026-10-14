# Orion Chrome extension

Captures the windows, screens, and tabs you choose and sends them to your team's Orion server, which turns them into updates on the shared work map. A budget change in Google Ads or a deal moved in HubSpot shows up in Orion without anyone writing a status update.

## What it captures

Click **Start capturing** in the toolbar popup. A chooser window opens where you pick what Orion may see:

- **Windows and screens.** "Add a window or screen" opens Chrome's picker. Pick one app window (Spotify, Excel, Slack) or a whole screen. Press it again to add more.
- **Chrome tabs.** Tick the tabs you allow. A ticked tab is captured while it is the visible tab in its window.

Press **Start capturing** in the chooser. Every 5 seconds the extension sends one capture per chosen source:

| Source | What is sent |
| --- | --- |
| Window or screen | A JPEG of the frame, labeled like "Window 1". No page text. |
| Tab | A JPEG of the tab, its URL and title, and a cleaned copy of the page HTML. |

A source that has not changed since its last send is skipped. Windows and screens are compared with a small grayscale thumbnail, so the cursor or the menu bar clock alone does not trigger a send.

## Privacy

- **Only what you pick.** Nothing outside the chosen windows, screens, and tabs is read, including other Chrome tabs.
- **Never on its own.** Capturing starts only when you press start in the chooser. Pressing **Stop capturing**, closing the chooser window, or closing Chrome stops it. A red **ON** badge on the toolbar icon shows while it is sending.
- **Passwords stay out.** Password fields are never copied into the HTML. Scripts, styles, iframes, and most attributes are stripped before sending.
- **Hide something.** While not capturing, "Hide something" in the popup takes a screenshot of the current tab, lets you drag black boxes over anything private, and sends that one capture. The boxes are painted into the image before it leaves the browser.
- **Your token stays on this device.** The sign-in token is kept in local extension storage, not synced to your Chrome profile.

While capturing, everything visible in the chosen sources is sent with no blackout step. Sharing a whole screen includes notifications, so share specific windows where you can, turn on Do Not Disturb, and stop capturing before opening anything private.

## Install

```sh
cd extension
npm install
npm run build        # or: npm run watch
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `extension/dist`.
2. On macOS, give Chrome Screen Recording permission (System Settings > Privacy & Security > Screen & System Audio Recording > Google Chrome), then restart Chrome. Tabs work without it; windows and screens do not.

## Sign in

Open the extension's options page (popup > **Settings**):

1. Set **Orion server URL** to your Orion server. The default, `http://localhost:3001`, is a local `npm run dev` in `server/`.
2. Enter your Orion username and password and press **Sign in**.

The extension signs in once, creates a long-lived API token labeled "chrome extension", and ends the password session. It stores that token, your user id, and your org. Captures are sent as you, to your org. **Sign out** forgets the token; revoke it on the server to cut it off everywhere.

If the server runs with `AUTH_DISABLED=true`, you can skip sign-in and just enter a user id. The popup asks for one on first run.

To limit which extension builds the server accepts, set `EXTENSION_IDS` in `server/.env` to a comma-separated list of extension ids.

## What gets sent

`POST /api/ingest/capture` with `Authorization: Bearer <token>`:

```ts
{ userId, orgId?, url, title, html, screenshotB64, redactions?: { x, y, w, h }[], source?: "tab" | "window" | "screen" }
```

- `url`: the tab's URL, or `desktop://window/<id>` and `desktop://screen/<id>` for shared windows and screens.
- `html`: empty for windows, screens, and pages Chrome will not let it read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed and only meaningful attributes kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG at quality 70 with no `data:` prefix, up to 1920x1200 for windows and screens. If it is over 2MB it is scaled down until it fits.
- `redactions`: only set by "Hide something". The rects are in screenshot pixels and are already painted black in the image.

The full request and response types are in `server/src/contract/types.ts`.

## Checking captures without a server

`npm run mock` starts a stand-in for `POST /api/ingest/capture` on `http://localhost:3001`. Use it to see exactly what the extension sends, for example after changing what `readPage` keeps, without running the Orion server or a model. It checks the server's size limits, ignores auth, and saves the last capture to `mock/out/` (`last-capture.jpg`, `last-capture.html`, `last-capture.json`). With the default server URL, enter any user id in the popup and start capturing.

## Code layout

```
src/background.ts            service worker entry: message router and lifecycle listeners
src/background/recorder.ts   opens the chooser, runs the 5 second loop, start and stop
src/background/sources.ts    builds one payload per window, screen, or tab
src/background/read-page.ts  readPage(), injected into a tab to get cleaned HTML
src/background/changes.ts    skips sources that have not changed since the last send
src/background/images.ts     shrinks screenshots that are over the size limit
src/background/upload.ts     POST /api/ingest/capture
src/capture.ts               the chooser window: picks windows, screens, and tabs, holds the streams
src/capture/frames.ts        grabs a frame and a change-detection thumbnail from each stream
src/popup.ts                 start and stop, live status, and the "Hide something" flow
src/options.ts               sign-in and server URL
src/recording.ts             recording state in chrome.storage.session
src/settings.ts              user id, org, server URL (synced) and token (local)
static/                      manifest, HTML, CSS, copied into dist/
mock/server.mjs              stand-in for /api/ingest/capture
```

The loop runs in the service worker, so it keeps going after the popup closes. The chooser window holds the window and screen streams and is minimized, not closed, while capturing. A 30 second alarm restarts the loop if Chrome puts the worker to sleep.

`npm run typecheck` checks the TypeScript.
