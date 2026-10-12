# M0 capture probe

Milestone M0 from the Constellation for Mac spec: prove what on-screen text the macOS Accessibility API gives us, app by app, and what reading it costs. The output is the coverage matrix the team uses to decide which apps v1 supports.

The probe prints **numbers only**: counts, scores, timings, CPU and memory. Captured text exists in memory for the length of one walk (to dedupe and count it) and is never printed or written to disk.

## Run it

```sh
cd ~/Documents/constellation-mac/mac/AXProbe
swift build -c release
.build/release/ax-probe selftest     # checks CPU and memory readings; reads no app text
.build/release/ax-probe matrix       # guided run over the spec's 13 apps
```

Permission: the first `matrix` run asks for Accessibility access. A command line tool's permission belongs to the app it runs in, so turn on **Terminal** (or whichever terminal you use) in System Settings > Privacy & Security > Accessibility, then quit and reopen that terminal. Use Terminal rather than VS Code's built-in terminal, so you don't give VS Code that access.

Other commands:

- `matrix --apps "Slack,Figma"` measures just those apps.
- `once` measures whatever app is in front after a 5 second countdown.

## How one measurement works

For each app: press Enter, switch to the app during the 5 second countdown, and keep using it lightly for about 22 seconds.

1. **Baseline (10 s):** the app's CPU and memory, including Chromium helper processes, with no Accessibility calls at all.
2. **One walk** without touching anything: what the app exposes unprompted ("Chars before flag").
3. **Chromium and Electron apps only:** set `AXManualAccessibility = true` on the app (spec 5.4), and record what it was before and whether the set worked. `AXEnhancedUserInterface` is never used.
4. **Reading (10 s):** walk the focused window every 2 seconds, with the app's CPU and memory measured again.
5. The flag is set back to how it was.

If you switch away mid-run, that run is discarded and the app is asked for again.

**Before measuring a Chromium or Electron app** (Chrome, Slack, VS Code, Notion, Figma), quit and reopen it. Once its text tree is on, it stays on until the app restarts, which would make the baseline look like the reading cost.

## Reading the table

| Column | Meaning |
|---|---|
| Chars before flag | Text from the first walk, before `AXManualAccessibility` was set |
| Chars | Most distinct text from one walk while reading (cap 8,000) |
| Sentence chars | Part of that in strings of 5 or more words, i.e. content rather than UI labels |
| Quality 0-5 | Heuristic from sentence chars: 0 under 50 chars total, then under 100 / 500 / 1,500 / 4,000 / over. A comparison aid, not a judgement of whether the right text came back. Use Notes for that. |
| Walk ms | Time per walk. The budget is 50 ms; walks stop there |
| Limit hit | Which walk limit stopped it (depth 30, nodes 2,000, time 50 ms, chars 8,000), or `-` |
| Web URL | Browsers: whether the web area exposes its URL, needed for the domain field (spec 5.5) |
| Secure skipped | Password-type fields seen and skipped without reading their value |
| Tree flag | `AXManualAccessibility` before, and the result of setting it (`ok`, `unsupported`, ...) |
| App CPU % | Percent of one core, like Activity Monitor, summed over the app's processes |
| Probe CPU % | The probe's own cost while reading |

All limits live in `Sources/AXProbe/Limits.swift`.
