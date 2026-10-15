# Orion Chrome extension

Captures the windows, screens, and tabs you choose and sends them to your team's Orion server, which turns them into updates on the shared work map. A budget change in Google Ads or a deal moved in HubSpot shows up in Orion without anyone writing a status update.

## What it captures

Click **Start capturing** in the toolbar popup. The first time, Orion shows your organization's monitoring notice, and you accept it before anything is captured. Then a chooser window opens where you pick what Orion may see:

- **Windows and screens.** "Add a window or screen" opens Chrome's picker. Pick one app window (Spotify, Excel, Slack) or a whole screen. Press it again to add more.
- **Chrome tabs.** The first time, press **Allow tab capture** so Chrome lets Orion read the tabs you tick. Then tick the tabs you allow. A ticked tab is captured while it is the visible tab in its window. Tabs on sites your organization excludes, or that you marked "never capture", are listed but cannot be ticked.

Press **Start capturing** in the chooser. On your organization's interval (5 seconds unless the admin changes it) the extension sends one capture per chosen source:

| Source | What is sent |
| --- | --- |
| Window or screen | A JPEG of the frame, labeled like "Window 1". No page text. |
| Tab | A JPEG of the tab, its URL without query string or fragment, its title, and a cleaned copy of the page HTML. |

A source that has not changed since its last send is skipped. Windows and screens are compared with a small grayscale thumbnail, so the cursor or the menu bar clock alone does not trigger a send.

## Privacy

- **Only what you pick.** Nothing outside the chosen windows, screens, and tabs is read, including other Chrome tabs.
- **Never on its own.** Capturing starts only when you press start in the chooser. Pressing **Stop capturing**, closing the chooser window, or closing Chrome stops it. A red **ON** badge on a recording icon shows while it is sending. Orion does not run in incognito windows.
- **Pause.** While capturing, the popup can pause for 15 minutes, 1 hour, or until you resume. Nothing is read while paused, not even the frames; the badge shows a grey **II**.
- **Never capture this site.** The popup can mark the current site as never captured, and settings lists and edits those sites. Your organization's excluded sites (from the capture policy) apply too. Tabs on those sites are skipped before anything is read: no screenshot, no HTML. Subdomains are included. Both lists are checked again just before a queued capture is sent.
- **Sensitive fields stay out.** Values are never copied from password and hidden inputs, fields with `autocomplete` `cc-*`, `one-time-code`, or `*-password`, or fields whose name, id, or label looks like a card number, CVV, SSN or national id, IBAN or account number, PIN, one-time code, token, secret, or API key. Scripts, styles, iframes, and most attributes are stripped too. See `src/lib/sensitive.ts`.
- **No query strings.** URLs are sent as origin and path only, since query strings and fragments often carry session ids, search terms, and reset tokens.
- **Hide something.** While not capturing, "Hide something" in the popup takes a screenshot of the current tab, lets you drag black boxes over anything private, and sends that one capture. The boxes are painted into the image before it leaves the browser.
- **HTTPS only.** The server URL must be `https://`; plain `http://` is refused except for `localhost` and `127.0.0.1`. This is checked when you save the URL and again before every request.
- **Your token stays on this device.** The sign-in token is kept in local extension storage, not synced to your Chrome profile. **Sign out** also revokes it on the server.

Window and screen shares cannot be filtered by site: everything visible in them is sent, including notifications. Share specific windows where you can, turn on Do Not Disturb, and pause before opening anything private.

## Install

```sh
cd extension
npm install
npm run build        # or: npm run watch
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `extension/dist`.
2. On macOS, give Chrome Screen Recording permission (System Settings > Privacy & Security > Screen & System Audio Recording > Google Chrome), then restart Chrome. Tabs work without it; windows and screens do not.

A dev build is named "Orion (dev)" and defaults to `http://localhost:3001` (a local `npm run dev` in `server/`). To bake in another server, set `ORION_SERVER_URL`:

```sh
ORION_SERVER_URL=https://orion.example.com npm run build
```

That URL becomes the default in settings and the only site the extension can reach without asking (`host_permissions`). Tab access is an optional permission the chooser asks for.

## Sign in

Open the extension's options page (popup > **Settings**):

1. Check **Orion server URL**. It defaults to the server the build was made for. If you change it to another server, Chrome asks to allow access to it.
2. Enter your Orion username and password and press **Sign in**.

The extension signs in once, creates a long-lived API token labeled "chrome extension", and ends the password session. It stores that token (and its id, so sign-out can revoke it), your user id, and your org. Captures are sent as you, to your org.

If the server runs with `AUTH_DISABLED=true`, you can skip sign-in and just enter a user id. The popup asks for one on first run.

To limit which extension builds the server accepts, set `EXTENSION_IDS` in `server/.env` to a comma-separated list of extension ids.

## Talking to the server

All requests carry `Authorization: Bearer <token>`. The extension uses these routes (see `docs/api-additions.md`):

| Route | When |
| --- | --- |
| `GET /api/capture/policy` | On start and every 5 minutes while capturing. `captureEnabled: false` stops capturing; `excludedHosts` are never read; `captureIntervalSec` sets the loop (clamped to 5..3600). The last good copy is kept, so an outage does not lift exclusions. |
| `GET /api/auth/me` | On start, for `consent: { required, version, acceptedAt }`. If `consent.notice` (or `consent.text`) is a string it is shown as the notice; otherwise a built-in notice is. |
| `POST /api/auth/consent { version }` | When you accept the notice. |
| `POST /api/ingest/capture` | Each capture. |
| `DELETE /api/auth/tokens/:id` | On sign-out. |

How answers are handled (`src/lib/responses.ts`, `src/background/sender.ts`):

