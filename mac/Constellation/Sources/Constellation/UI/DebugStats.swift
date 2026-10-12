import CaptureCore
import Foundation

/// Per-app counts for the debug view. Numbers only: never text, titles, or URLs.
@MainActor final class DebugStats: ObservableObject {
    struct AppRow: Identifiable {
        let id: String // bundle id
        var name: String
        var captures = 0
        var skips = 0
        var lastSkip = "-"
        var lastChars = 0
        var totalChars = 0
        var lastTitleChars = 0
        var urlFound: Bool? // browsers only
        var lastMs = 0.0
        var totalMs = 0.0
        var maxMs = 0.0
        var lastTrigger = "-"
        var redactions = 0
        var lastRedactMs = 0.0
        var totalRedactMs = 0.0
        var maxRedactMs = 0.0
        var lastAt: Date?

        var avgChars: Int { captures == 0 ? 0 : totalChars / captures }
        var avgMs: Double { captures == 0 ? 0 : totalMs / Double(captures) }
        var avgRedactMs: Double { captures == 0 ? 0 : totalRedactMs / Double(captures) }
    }

    @Published private(set) var rows: [String: AppRow] = [:]
    @Published private(set) var recordCount = 0
    @Published private(set) var storedChars = 0
    @Published private(set) var storeAvailable = true

    /// Fixed order, so rows don't jump around as captures come in.
    var sortedRows: [AppRow] {
        rows.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func record(_ snapshot: Snapshot, trigger: Trigger) {
        var row = rows[snapshot.appBundleId] ?? AppRow(id: snapshot.appBundleId, name: snapshot.appName)
        row.lastTrigger = trigger.rawValue
        row.lastAt = snapshot.capturedAt
        row.lastMs = snapshot.readMs
        row.maxMs = max(row.maxMs, snapshot.readMs)
        if let skip = snapshot.skip {
            row.skips += 1
            row.lastSkip = skip.rawValue
        } else {
            row.captures += 1
            row.lastChars = snapshot.chars
            row.totalChars += snapshot.chars
            row.totalMs += snapshot.readMs
            row.redactions += snapshot.redactionCount
            row.lastRedactMs = snapshot.redactMs
            row.totalRedactMs += snapshot.redactMs
            row.maxRedactMs = max(row.maxRedactMs, snapshot.redactMs)
            row.lastTitleChars = snapshot.windowTitle.count
            if AppInfo.isBrowser(snapshot.appBundleId) { row.urlFound = snapshot.domainPath != nil }
        }
        rows[snapshot.appBundleId] = row
    }

    /// Totals from the encrypted store; if it is unavailable, from the records in memory.
    func updateStore(_ totals: RecordStore.Totals?, storeAvailable: Bool, inMemory segmenter: Segmenter? = nil) {
        self.storeAvailable = storeAvailable
        if let totals {
            recordCount = totals.records
            storedChars = totals.chars
        } else if let segmenter {
            recordCount = segmenter.records.count
            storedChars = segmenter.records.reduce(0) { $0 + $1.text.count }
        }
    }

    func clear() {
        rows = [:]
        recordCount = 0
        storedChars = 0
    }
}
