import ApplicationServices
import Foundation

// One capture of the front app's focused window. Runs on a background queue,
// never the main thread (spec 13). Exclusions that need the title or URL are
// applied here, before any page or window text is read.

public struct CaptureRequest: Sendable {
    public var pid: pid_t
    public var bundleId: String
    public var appName: String
    public var isBrowser: Bool
    /// Electron apps: turn the accessibility tree on first (spec 5.4).
    public var turnOnElectronTree: Bool
    public var rules: ExclusionRules
    public var redaction: RedactionOptions
    public var names: NameMasker?
    /// Browsers: also read the page's text. Only when the company allows it and the person turned it on.
    public var readPageText: Bool

    public init(
        pid: pid_t, bundleId: String, appName: String, isBrowser: Bool, turnOnElectronTree: Bool,
        rules: ExclusionRules, redaction: RedactionOptions = RedactionOptions(), names: NameMasker? = nil,
        readPageText: Bool = false
    ) {
        self.readPageText = readPageText
        self.pid = pid
        self.bundleId = bundleId
        self.appName = appName
        self.isBrowser = isBrowser
        self.turnOnElectronTree = turnOnElectronTree
        self.rules = rules
        self.redaction = redaction
        self.names = names
    }
}

public enum WindowCapture {
    private static let queue = DispatchQueue(label: "constellation.capture", qos: .utility)

    /// Read on the capture queue and hand the result back to the caller.
    public static func read(_ request: CaptureRequest) async -> Snapshot {
        await withCheckedContinuation { continuation in
            queue.async { continuation.resume(returning: readNow(request)) }
        }
    }

    static func readNow(_ request: CaptureRequest) -> Snapshot {
        let start = DispatchTime.now()
        var snapshot = Snapshot(appBundleId: request.bundleId, appName: request.appName)
        func finish(_ snapshot: Snapshot) -> Snapshot {
            var done = snapshot
            done.readMs = AXReader.elapsedMs(since: start)
            done.capturedAt = Date()
            return done
        }

        let app = AXUIElementCreateApplication(request.pid)
        AXUIElementSetMessagingTimeout(app, Limits.axTimeoutSeconds)
        if request.turnOnElectronTree {
            // AXManualAccessibility, not AXEnhancedUserInterface (spec 5.4).
            AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        }

        guard let window = AXReader.focusedWindow(of: app) else { return finish(snapshot) }
        snapshot.foundWindow = true
        let title = AXReader.title(of: window) ?? ""

        // Private windows: by title (Safari), or by the toolbar's profile button
        // (Chrome incognito and guest, Edge InPrivate). Nothing else is read and
        // not even the title is kept.
        if ExclusionRules.isPrivate(title: title)
            || (request.isBrowser && BrowserPrivacy.hasPrivateMarker(in: window, start: start)) {
            snapshot.skip = .privateWindow
            return finish(snapshot)
        }
        // Apps like Mail keep one window title for every email; the profile finds the real one.
        let profile = AppProfile.forApp(request.bundleId)
        snapshot.windowTitle = profile?.readTitle(in: window, start: start) ?? title
        if request.isBrowser { snapshot.windowTitle = TextCleanup.browserTitle(snapshot.windowTitle, appName: request.appName) }

        if request.isBrowser {
            // Browsers: title plus domain and path. Page text only with the policy and personal switches.
            snapshot.domainPath = BrowserURL.domainAndPath(BrowserURL.find(in: window))
            if request.rules.skipsDomain(snapshot.domainPath) {
                return finish(skipped(snapshot, .skippedDomain))
            }
        }
        if !request.isBrowser || request.readPageText {
            let root = profile?.readRoot(in: window, start: start) ?? window
            let walk = AXReader.walkText(root, start: start, skip: profile?.skipIdentifiers ?? [],
                                         dropAreaLabels: profile?.dropAreaLabels ?? false)
            // Both the record's title and the window's own (Mail's mailbox name and count).
            let lines = TextCleanup.dropTitleLines(TextCleanup.dropTitleLines(walk.lines, title: snapshot.windowTitle), title: title)
            snapshot.lines = TextCleanup.joinFragments(lines)
            snapshot.chars = snapshot.lines.reduce(0) { $0 + $1.count }
            snapshot.nodes = walk.nodes
            snapshot.stoppedBy = walk.stoppedBy
        }

        if request.rules.containsSkipWord(title: snapshot.windowTitle, lines: snapshot.lines) {
            return finish(skipped(snapshot, .skippedWord))
        }
        // Redact before the snapshot leaves this queue: nothing unredacted is ever stored (spec 2.4).
        let readMs = AXReader.elapsedMs(since: start)
        let redactStart = DispatchTime.now()
        Redactor.redact(&snapshot, options: request.redaction, names: request.names)
        var done = finish(snapshot)
        done.readMs = readMs
        done.redactMs = AXReader.elapsedMs(since: redactStart)
        return done
    }

    /// Drop everything read so far and keep only the reason.
    private static func skipped(_ snapshot: Snapshot, _ reason: SkipReason) -> Snapshot {
        var dropped = Snapshot(appBundleId: snapshot.appBundleId, appName: snapshot.appName)
        dropped.foundWindow = snapshot.foundWindow
        dropped.skip = reason
        return dropped
    }
}
