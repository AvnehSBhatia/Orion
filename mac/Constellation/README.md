# Constellation for Mac

Menu bar app that reads on-screen text from apps the user turns on, redacts it on the device, and (from M5 on) sends approved work records to the backend. `mac/AXProbe` is the separate M0 measurement tool.

**Plan (changed from the original spec):** this is the capture front end, not a standalone app. Summaries and the star map live in the backend and the team UI. Milestones: M0 probe, M1 capture, M2 redaction, M3 encrypted store, M4 welcome and permission screen, M5 Outbox, sender, client matching, **daily draft review (current)**, M5 Outbox, then a sender to the backend, on-device client matching, and a daily draft review screen. M8 packaging later.

## Run it

```sh
cd ~/Documents/constellation-mac/mac/Constellation
swift build -c release
.build/release/Constellation        # from Terminal, which already has Accessibility permission
swift test                          # 103 tests (plus on-demand live tests): Outbox, store, redaction, segmentation, dedupe, browser URLs, exclusions, pause
```

M1 runs as a plain executable, not an .app bundle, so it uses the Accessibility permission of the terminal it starts from. Packaging, signing, and its own permission come in M8.

When it starts, Terminal prints "Constellation is running" and stays busy. That is normal: the app lives in the menu bar, not in the Terminal. On first run, or while the Accessibility permission is missing, the **welcome screens** open; after that, the Apps window opens on every launch. On a MacBook with a full menu bar, macOS can hide the eye icon behind the camera notch; the Apps window has the same on/off, pause, and debug controls. Quit with Ctrl+C in Terminal or Quit in the menu.

## What M1 does

- **Menu bar icon** that always shows the state: eye (on), pause (paused), crossed-out eye (off). It starts **off**. The menu has one-click pause (1 hour, until tomorrow), resume, turn off, and delete all.
- **App picker** ("Choose apps…"): every installed app starts off. Badges: **Verified** (measured in M0: Safari, Chrome, Mail, Terminal, VS Code, Zoom), **Unverified** (everything else, including Slack, Notion, Figma, Excel, Word, Outlook, Preview, QuickBooks), **Blocked** (password managers, Keychain Access, System Settings; cannot be turned on). Editable lists of domains and words that always skip capture.
- **Event driven capture** of the front app, only if it is turned on: app switch, focused window change, title change (rapid changes folded into one), content change (at most once per 10 s per window), and return from 2 minutes idle. A **re-read 1.5 s after every app or window switch**, because M0 showed the first read can be partial. Never while off, paused, locked, in the screensaver, or with the display or Mac asleep. Low Power Mode doubles every delay.
- **Reads off the main thread** on a background queue, with a 100 ms budget per read (depth 30, 2,000 nodes, 8,000 chars). Secure text fields, menus, toolbars, and window controls are never read. Electron apps get `AXManualAccessibility`, never `AXEnhancedUserInterface`.
- **Browsers** (Safari, Chrome and other Chromium browsers, Firefox): tab title plus **domain and path only**. Query strings, fragments, user names, passwords, and ports are dropped before anything is kept. Page text is never read.
- **Private windows** are skipped before anything else is read: by title ("Private Browsing", "Incognito"), which catches Safari, and by the toolbar's profile button ("Incognito", "Guest", "InPrivate"), which catches Chrome incognito and guest windows and Edge InPrivate. Chrome keeps a normal page title in incognito, so the title alone missed it. Both verified by hand in M1.
- **Segmentation** into activity records: a new record when the app, window title, or browser page changes, or after a 2 minute gap. Within a record only new lines are kept, up to 4,000 chars.
- **Debug view** ("Debug view…"): per app, captures, characters (last and average), title length, whether a URL was found, read time (last, average, max), last trigger, and skips with the reason. **Counts only**: no text, titles, or URLs are shown.

## Redaction (M2)

Runs on the capture queue, right after a window is read and before anything reaches a record, so nothing unredacted is ever kept. It covers the window title, the browser domain and path, and the text.

