# Constellation for Mac

Menu bar app that reads on-screen text from apps the user turns on. Built milestone by milestone from the Constellation for Mac spec. `mac/AXProbe` is the separate M0 measurement tool.

**Current milestone: M1, event driven capture and segmentation (spec section 5) with exclusions (section 7).**

## Run it

```sh
cd ~/Documents/constellation-mac/mac/Constellation
swift build -c release
.build/release/Constellation        # from Terminal, which already has Accessibility permission
swift test                          # 20 tests: segmentation, dedupe, browser URLs, exclusions, pause
```

M1 runs as a plain executable, not an .app bundle, so it uses the Accessibility permission of the terminal it starts from. Packaging, signing, and its own permission come in M8.

When it starts, Terminal prints "Constellation is running" and stays busy. That is normal: the app lives in the menu bar, not in the Terminal. The Apps window opens on every launch. On a MacBook with a full menu bar, macOS can hide the eye icon behind the camera notch; the Apps window has the same on/off, pause, and debug controls. Quit with Ctrl+C in Terminal or Quit in the menu.

## What M1 does

- **Menu bar icon** that always shows the state: eye (on), pause (paused), crossed-out eye (off). It starts **off**. The menu has one-click pause (1 hour, until tomorrow), resume, turn off, and delete all.
- **App picker** ("Choose apps…"): every installed app starts off. Badges: **Verified** (measured in M0: Safari, Chrome, Mail, Terminal, VS Code, Zoom), **Unverified** (everything else, including Slack, Notion, Figma, Excel, Word, Outlook, Preview, QuickBooks), **Blocked** (password managers, Keychain Access, System Settings; cannot be turned on). Editable lists of domains and words that always skip capture.
- **Event driven capture** of the front app, only if it is turned on: app switch, focused window change, title change (rapid changes folded into one), content change (at most once per 10 s per window), and return from 2 minutes idle. A **re-read 1.5 s after every app or window switch**, because M0 showed the first read can be partial. Never while off, paused, locked, in the screensaver, or with the display or Mac asleep. Low Power Mode doubles every delay.
- **Reads off the main thread** on a background queue, with a 100 ms budget per read (depth 30, 2,000 nodes, 8,000 chars). Secure text fields, menus, toolbars, and window controls are never read. Electron apps get `AXManualAccessibility`, never `AXEnhancedUserInterface`.
- **Browsers** (Safari, Chrome and other Chromium browsers, Firefox): tab title plus **domain and path only**. Query strings, fragments, user names, passwords, and ports are dropped before anything is kept. Page text is never read.
- **Private windows** are skipped before anything else is read: by title ("Private Browsing", "Incognito"), which catches Safari, and by the toolbar's profile button ("Incognito", "Guest", "InPrivate"), which catches Chrome incognito and guest windows and Edge InPrivate. Chrome keeps a normal page title in incognito, so the title alone missed it. Both verified by hand in M1.
- **Segmentation** into activity records: a new record when the app, window title, or browser page changes, or after a 2 minute gap. Within a record only new lines are kept, up to 4,000 chars.
- **Debug view** ("Debug view…"): per app, captures, characters (last and average), title length, whether a URL was found, read time (last, average, max), last trigger, and skips with the reason. **Counts only**: no text, titles, or URLs are shown.

## Not in M1

- **Nothing is written to disk.** Records live in memory and are gone when the app quits. Settings (on/off, pause, chosen apps, skip lists) are saved; they hold no captured text. The encrypted store is M3.
- **No redaction yet** (M2). That is why nothing is stored or sent.
- No onboarding or Outbox (M4, M5).

## Check it by hand

1. Run it. The Apps window opens, and the menu bar shows the crossed-out eye.
2. Turn on Mail and Safari in the list, then switch on **Capture** at the top of the window. The icon becomes an eye.
3. Click **Debug view** and switch between Mail and Safari. Each switch adds captures (app switch, then re-read). Mail shows characters; Safari shows 0 characters, a title length, and URL yes.
4. Open a Safari private window (Shift+Cmd+N) or a Chrome incognito window (Shift+Cmd+N in Chrome) with a page loaded. The row should show skips with "private window" and no new captures.
5. Add a word to "Always skip windows containing" that appears in an open email: that window shows "skipped word" skips.
6. "Pause for 1 hour": no new captures. "Resume": captures come back.
7. "Delete all captured data": records and counts go to 0.

## Tests

Swift Testing (`import Testing`), because the Command Line Tools include it but not XCTest, which needs Xcode. The tests cover the spec's checklist items that don't need a live app: segmentation (app switch, idle gap, rapid title changes), dedupe, browser URL stripping, private and blocked windows, banking domains, skip words, and the pause/off/locked gate.