| Answer | What happens |
| --- | --- |
| 401 | Stop capturing, forget the token, amber **!** badge, and the popup asks you to sign in again. |
| 403 "consent required" | Stop, and the popup shows the monitoring notice to accept. |
| 403 "capture paused" | Stop with "your organization has paused capturing". Any other 403 stops with "ask your admin". |
| 429, 408, 5xx, network error, timeout | Back off: 5s, 10s, 20s ... up to 5 minutes, plus up to 25% jitter, or exactly `Retry-After` (header or `retryAfterSec`, clamped to 1s..1h). New captures queue in memory meanwhile (at most 40, or 24MB; oldest dropped first) and are sent oldest first once the server is back. The popup shows how many are waiting and when the next try is. |
| 402 | That capture is dropped and the popup says the budget is used up. Capturing continues. |
| Other 4xx | That capture is dropped (it would never be accepted). |

The queue is in memory only; captures are never written to disk.

### The capture body

`POST /api/ingest/capture`:

```ts
{ userId, orgId?, url, title, html, screenshotB64, redactions?: { x, y, w, h }[], source?: "tab" | "window" | "screen" }
```

- `url`: the tab's origin and path, or `desktop://window/<id>` and `desktop://screen/<id>` for shared windows and screens.
- `html`: empty for windows, screens, and pages Chrome will not let it read. Otherwise the page with `script, style, svg, noscript, iframe, link, meta, template, canvas` removed and only meaningful attributes kept (href, alt, title, aria-label, role, value, and similar). Current form values are copied in, except sensitive ones (see Privacy), so a budget you just typed shows up. If the result is still over 60k chars, the page's visible text without any form fields (first 60k chars) is sent instead.
- `screenshotB64`: a JPEG at quality 70 with no `data:` prefix, up to 1920x1200 for windows and screens. If it is over 2MB it is scaled down until it fits.
- `redactions`: only set by "Hide something". The rects are in screenshot pixels and are already painted black in the image.

The full request and response types are in `server/src/contract/types.ts`.

## Checking captures without a server

`npm run mock` starts a stand-in server on `http://localhost:3001`. It answers `POST /api/ingest/capture` (checking the server's size limits and saving the last capture to `mock/out/`: `last-capture.jpg`, `last-capture.html`, `last-capture.json`), plus the policy, `me`, and consent routes. It ignores auth. Environment variables shape it:

| Variable | Effect |
| --- | --- |
| `MOCK_CONSENT=1` | Ask for the monitoring notice before the first capture. |
| `MOCK_EXCLUDED=bank.com,mail.google.com` | The policy's `excludedHosts`. |
| `MOCK_INTERVAL=10` | The policy's `captureIntervalSec`. |
| `MOCK_CAPTURE_ENABLED=0` | The policy turns capturing off. |
| `MOCK_FAIL=429` (or 500, 401, 402, 403) | Every capture fails that way, to watch backoff, sign-out, or consent handling. |

## Tests

```sh
npm test             # node:test on src/lib and readPage (linkedom as the DOM)
npm run typecheck    # src, and the tests
```

## Icons

`static/icons/` holds the Orion mark at 16, 32, 48, and 128px (`icon-*.png`) and a recording variant with a red dot (`active-*.png`) that the toolbar shows while capturing. They are committed. To redraw them, and the store promo tile, run `npm run icons`; it uses sharp from `../server/node_modules`, or set `SHARP_PATH`.

## Chrome Web Store

`ORION_SERVER_URL=https://orion.example.com npm run package` builds `release/orion-extension-<version>.zip`. The listing copy, permission justifications, and data-use disclosures are in `store/`.

## Code layout

```
src/background.ts            service worker entry: message router and lifecycle listeners
src/background/recorder.ts   opens the chooser, runs the capture loop, start and stop
src/background/sources.ts    builds one payload per window, screen, or tab; skips excluded sites before reading
src/background/read-page.ts  readPage(), bundled as read-page.js and injected into a tab to get cleaned HTML
src/background/changes.ts    skips sources that have not changed since the last send
src/background/sender.ts     upload queue with backoff
src/background/upload.ts     POST /api/ingest/capture and what each answer means
src/background/policy.ts     GET /api/capture/policy
src/background/account.ts    401 handling and the monitoring notice (GET /api/auth/me, POST /api/auth/consent)
src/background/api.ts        every server request; enforces https at send time
src/background/badge.ts      toolbar icon and badge (ON, II, !)
src/background/images.ts     shrinks screenshots that are over the size limit
src/lib/                     pure, tested modules: URL rules, sensitive fields, backoff, queue, policy, responses
src/capture.ts               the chooser window: picks windows, screens, and tabs, holds the streams
src/capture/frames.ts        grabs a frame and a change-detection thumbnail from each stream
src/popup.ts                 start and stop, pause, never capture this site, the notice, and "Hide something"
src/options.ts               sign-in, server URL, and blocked sites
src/privacy.ts               pause, blocked sites, cached policy, and warnings in chrome.storage.local
src/recording.ts             recording state in chrome.storage.session
src/settings.ts              user id, org, server URL (synced) and token (local)
static/                      manifest, HTML, CSS, icons, copied into dist/
scripts/icons.mjs            renders the icons with sharp
scripts/package.mjs          production build and store zip
store/                       Chrome Web Store listing and privacy answers
test/                        node:test suites
mock/server.mjs              stand-in server
```

The loop runs in the service worker, so it keeps going after the popup closes. The chooser window holds the window and screen streams and is minimized, not closed, while capturing. A 30 second alarm restarts the loop if Chrome puts the worker to sleep, and a 5 minute alarm refreshes the capture policy.
