import Foundation

/// What caused a capture (spec 5.2).
public enum Trigger: String, Sendable {
    case appSwitch = "app switch"
    case reread = "re-read"
    case windowChange = "window change"
    case titleChange = "title change"
    case selectionChange = "selection change"
    case contentChange = "content change"
    case idleReturn = "back from idle"
}

/// Why a capture did not happen or was thrown away.
public enum SkipReason: String, Sendable {
    case off = "capture off"
    case paused = "paused"
    case systemUnavailable = "screen locked or asleep"
    case noPermission = "no Accessibility permission"
    case notAllowed = "app not turned on"
    case blockedApp = "blocked app"
    case privateWindow = "private window"
    case skippedDomain = "skipped domain"
    case skippedWord = "skipped word"
}

/// One read of the focused window, taken off the main thread. The text lives in
/// memory only and goes to the segmenter; it is never logged.
public struct Snapshot: Sendable {
    public var appBundleId: String
    public var appName: String
    public var windowTitle: String = ""
    /// Browsers only: domain and path, with no query string or fragment.
    public var domainPath: String?
    /// Distinct text from the window. Always empty for browsers (title and URL only).
    public var lines: [String] = []
    public var chars = 0
    public var readMs = 0.0 // reading the window (the 100 ms budget)
    public var redactMs = 0.0 // redacting what was read, measured separately
    public var nodes = 0
    public var stoppedBy: String?
    public var foundWindow = false
    /// Redaction tokens put into this snapshot (M2).
    public var redactionCount = 0
    public var skip: SkipReason?
    public var capturedAt = Date()

    public init(appBundleId: String, appName: String) {
        self.appBundleId = appBundleId
        self.appName = appName
    }
}

/// local: still being written. queued: closed, waiting in the Outbox for review.
/// approved: waiting for the sender. sent: delivered. (Deleting removes the row.)
public enum RecordStatus: String, Sendable {
    case local, queued, approved, sent, deleted
}

/// A stretch of work in one app and window (spec 5.5).
public struct ActivityRecord: Identifiable, Sendable {
    public let id: UUID
    public var startedAt: Date
    public var endedAt: Date
    public let appBundleId: String
    public let appName: String
    public let windowTitle: String
    /// Browsers: domain and path only (the spec's `domain?`, widened to include the path).
    public let domainPath: String?
    /// Redacted, deduplicated text, capped at Limits.maxRecordChars. The title and
    /// domain and path are redacted too.
    public var text: String
    public var textHash: String
    public var redactionCount: Int
    public var status: RecordStatus
    public var snapshotCount: Int
}
