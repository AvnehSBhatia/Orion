# Constellation for Mac

Menu bar app that reads on-screen text from apps the user turns on, redacts it on the device, and (from M5 on) sends approved work records to the backend. `mac/AXProbe` is the separate M0 measurement tool.

**Plan (changed from the original spec):** this is the capture front end, not a standalone app. Summaries and the star map live in the backend and the team UI. Milestones: M0 probe, M1 capture, M2 redaction, M3 encrypted store, M4 welcome and permission screen, **M5 Outbox (current)**, M5 Outbox, then a sender to the backend, on-device client matching, and a daily draft review screen. M8 packaging later.

## Run it

```sh
cd ~/Documents/constellation-mac/mac/Constellation
swift build -c release
.build/release/Constellation        # from Terminal, which already has Accessibility permission
swift test                          # 56 tests: Outbox, store, redaction, segmentation, dedupe, browser URLs, exclusions, pause
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
| `[EMAIL]` | Email addresses |
| `[PHONE]` | US numbers like (415) 555-0132, 415-555-0132, +1 415 555 0132; international numbers starting with + |
| `[CARD]` | 13 to 19 digits, plain or grouped, that pass the Luhn check |
| `[SSN]` | 123-45-6789 style, skipping numbers never issued |
| `[ADDRESS]` | Street addresses, found by Apple's on-device data detector (the one Mail and Messages use) |
| `[SECRET]` | API keys and tokens (sk-, ghp_, github_pat_, AKIA, xox, Bearer, JWTs), and long random strings (24+ characters, letters and digits mixed, high entropy), which also catches document ids in browser paths |
| `[IP]` | Private network addresses, only if turned on in the Apps window |
| `[Person 1]` | People's names, only if "Replace people's names" is on. Found on the device with Apple's NaturalLanguage framework. The same name gets the same number for the session |

Each line's result is remembered (keyed by a SHA-256 of the line, so no unredacted text is held), so a window read again only pays for new lines: about 40 ms the first time a full window is seen, under 1 ms after. Delete all clears this cache too.

Look-alikes that are kept, each with a test: version strings, dates, card-shaped numbers that fail Luhn, IPs (when off), build numbers, money, ISBNs, long words, file paths, camelCase identifiers, `user@localhost`, and "sk-" inside a word. Hex commit hashes and UUIDs are treated as secrets, on purpose: they can be session or document ids.

The debug view adds a **Redactions** count per app. Text is still never shown there; the Outbox (M5) is where the redacted text becomes visible.

## Outbox (M5)

Nothing leaves the Mac unless it appears in the Outbox first (spec 2.5, 9). Open it from the menu: "Outbox (N to review)…".

- A record goes to the Outbox when it **closes**: the app, window, or page changes, or 2 minutes pass with no new capture. The record still being written never appears. Records left open when the app quit are closed at the next launch.
- **Review first** (default): items wait under "Waiting for review". **Approve automatically after 30 minutes** is on by default and can be turned off. **Log only**: items are approved as soon as they close. The mode is chosen in the welcome screens and can be changed in the Outbox.
- Items are grouped into **30 minute batches**. A batch can be approved or deleted as a whole; each item can be edited or deleted on its own.
- Each item shows the app, times, title, web address, text, and redaction count. **People's names are highlighted** in yellow (spec 8) and redaction markers like `[EMAIL]` are greyed. "What will be sent" shows the exact JSON, produced by the same code the sender will use.
- **Edits are redacted again** before they are saved, so nothing typed into an edit skips redaction. Edited items are marked.
- **Delete is permanent**: the row is removed and, with `secure_delete`, overwritten.
- Destination: **not connected yet**. Approved items wait under "Approved, waiting to send" until the sender is built. Nothing is sent.

Once a record has closed, capture can never overwrite it, so edits and deletes stick. The store upgrades an M3 database in place (schema version 2), and a test covers that.

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

- Nothing is sent anywhere yet: the sender, client matching, and the daily draft review come next.

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
