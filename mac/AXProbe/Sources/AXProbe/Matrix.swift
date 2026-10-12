import ApplicationServices
import Foundation

// The coverage matrix from spec section 12 (M0): for each app, how much text the
// Accessibility API gives us and what reading it costs. Output is numbers only.

struct Row {
    var target: String
    var skipped = false
    var app = "-"
    var kind = "-"
    var tree = "-" // Chromium/Electron: AXManualAccessibility before, and the result of turning it on
    var firstChars = 0 // first, cold walk: what a capture right after switching to the app gets
    var firstMs = 0.0
    var charsBefore: Int? // Chromium/Electron: a warm walk before the tree flag was set
    var chars = 0
    var contentChars = 0
    var quality = 0
    var walkAvgMs = 0.0
    var walkMaxMs = 0.0
    var nodes = 0
    var stoppedBy = "-"
    var webURL = "-"
    var secureSkipped = 0
    var cpuBase = 0.0
    var cpuCapture = 0.0
    var memBase = 0.0
    var memCapture = 0.0
    var probeCPU = 0.0
    var notes = ""
}

enum Matrix {
    static let defaultTargets = [
        "Safari", "Chrome", "Slack", "VS Code", "Notion", "Google Docs in Chrome", "Gmail in Chrome",
        "Figma", "Xcode", "Mail", "Terminal", "Linear or Jira in browser", "Zoom chat",
    ]

    /// Guided run: one app at a time, then the table.
    static func run(targets: [String]) {
        printIntro()
        let home = Apps.frontmost() // the terminal this runs in
        var rows: [Row] = []
        var index = 0

        while index < targets.count {
            let target = targets[index]
            print("\n[\(index + 1)/\(targets.count)] \(target)")
            print("  Open it, then press Enter here. Type s to skip, q to finish now.")
            guard let line = readLine() else { break }
            let answer = line.trimmingCharacters(in: .whitespaces).lowercased()
            if answer == "q" { break }
            if answer == "s" {
                rows.append(Row(target: target, skipped: true))
                index += 1
                continue
            }

            countdown(target)
            guard let front = Apps.frontmost() else {
                print("  Could not tell which app is in front. Trying again.")
                continue
            }
            if let home, front.pid == home.pid, !target.lowercased().contains("terminal") {
                print("  \(front.name) is still in front (\(Apps.diagnose())).")
                print("  Switch to \(target) during the countdown. Trying again.")
                continue
            }

            print("  Measuring \(front.name). Keep it in front and use it lightly for about \(Int(Timing.totalSeconds)) seconds.")
            guard var row = measure(front, target: target) else {
                print("  You switched away, so this run was thrown out. Trying again.")
                continue
            }
            printSummary(row)
            print("  Notes (optional, press Enter to skip): ", terminator: "")
            fflush(stdout)
            row.notes = (readLine() ?? "").replacingOccurrences(of: "|", with: "/")
            rows.append(row)
            index += 1
        }

        print("\nCoverage matrix\n")
        printTable(rows)
    }

    /// Measure whatever app is in front after a countdown, once.
    static func runOnce() {
        printIntro()
        countdown("the app to measure")
        guard let front = Apps.frontmost() else { print("Could not tell which app is in front."); return }
        print("  Measuring \(front.name). Keep it in front for about \(Int(Timing.totalSeconds)) seconds.")
        guard let row = measure(front, target: front.name) else { print("  You switched away. Run it again."); return }
        printSummary(row)
        print()
        printTable([row])
    }

    // MARK: Measuring one app

    static func measure(_ front: FrontApp, target: String) -> Row? {
        let app = AXUIElementCreateApplication(front.pid)
        AXUIElementSetMessagingTimeout(app, Limits.axTimeoutSeconds)
        var row = Row(target: target)
        row.app = front.name
        row.kind = front.kind.rawValue

        let usesTreeFlag = front.kind != .native
        let prior = usesTreeFlag ? ManualAccessibility.read(app) : "n/a"
        var turnedOn = false
        // Put the app back the way it was, even if the run is thrown out.
        defer { if turnedOn && prior != "on" { _ = ManualAccessibility.set(app, false) } }

        // Phase 1: the app's own CPU and memory, with no Accessibility calls at all.
        print("  1 of 2: baseline, not reading (\(Int(Timing.baselineSeconds)) s)")
        let baselinePids = ProcessStats.family(front.pid)
        let a0 = ProcessStats.snapshot(baselinePids)
        guard stayInFront(front.pid, seconds: Timing.baselineSeconds) else { return nil }
        let a1 = ProcessStats.snapshot(baselinePids)
        row.cpuBase = ProcessStats.cpuPercent(from: a0, to: a1, seconds: Timing.baselineSeconds)
        row.memBase = ProcessStats.footprintMB(a1)

        // The first walk is cold: the app builds its Accessibility objects on
        // demand, so this is slow and may hit the time limit. It is what the real
        // app gets on the capture right after you switch apps.
        let first = AXReader.walk(app: app)
        row.firstChars = first.chars
        row.firstMs = first.ms

        if usesTreeFlag {
            // A warm walk before touching the flag: what Chromium gives unasked.
            Thread.sleep(forTimeInterval: 0.5)
            row.charsBefore = AXReader.walk(app: app).chars
            let result = ManualAccessibility.set(app, true)
            turnedOn = result == .success
            row.tree = "was \(prior), set \(axName(result))"
            Thread.sleep(forTimeInterval: Timing.settleSeconds)
        } else {
            row.tree = "n/a"
        }

        // Phase 2: read every few seconds and measure the app's cost while we do.
        print("  2 of 2: reading every \(Int(Timing.walkEverySeconds)) s (\(Int(Timing.captureSeconds)) s)")
        let capturePids = ProcessStats.family(front.pid)
        let c0 = ProcessStats.snapshot(capturePids)
        let p0 = ProcessStats.usage(getpid())
        let start = Date()
        var walks: [WalkResult] = []
        while Date().timeIntervalSince(start) < Timing.captureSeconds {
            guard isInFront(front.pid) else { return nil }
            walks.append(AXReader.walk(app: app))
            Thread.sleep(forTimeInterval: Timing.walkEverySeconds)
        }
        let elapsed = Date().timeIntervalSince(start)
        let c1 = ProcessStats.snapshot(capturePids)
        let p1 = ProcessStats.usage(getpid())

        row.cpuCapture = ProcessStats.cpuPercent(from: c0, to: c1, seconds: elapsed)
        row.memCapture = ProcessStats.footprintMB(c1)
        if let p0, let p1 { row.probeCPU = Double(p1.cpuNs - p0.cpuNs) / (elapsed * 1e9) * 100 }

        let best = walks.max { $0.chars < $1.chars } ?? WalkResult()
        row.chars = best.chars
        row.contentChars = best.contentChars
        row.quality = quality(best)
        row.walkAvgMs = walks.isEmpty ? 0 : walks.map(\.ms).reduce(0, +) / Double(walks.count)
        row.walkMaxMs = walks.map(\.ms).max() ?? 0
        row.nodes = best.nodes
        row.stoppedBy = best.stoppedBy ?? "-"
        row.secureSkipped = walks.map(\.skippedSecure).max() ?? 0
        if walks.contains(where: \.webAreaHasURL) {
            row.webURL = "yes"
        } else if walks.contains(where: \.hasWebArea) {
            row.webURL = "no"
        }
        if !best.foundWindow { row.notes = "no focused window found" }
        return row
    }