| Replaced with | What |
|---|---|
| `[EMAIL]` | Email addresses (on by default; optional `[EMAIL]@acme.com` keeps the company part) |
| `[PHONE]` | (on by default) US numbers like (415) 555-0132, 415-555-0132, +1 415 555 0132; international numbers starting with + |
| `[CARD]` | 13 to 19 digits, plain or grouped, that pass the Luhn check |
| `[SSN]` | 123-45-6789 style, skipping numbers never issued |
| `[ADDRESS]` | (on by default) Street addresses, found by Apple's on-device data detector (the one Mail and Messages use) |
| `[SECRET]` | API keys and tokens (sk-, ghp_, github_pat_, AKIA, xox, Bearer, JWTs), and long random strings (24+ characters, letters and digits mixed, high entropy), which also catches document ids in browser paths |
| `[IP]` | Private network addresses, only if turned on in the Apps window |
| `[Person 1]` | People's names, only if "Replace people's names" is on. Found on the device with Apple's NaturalLanguage framework. The same name gets the same number for the session |

**Links in text** (titles, window text, Outbox edits) are cut to domain and path, the same rule as browser addresses: `https://site.com/reset?token=abc#x` becomes `site.com/reset`, because query strings and fragments can carry tokens.

Each line's result is remembered (keyed by a SHA-256 of the line, so no unredacted text is held), so a window read again only pays for new lines: about 40 ms the first time a full window is seen, under 1 ms after. Delete all clears this cache too.

**The person chooses** (Apps window, Privacy): email addresses, phone numbers, and street addresses can each be turned off, and email addresses can keep their company part. Card numbers, SSNs, and API keys and tokens are always replaced, with no switch. There is no company-wide override. Choices apply to text captured from then on.

Look-alikes that are kept, each with a test: version strings, dates, card-shaped numbers that fail Luhn, IPs (when off), build numbers, money, ISBNs, long words, file paths, camelCase identifiers, `user@localhost`, and "sk-" inside a word. Hex commit hashes and UUIDs are treated as secrets, on purpose: they can be session or document ids.

The debug view adds a **Redactions** count per app. Text is still never shown there; the Outbox (M5) is where the redacted text becomes visible.

## Outbox (M5)

Nothing is kept by the backend until it has appeared in the Outbox and been approved (spec 2.5, 9). Batches waiting for approval are sent only to be summarized, and the backend must not keep them. Open the Outbox from the menu bar popover.

