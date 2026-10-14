import CryptoKit
import Foundation

// Groups snapshots into activity records (spec 5.5). A new record starts when the
// app, window title, or browser page changes, or after an idle gap. Within a
// record only lines not seen before are kept, up to Limits.maxRecordChars.
// M1 keeps records in memory only.

public struct Segmenter: Sendable {
    public enum Outcome: Equatable, Sendable {
        case newRecord
        case appended(chars: Int)
        case unchanged
    }

    public private(set) var records: [ActivityRecord] = []
    private var seenLines = Set<String>() // lines already in the current record
    private var finished = false // the current record was ended early; the next snapshot starts a new one

    public init() {}

    public var current: ActivityRecord? { records.last }

    /// The record still being written, if any.
    public var open: ActivityRecord? { finished ? nil : current }

    /// End the current record now, e.g. when the user leaves its app, instead of
    /// waiting for the idle gap. Returns false if nothing was open.
    @discardableResult
    public mutating func finishCurrent() -> Bool {
        guard current != nil, !finished else { return false }
        finished = true
        return true
    }

    @discardableResult
    public mutating func ingest(_ snapshot: Snapshot) -> Outcome {
        guard snapshot.skip == nil, snapshot.foundWindow else { return .unchanged }

        if let current, !finished, continues(current, with: snapshot) {
            let added = append(snapshot.lines)
            records[records.count - 1].endedAt = snapshot.capturedAt
            records[records.count - 1].snapshotCount += 1
            return added > 0 ? .appended(chars: added) : .unchanged
        }

        records.append(ActivityRecord(
            id: UUID(), startedAt: snapshot.capturedAt, endedAt: snapshot.capturedAt,
            appBundleId: snapshot.appBundleId, appName: snapshot.appName, windowTitle: snapshot.windowTitle,
            domainPath: snapshot.domainPath, text: "", textHash: Self.hash(""), redactionCount: 0,
            status: .local, snapshotCount: 1
        ))
        seenLines = []
        finished = false
        append(snapshot.lines)
        updateRedactionCount()
        if records.count > Limits.maxRecordsInMemory { records.removeFirst(records.count - Limits.maxRecordsInMemory) }
        return .newRecord
    }

    /// Delete all (spec 2.7). Records exist only in memory in M1, so this is everything.
    public mutating func clear() {
        records = []
        seenLines = []
        finished = false
    }

    private func continues(_ record: ActivityRecord, with snapshot: Snapshot) -> Bool {
        record.appBundleId == snapshot.appBundleId
            && record.windowTitle == snapshot.windowTitle
            && record.domainPath == snapshot.domainPath
            && snapshot.capturedAt.timeIntervalSince(record.endedAt) <= Limits.idleGapSeconds
    }

    /// Adds unseen lines to the current record. Returns the characters added.
    @discardableResult
    private mutating func append(_ lines: [String]) -> Int {
        guard !records.isEmpty else { return 0 }
        var text = records[records.count - 1].text
        var added = 0
        for line in lines where !seenLines.contains(line) {
            seenLines.insert(line)
            let separator = text.isEmpty ? "" : "\n"
            let room = Limits.maxRecordChars - text.count - separator.count
            guard room > 0 else { break }
            let kept = line.count <= room ? line : String(line.prefix(room))
            text += separator + kept
            added += kept.count
        }
        if added > 0 {
            records[records.count - 1].text = text
            records[records.count - 1].textHash = Self.hash(text)
            updateRedactionCount()
        }
        return added
    }

    /// Tokens actually present in what the record keeps (title, domain and path, text).
    private mutating func updateRedactionCount() {
        guard let record = records.last else { return }
        records[records.count - 1].redactionCount = Redactor.countTokens(in: record.windowTitle)
            + Redactor.countTokens(in: record.domainPath) + Redactor.countTokens(in: record.text)
    }

    static func hash(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
