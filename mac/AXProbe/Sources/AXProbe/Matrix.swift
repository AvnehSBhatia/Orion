import ApplicationServices
import Foundation

// The coverage matrix from spec section 12 (M0): for each app, how much text the
// Accessibility API gives us and what reading it costs. Output is numbers only.

/// How a row treats the app's accessibility tree.
enum FlagMode {
    case electronFlag // Chromium and Electron apps get AXManualAccessibility (spec 5.4); native apps get nothing
    case enhancedUI // test only: AXEnhancedUserInterface, which the spec bans for the app
    case none // set nothing, e.g. when the user turned Chrome's tree on in chrome://accessibility
}

struct Target {
    let name: String
    var mode: FlagMode = .electronFlag
    var prep: String?
}

struct Row {
    var target: String
    var skipped = false
    var app = "-"
    var kind = "-"
    var tree = "n/a" // flag used, its state before, and the result of setting it
    var firstChars = 0 // cold first walk: what a capture right after switching to the app gets
    var firstMs = 0.0
    var rereadChars = 0 // Timing.rereadSeconds later (or after the tree flag was set)
    var rereadMs = 0.0
    var charsBefore: Int? // flagged rows: a warm walk before the flag was set
    var chars = 0
    var contentChars = 0
    var quality = 0
    var walkAvgMs = 0.0
    var walkMaxMs = 0.0
    var nodes = 0
    var stoppedBy = "-"
    var titleChars = 0
    var webURL = "-" // where a page URL is readable: "page" (web area AXURL), "window" (AXDocument), or "no"
    var addressBar = "-"
    var secureSkipped = 0
    var cpuBase = 0.0
    var cpuCapture = 0.0
    var memBase = 0.0
    var memCapture = 0.0
    var probeCPU = 0.0
    var notes = ""
}

enum Matrix {
    static let restartChrome = "Quit Chrome with Cmd+Q and reopen it first, so no tree is left on from an earlier row."

    // Round 2 list, per the decisions after round 1.
    static let defaultTargets: [Target] = [
        Target(name: "Terminal (real output)", prep: "Open a second Terminal window (Cmd+N) and fill it with real output, for example ls -la in a busy folder. Switch to that window during the countdown."),
        Target(name: "Slack", prep: "Quit and reopen Slack first, then open a channel with messages."),
        Target(name: "Zoom", prep: "Open a meeting chat or Team Chat with messages."),
        Target(name: "Excel", prep: "Open a sheet with data."),
        Target(name: "Word", prep: "Open a document with text."),
        Target(name: "Outlook", prep: "Open an email."),
        Target(name: "Preview", prep: "Open a PDF with text."),
        Target(name: "QuickBooks", prep: "Open a screen with data. If you use QuickBooks Online in a browser instead, measure it in Safari and say so in the notes."),
        Target(name: "Chrome (title and URL)", prep: "\(restartChrome) Then open a normal web page."),
        Target(name: "Chrome with AXEnhancedUserInterface (test only)", mode: .enhancedUI,
               prep: "\(restartChrome) Then open a normal web page. While it runs, move or resize the window and note anything odd with animations or window tiling."),
        Target(name: "Chrome with chrome://accessibility on (test only)", mode: .none,
               prep: "\(restartChrome) Open chrome://accessibility and turn on the global toggles at the top (Native accessibility API support and Web accessibility). Then open a normal web page in another tab and stay on it."),
    ]