- A record goes to the Outbox when it **closes**: you open another email, window, or page, you **leave the app** (even for an app that isn't captured, such as Terminal or this Outbox), or 2 minutes pass with no new capture. Records left open when the app quit are closed at the next launch. Coming back to the window you just left within 5 minutes (say, after a look at the Outbox) continues its record rather than adding a duplicate, as long as it hasn't been approved or edited.
- The card at the top says whether anything new can arrive: **Capture is off** or **Paused** (with Turn on / Resume), or **Capturing now** with the title of the record still being written (title only; its text appears once it closes).
- **Review first** (default): items wait under "Waiting for Review". **Auto-approve after 30 minutes** is on by default and can be turned off. **Log only**: items are approved as soon as they close. The mode is chosen in the welcome screens and can be changed in the Outbox.
- Items are grouped by **stretches of capturing**: a batch runs from the first thing captured to the last, and a gap of more than 5 minutes with nothing captured (capture off or paused, or only apps that are not read) starts the next one. Its header shows those real times. Batches only organise the Outbox; each item is still sent as its own work block. A batch can be approved or deleted as a whole; each item can be edited or deleted on its own.
- **AI summary first.** While connected, each batch's redacted blocks go to `POST /v1/summaries` a few seconds after the batch changes, and the backend AI's summary is shown at the top of the batch, so the person approves what the AI understood. The backend must not keep anything from that call; only approved blocks are kept (via `/v1/work-blocks`). Not connected: no summary, just the items. Summaries are kept in memory only and fetched again after a restart.
- A collapsed batch also lists its first few items ("Email: Re: Acme renewal · Web page: Pricing – Initech · +3 more"), so it can be scanned without opening it.
- Each item is **one readable line**: an envelope for an email or a globe for a web page, the subject or page title, who it's from or which site, and the time. Click it to read the message: the first few sentence-like lines, leaving out the title, the sender, and short interface labels. **Show Full Text** shows everything captured; **Show Details** lists every field the backend receives in plain words (status, title, address, app, time, client, how many details were replaced, text length). **People's names are highlighted** in yellow (spec 8) and markers like `[EMAIL]` are greyed.
- **Edits are redacted again** before they are saved, so nothing typed into an edit skips redaction. Edited items are marked.
- **Delete is permanent**: the row is removed and, with `secure_delete`, overwritten.
- Approved items wait under "Approved, waiting to send" until the sender delivers them (see Sender). Nothing is sent while not connected.

Once a record has closed, capture can never overwrite it, so edits and deletes stick. The store upgrades an M3 database in place (schema version 2), and a test covers that.

## Sender

Sends **approved** Outbox items to the backend. Request and response shapes are in [`mac/BACKEND_CONTRACT.md`](../BACKEND_CONTRACT.md), for the backend team.

- **Connect** in the Outbox's Backend box: enter the backend address (default `http://localhost:8787`, the mock) and click Connect. That registers this Mac (`POST /v1/devices/register`) with a random install id, platform, and versions; no computer or user name. An optional enrollment code can be entered if the company uses one. The device token is kept in the **Keychain**, never in settings.
- Only `https` addresses are accepted, except `http://localhost` for testing.
- Approved items are sent within a minute, up to 50 per `POST /v1/work-blocks`, oldest first, and right away after you approve a batch ("Send now" forces it). Only ids the backend accepts are marked sent; they move to the Outbox's **Sent** log with the time and destination (spec 9). Sent items can no longer be edited.
- If the backend can't be reached, it tries again after 30 s, then 1, 2, 4 ... minutes, up to 15 minutes. If the backend rejects the token (401 or 403), the app disconnects and asks to connect again. Approved items keep waiting either way.
- Log only mode now means: items close, are approved, and are sent within a minute.

## Look (space theme)

All screens share one dark "space" theme: `Sources/Constellation/UI/Theme/` holds the tokens (`Theme.swift`: colors, spacing, type), the star field background (`SpaceBackground.swift`, a fixed-seed Canvas with no animation, so it costs nothing when idle), and the components every screen uses (`Components.swift`: GlassCard, StarBadge, StatusPill, GlowDot, Chip, Primary/Ghost/Icon buttons, SectionHeader, InfoButton, ConstellationDivider, EmptyState). Windows have a transparent title bar with content running under it, are always dark, and have default and minimum sizes in `MenuBarController.sizes`. On-screen text follows the macOS style: Title Case for buttons, menu items, window titles, and section names; sentence case for descriptions and switches; a period only on full sentences. When no client list has synced yet, Outbox items say "Clients not synced" rather than "No client".

The menu bar eye opens a popover (status, Pause, the windows, Delete all, **Quit Constellation**). Command-Q also quits while a Constellation window is in front.

Text contrast is at least 4.5:1 on every surface (tertiary text is 56% opacity rather than 50% for that reason). Reduce Transparency swaps translucent cards for solid ones.

To look at every screen without opening anything, a debug build can render them to PNGs with fake sample data:

```sh
swift build && CONSTELLATION_RENDER_DIR=/tmp/constellation-screens .build/debug/Constellation --smoke-test
```

## App profiles (Mail)

Some apps keep everything in one window. Mail shows the mailbox list, the list of emails (each with a preview of up to 1,000 characters), and the open email side by side, and its window title stays "Inbox – Primary · 26 messages" whichever email is open. Read whole, a Mail block was a mix of many emails, never split per email, and couldn't be matched to a client.

A profile (`Sources/CaptureCore/Capture/AppProfiles.swift`) names views to skip and where the real title is, by the developer identifiers the app gives its views, found with `ax-probe layout` (counts only, no text). For Mail:

- Skipped: `MailboxesOutlineView` (sidebar), `Mail.messageList` (the list of emails and their previews), and `Mail.categoryBucket.` (the All Mail / Primary / Promotions tabs; an entry ending in a dot skips every identifier starting with it).
- Title: the selected email's subject and sender, e.g. "Your Apple ID was used to sign in — Apple". So each email is its own block, and the sender counts as a strong client signal.
- Text: what's left, which is the open email.

Captured text is tidied before it is redacted and stored (`TextCleanup.swift`): button and image labels ("Summarize", "Load Content Directly", an avatar's initial) are not read in any app; Mail's area labels ("message content", "message headers") are left out; lines that only repeat the title, subject, or sender, or the window's own title (Mail's "Primary · 26 messages, 12 unread"), are dropped; and sentences broken around a link ("Your Apple ID (" / ") was used…") are joined again. Browser titles lose the browser's name and the Chrome profile name ("Pricing - Google Chrome - Veer" becomes "Pricing").

The window's own title is never read into the text of any app, since it is already the record's title ("Inbox – Primary · 26 messages" no longer shows up in Mail text).

To map what else a window holds, `ax-probe layout --all` prints every element instead of summarising long lists, and `--skip Mail.messageList,MailboxesOutlineView` leaves views out (counts only, still no text).

Clicking another email changes the selection but not the window title, so selection changes (`AXSelectedRowsChanged`, `AXSelectedChildrenChanged`) now trigger a read about 1 second later, plus the usual re-read. Apps without a profile are read whole, as before.

## Client matching

Each work block is matched to a client **on the Mac**, and only the client's id is sent (`client_id`).

- The client list comes from `GET /v1/clients?since=` when you connect and every 15 minutes after ("Sync clients" in the Backend box forces it). Only changes are fetched after the first sync. The list is saved **encrypted** in the store; client names are readable in the app and are **never masked** by "Replace people's names".
- Each client has a name, aliases, domains, and project codes. A block is scored on its browser page domain (strongest), then project codes, names, and domains in the window title, then the browser path, then the body text. A client is sent only if it clearly wins: a tie, or only a weak signal such as a name mentioned once in body text, sends no client. Email addresses are redacted before matching, so email domains don't count.
- The Outbox shows the matched client for each item and why ("matched by domain acme.com"), and "What will be sent" includes the `client_id`.
- Delete all clears the client list too; the next sync fetches it again.

## Daily draft review

"Today's draft…" in the menu shows the time entries the backend drafted from today's sent work blocks (`GET /v1/drafts/today`, with the Mac's time zone). For each entry the person can:

- change the **client** (picker from the synced client list, or "No client"),
- change the **time** (5 minute steps, 1 minute to 24 hours) and the **description**,
- **Accept** (with any changes), **Reject**, or **Save changes** and decide later (`POST /v1/drafts/entries/:id/review`).

Edited descriptions go through the person's redaction choices before they're sent. The header shows the day's total (rejected entries excluded) and how many are left to review. The mock backend drafts one entry per client from the day's blocks, with minutes from the blocks' spans and a description listing their titles; the real backend's summaries replace that.

### Mock backend

```sh
node ~/Documents/constellation-mac/mac/mock-backend/server.mjs     # port 8787, no packages needed
```

It implements register, work blocks, clients, today's draft, reviews, and delete my data per the contract, prints one line per received block (app, times, size, redaction count), warns if anything that looks like an unredacted email, phone number, or key arrives, and saves everything to `mac/mock-backend/data/` (git ignored) so you can read exactly what arrived. Registered devices survive a restart of the mock.

Its clients come from `mac/mock-backend/clients.json`: sample clients (Acme, Globex, Initech, and Apple, so Apple emails match). Edit it to try your own; it's read on every sync. Mark a client `"deleted": true` to remove it from the Mac.

Live test, on its own port and data folder so it doesn't touch a mock you're running:

```sh
PORT=8799 MOCK_DATA_DIR=/tmp/mock-test node mac/mock-backend/server.mjs &
CONSTELLATION_LIVE_BACKEND=http://localhost:8799 swift test --filter LiveBackendTests
```

## Welcome and permission (M4)

Five short screens, shown on first run and from the menu ("Welcome and permission…"):

1. What Constellation is for.
2. What it reads and what it never reads, in plain words, plus how redaction and encryption work.
3. The Accessibility permission. The system prompt opens only when the person clicks **Open System Settings** on this screen, never at launch (spec 5.1). The screen shows "Allowed" as soon as macOS grants it.
4. Sharing: Review first or Log only, and auto approve (M5).
5. Choose apps (opens the app list) and an optional "Start capturing now" switch.

The rest of M4 (menu bar icon and states, app picker, pause controls) was built in M1.

## Encrypted store (M3)

Every record is saved to `~/Library/Application Support/Constellation/constellation.sqlite` (folder 700, file 600), so records, and later the Outbox, survive a restart.

- SQLite built into macOS, no third-party packages. The captured content of each record (window title, domain and path, text, text hash) is sealed with AES-GCM (CryptoKit). Times, app, status, and counts stay readable for sorting and the Outbox.
- The 256-bit key is in the login Keychain as `com.traxrobotics.constellation` / `store-key`, usable only on this Mac and never synced to iCloud.
- Saving runs in the background, after redaction, so nothing unredacted reaches the disk.
- **Retention:** every hour, the text of records that ended more than 30 days ago is cleared. Title and domain stay.
- **Delete all** closes the database, deletes the files, destroys the Keychain key (so any leftover bytes cannot be read), and starts again empty with a new key.
- If the store can't open, capture keeps working with records in memory only, and the debug view says "store unavailable".

**Keychain prompt while developing:** this build isn't signed, so after every rebuild macOS asks, at launch, whether Constellation can use its Keychain item. Enter your Mac password and click **Always Allow**. Signing (M8) ends that. `--smoke-test` never opens the store, so it never triggers the prompt.

## Live Chrome check

Chrome incognito windows are recognised only by the "Incognito" label on Chrome's toolbar profile button. To check Chrome still labels it that way, open an incognito window with any page, leave it as Chrome's front window, and run from Terminal:

```sh
CONSTELLATION_LIVE_CHROME=1 swift test --filter ChromeLiveTests
```

It fails if the label is gone. Without the variable it is skipped.

## Not built yet

- `POST /v1/baseline` isn't used yet.

## Check it by hand

1. Run it. On first run the welcome screens open; finish them (or skip to the end with Continue). Afterwards the Apps window opens, and the menu bar shows the eye.
2. Turn on Mail and Safari in the list, then switch on **Capture** at the top of the window. The icon becomes an eye.
3. Click **Debug view** and switch between Mail and Safari. Each switch adds captures (app switch, then re-read). Mail shows characters; Safari shows 0 characters, a title length, and URL yes.
4. Open a Safari private window (Shift+Cmd+N) or a Chrome incognito window (Shift+Cmd+N in Chrome) with a page loaded. The row should show skips with "private window" and no new captures.
5. Add a word to "Always skip windows containing" that appears in an open email: that window shows "skipped word" skips.
6. "Pause for 1 hour": no new captures. "Resume": captures come back.
7. Quit and start again: "Records saved (encrypted)" keeps its count.
8. "Delete all captured data": records and counts go to 0, also after a restart.

## Tests

Swift Testing (`import Testing`), because the Command Line Tools include it but not XCTest, which needs Xcode. The tests cover the spec's checklist items that don't need a live app: segmentation (app switch, idle gap, rapid title changes), dedupe, browser URL stripping, private and blocked windows, banking domains, skip words, and the pause/off/locked gate.