    /// Heuristic 0 to 5, from how much sentence-like text came back. A rough guide
    /// for comparing apps, not a judgement of whether the right text was captured.
    static func quality(_ walk: WalkResult) -> Int {
        guard walk.foundWindow, walk.chars >= 50 else { return 0 }
        switch walk.contentChars {
        case ..<100: return 1
        case ..<500: return 2
        case ..<1_500: return 3
        case ..<4_000: return 4
        default: return 5
        }
    }

    // MARK: Front app checks

    static func isInFront(_ pid: pid_t) -> Bool {
        Apps.frontmost()?.pid == pid
    }

    static func stayInFront(_ pid: pid_t, seconds: Double) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            guard isInFront(pid) else { return false }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return true
    }

    static func countdown(_ target: String) {
        print("  Switch to \(target) now. Starting in", terminator: "")
        for second in stride(from: Int(Timing.switchDelaySeconds), to: 0, by: -1) {
            print(" \(second)", terminator: "")
            fflush(stdout)
            Thread.sleep(forTimeInterval: 1)
        }
        print()
    }

    // MARK: Output (numbers only)

    static func printIntro() {
        print("""
        Constellation M0 capture probe
        Reads the focused window's text through the Accessibility API and prints only
        counts, scores, timings, CPU and memory. No captured text is printed or saved.

        For a fair CPU baseline, quit and reopen Chrome and Electron apps (Slack, VS Code,
        Notion, Figma) before measuring them: once their text tree is on, it stays on
        until the app restarts. Use the app the same light way in both halves of a run.
        """)
    }

    static func printSummary(_ row: Row) {
        let tree = row.kind == "Native" ? "" : " Tree flag: \(row.tree)."
        let before = row.charsBefore.map { ", \($0) before the tree flag" } ?? ""
        print("""
          Done: \(row.app) (\(row.kind)).\(tree)
          First walk (cold): \(row.firstChars) chars in \(fmt(row.firstMs)) ms\(before).
          Text: \(row.chars) chars, \(row.contentChars) in sentences, quality \(row.quality)/5.
          Walk: \(fmt(row.walkAvgMs)) ms avg, \(fmt(row.walkMaxMs)) ms max, \(row.nodes) nodes, limit hit: \(row.stoppedBy).
          App CPU \(fmt(row.cpuBase))% -> \(fmt(row.cpuCapture))%, memory \(fmt(row.memBase, 0)) -> \(fmt(row.memCapture, 0)) MB. Probe CPU \(fmt(row.probeCPU))%.
        """)
    }

    static func printTable(_ rows: [Row]) {
        print("| Target | App | Type | First walk chars / ms | Chars before flag | Chars | Sentence chars | Quality 0-5 | Walk ms avg / max | Nodes | Limit hit | Web URL | Secure skipped | Tree flag | App CPU % base / reading | App MB base / reading | Probe CPU % | Notes |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in rows {
            if r.skipped {
                print("| \(r.target) | skipped | | | | | | | | | | | | | | | | |")
                continue
            }
            let cells = [
                r.target, r.app, r.kind, "\(r.firstChars) / \(fmt(r.firstMs))", r.charsBefore.map(String.init) ?? "n/a",
                "\(r.chars)", "\(r.contentChars)", "\(r.quality)",
                "\(fmt(r.walkAvgMs)) / \(fmt(r.walkMaxMs))", "\(r.nodes)", r.stoppedBy, r.webURL, "\(r.secureSkipped)",
                r.tree, "\(fmt(r.cpuBase)) / \(fmt(r.cpuCapture))", "\(fmt(r.memBase, 0)) / \(fmt(r.memCapture, 0))",
                fmt(r.probeCPU), r.notes,
            ]
            print("| " + cells.joined(separator: " | ") + " |")
        }
    }

    static func fmt(_ value: Double, _ digits: Int = 1) -> String {
        String(format: "%.\(digits)f", value)
    }
}