    /// Guided run: one app at a time, then the table.
    static func run(targets: [Target]) {
        printIntro()
        let home = Apps.frontmost() // the terminal this runs in
        var rows: [Row] = []
        var index = 0

        while index < targets.count {
            let target = targets[index]
            print("\n[\(index + 1)/\(targets.count)] \(target.name)")
            if let prep = target.prep { print("  \(prep)") }
            print("  When ready, press Enter here. Type s to skip, q to finish now.")
            guard let line = readLine() else { break }
            let answer = line.trimmingCharacters(in: .whitespaces).lowercased()
            if answer == "q" { break }
            if answer == "s" {
                rows.append(Row(target: target.name, skipped: true))
                index += 1
                continue
            }

            countdown(target.name)
            guard let front = Apps.frontmost() else {
                print("  Could not tell which app is in front. Trying again.")
                continue
            }
            if let home, front.pid == home.pid, !target.name.lowercased().contains("terminal") {
                print("  \(front.name) is still in front (\(Apps.diagnose())).")
                print("  Switch to \(target.name) during the countdown. Trying again.")
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
        guard let row = measure(front, target: Target(name: front.name)) else {
            print("  You switched away. Run it again.")
            return
        }
        printSummary(row)
        print()
        printTable([row])
    }

    // MARK: Measuring one app

    static func measure(_ front: FrontApp, target: Target) -> Row? {
        let app = AXUIElementCreateApplication(front.pid)
        AXUIElementSetMessagingTimeout(app, Limits.axTimeoutSeconds)
        var row = Row(target: target.name)
        row.app = front.name
        row.kind = front.kind.rawValue

        let flag: TreeFlag? = switch target.mode {
        case .electronFlag: front.kind == .native ? nil : .manual
        case .enhancedUI: .enhanced
        case .none: nil
        }
        let prior = flag?.read(app) ?? "n/a"
        var turnedOn = false
        // Put the app back the way it was, even if the run is thrown out.
        defer { if let flag, turnedOn, prior != "on" { _ = flag.set(app, false) } }

        // Right after the switch: the cold first walk, the way the app's first
        // capture after an app switch sees it.
        let first = AXReader.read(app: app)
        row.firstChars = first.chars
        row.firstMs = first.ms
        if flag == nil {
            // The re-read the app does 1 to 2 seconds after a switch.
            Thread.sleep(forTimeInterval: Timing.rereadSeconds)
            let reread = AXReader.read(app: app)
            row.rereadChars = reread.chars
            row.rereadMs = reread.ms
        }

        // Phase 1: the app's own CPU and memory, with no Accessibility calls.
        print("  1 of 2: baseline, not reading (\(Int(Timing.baselineSeconds)) s)")
        let baselinePids = ProcessStats.family(front.pid)
        let a0 = ProcessStats.snapshot(baselinePids)
        guard stayInFront(front.pid, seconds: Timing.baselineSeconds) else { return nil }
        let a1 = ProcessStats.snapshot(baselinePids)
        row.cpuBase = ProcessStats.cpuPercent(from: a0, to: a1, seconds: Timing.baselineSeconds)
        row.memBase = ProcessStats.footprintMB(a1)

        if let flag {
            // A warm walk before the flag: what the app gives without being asked.
            row.charsBefore = AXReader.read(app: app).chars
            let result = flag.set(app, true)
            turnedOn = result == .success
            row.tree = "\(flag.rawValue): was \(prior), set \(axName(result))"
            Thread.sleep(forTimeInterval: Timing.rereadSeconds)
        } else if target.mode == .none {
            row.tree = "none set (chrome://accessibility)"
        }

        // Phase 2: read every few seconds, off the main thread, and measure the cost.
        print("  2 of 2: reading every \(Int(Timing.walkEverySeconds)) s (\(Int(Timing.captureSeconds)) s)")
        let capturePids = ProcessStats.family(front.pid)
        let c0 = ProcessStats.snapshot(capturePids)
        let p0 = ProcessStats.usage(getpid())
        let start = Date()
        var walks: [WalkResult] = []
        while Date().timeIntervalSince(start) < Timing.captureSeconds {
            guard isInFront(front.pid) else { return nil }
            walks.append(AXReader.read(app: app))
            Thread.sleep(forTimeInterval: Timing.walkEverySeconds)
        }
        let elapsed = Date().timeIntervalSince(start)
        let c1 = ProcessStats.snapshot(capturePids)
        let p1 = ProcessStats.usage(getpid())

        row.cpuCapture = ProcessStats.cpuPercent(from: c0, to: c1, seconds: elapsed)
        row.memCapture = ProcessStats.footprintMB(c1)
        if let p0, let p1 { row.probeCPU = Double(p1.cpuNs - p0.cpuNs) / (elapsed * 1e9) * 100 }

        if flag != nil, let firstAfterFlag = walks.first {
            // With a flag, the re-read is the first walk after turning the tree on.
            row.rereadChars = firstAfterFlag.chars
            row.rereadMs = firstAfterFlag.ms
        }
        let best = walks.max { $0.chars < $1.chars } ?? WalkResult()
        row.chars = best.chars
        row.contentChars = best.contentChars
        row.quality = quality(best)
        row.walkAvgMs = walks.isEmpty ? 0 : walks.map(\.ms).reduce(0, +) / Double(walks.count)
        row.walkMaxMs = walks.map(\.ms).max() ?? 0
        row.nodes = best.nodes
        row.stoppedBy = best.stoppedBy ?? "-"
        row.secureSkipped = walks.map(\.skippedSecure).max() ?? 0

        let browser = Browser.inspect(app: app, isBrowser: front.isBrowser)
        row.titleChars = browser.titleChars
        if front.isBrowser { row.addressBar = browser.addressBar }
        var urlSources: [String] = []
        if walks.contains(where: \.webAreaHasURL) { urlSources.append("page") }
        if browser.windowDocument { urlSources.append("window") }
        if !urlSources.isEmpty {
            row.webURL = urlSources.joined(separator: ", ")
        } else if front.isBrowser || walks.contains(where: \.hasWebArea) {
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
        let tree = row.tree == "n/a" ? "" : " Tree: \(row.tree)."
        let before = row.charsBefore.map { " Before the flag: \($0) chars." } ?? ""
        let browser = row.addressBar == "-" ? "" : " Address bar: \(row.addressBar). Page URL from: \(row.webURL)."
        print("""
          Done: \(row.app) (\(row.kind)).\(tree)
          First walk (cold): \(row.firstChars) chars in \(fmt(row.firstMs)) ms. Re-read: \(row.rereadChars) chars in \(fmt(row.rereadMs)) ms.\(before)
          Text: \(row.chars) chars, \(row.contentChars) in sentences, quality \(row.quality)/5. Window title: \(row.titleChars) chars.\(browser)
          Walk: \(fmt(row.walkAvgMs)) ms avg, \(fmt(row.walkMaxMs)) ms max, \(row.nodes) nodes, limit hit: \(row.stoppedBy).
          App CPU \(fmt(row.cpuBase))% -> \(fmt(row.cpuCapture))%, memory \(fmt(row.memBase, 0)) -> \(fmt(row.memCapture, 0)) MB. Probe CPU \(fmt(row.probeCPU))%.
        """)
    }

    static func printTable(_ rows: [Row]) {
        let headers = [
            "Target", "App", "Type", "First walk chars / ms", "Re-read chars / ms", "Chars before flag", "Chars",
            "Sentence chars", "Quality 0-5", "Walk ms avg / max", "Nodes", "Limit hit", "Title chars", "Page URL from",
            "Address bar", "Secure skipped", "Tree", "App CPU % base / reading", "App MB base / reading", "Probe CPU %", "Notes",
        ]
        print("| " + headers.joined(separator: " | ") + " |")
        print("|" + String(repeating: "---|", count: headers.count))
        for r in rows {
            if r.skipped {
                print("| \(r.target) | skipped |" + String(repeating: " |", count: headers.count - 2))
                continue
            }
            let cells = [
                r.target, r.app, r.kind, "\(r.firstChars) / \(fmt(r.firstMs))", "\(r.rereadChars) / \(fmt(r.rereadMs))",
                r.charsBefore.map(String.init) ?? "n/a", "\(r.chars)", "\(r.contentChars)", "\(r.quality)",
                "\(fmt(r.walkAvgMs)) / \(fmt(r.walkMaxMs))", "\(r.nodes)", r.stoppedBy, "\(r.titleChars)", r.webURL,
                r.addressBar, "\(r.secureSkipped)", r.tree, "\(fmt(r.cpuBase)) / \(fmt(r.cpuCapture))",
                "\(fmt(r.memBase, 0)) / \(fmt(r.memCapture, 0))", fmt(r.probeCPU), r.notes,
            ]
            print("| " + cells.joined(separator: " | ") + " |")
        }
    }

    static func fmt(_ value: Double, _ digits: Int = 1) -> String {
        String(format: "%.\(digits)f", value)
    }
}
