# M0 capture probe

Milestone M0 from the Constellation for Mac spec: prove what on-screen text the macOS Accessibility API gives us, app by app, and what reading it costs. The output is the coverage matrix the team uses to decide which apps v1 supports.

The probe prints **numbers only**: counts, scores, timings, CPU and memory. Captured text exists in memory for the length of one walk (to dedupe and count it) and is never printed or written to disk.

## Run it

```sh
cd ~/Documents/constellation-mac/mac/AXProbe
swift build -c release
.build/release/ax-probe selftest     # checks CPU and memory readings; reads no app text
.build/release/ax-probe matrix       # guided run over the round 2 app list
```

Permission: the first `matrix` run asks for Accessibility access. A command line tool's permission belongs to the app it runs in, so turn on **Terminal** (or whichever terminal you use) in System Settings > Privacy & Security > Accessibility, then quit and reopen that terminal. Use Terminal rather than VS Code's built-in terminal, so you don't give VS Code that access.

Other commands:

- `matrix --apps "Safari,Mail"` measures just those apps.
- `once` measures whatever app is in front after a 5 second countdown.
- `front` shows which app the probe thinks is in front, if it keeps picking the wrong one.

## Round 2 app list

After round 1 the team decided: one Mac app only (no browser extension); Chrome is covered by tab title plus URL; the walk budget is 100 ms, reads run off the main thread, and the app re-reads 1 to 2 seconds after an app switch. Round 2 measures Terminal with real output, Slack, Zoom, Excel, Word, Outlook, Preview, QuickBooks, and three Chrome rows:

- **Chrome (title and URL):** is the tab title and the URL readable (from the address bar, the window, or the page)?
- **Chrome with AXEnhancedUserInterface (test only):** the probe sets it, measures, and sets it back. The spec bans it for the app because it can break window animations and tiling tools, so note anything odd.
- **Chrome with chrome://accessibility on (test only):** you turn on the global toggles yourself; the probe sets nothing.

Each row prints what to prepare before pressing Enter. Quit and reopen Chrome before each Chrome row.

## How one measurement works

For each app: press Enter, switch to the app during the 5 second countdown, and keep using it lightly for about 23 seconds.

1. **First walk (cold), right after the switch:** the app builds its Accessibility objects on demand, so this read is slow and partial.
2. **Re-read 1.5 s later** (apps with no tree flag), the way the app will re-read after a switch.
3. **Baseline (10 s):** the app's CPU and memory, including Chromium helper processes, with no Accessibility calls.
4. **Flagged rows only:** one warm walk ("Chars before flag"), then set the flag (`AXManualAccessibility` for Chromium and Electron, or `AXEnhancedUserInterface` in the test row), wait 1.5 s. The first walk after that is the re-read.
5. **Reading (10 s):** walk the focused window every 2 seconds on a background queue, with CPU and memory measured again.
6. **Browsers:** window title length, and whether the URL is readable from the address bar, the window (`AXDocument`), or the page (`AXURL`). The title and URL themselves are never printed.
7. The flag is set back to how it was.

If you switch away mid-run, that run is discarded and the app is asked for again.

## Reading the table

| Column | Meaning |
|---|---|
| First walk chars / ms | The cold first read, right after the switch |
| Re-read chars / ms | 1.5 s later, or the first read after the tree flag was set |
| Chars before flag | Chromium and Electron only: a warm read before `AXManualAccessibility` was set. `n/a` for native apps |
| Chars | Most distinct text from one walk while reading (cap 8,000) |
| Sentence chars | Part of that in strings of 5 or more words, i.e. content rather than UI labels |
| Quality 0-5 | Heuristic from sentence chars: 0 under 50 chars total, then under 100 / 500 / 1,500 / 4,000 / over. A comparison aid, not a judgement of whether the right text came back. Use Notes for that. |
| Walk ms | Time per walk. The budget is 100 ms; walks stop there |
| Limit hit | Which walk limit stopped it (depth 30, nodes 2,000, time 100 ms, chars 8,000), or `-` |
| Title chars | Length of the focused window's title (the active tab's title in browsers) |
| Page URL from | Where a page URL is readable: `page` (web area AXURL), `window` (AXDocument), `no` |
| Address bar | Browsers: `domain + path`, `domain only`, `found, no URL`, or `not found` |
| Secure skipped | Password-type fields seen and skipped without reading their value |
| Tree | Flag used, its state before, and the result of setting it (`ok`, `unsupported`, ...) |
| App CPU % | Percent of one core, like Activity Monitor, summed over the app's processes |
| Probe CPU % | The probe's own cost while reading |

All limits live in `Sources/AXProbe/Limits.swift`.
