import Foundation

// The Outbox (spec 9): nothing leaves the Mac unless it appears here first.

public enum OutboxMode: String, Sendable, CaseIterable {
    /// Items wait for approval (or auto approval after Limits.autoApproveMinutes, if on).
    case reviewFirst
    /// Items are approved as soon as they close; the Outbox is a log of what was sent.
    case logOnly
}

/// A closed record in the Outbox, with its review history.
public struct OutboxItem: Identifiable, Sendable {
    public var record: ActivityRecord
    public var queuedAt: Date?
    public var approvedAt: Date?
    public var sentAt: Date?
    public var edited: Bool
    /// Where it was sent, e.g. "localhost:8787".
    public var sentTo: String?
    /// The server's last reason for not accepting it ("card_number"), and how many
    /// times in a row it gave that reason.
    public var rejectedReason: String?
    public var rejectedCount: Int

    public var id: UUID { record.id }

    /// The sender stops trying after this many rejections for the same reason.
    public static let maxRejections = 3

    public init(record: ActivityRecord, queuedAt: Date? = nil, approvedAt: Date? = nil, sentAt: Date? = nil,
                edited: Bool = false, sentTo: String? = nil, rejectedReason: String? = nil, rejectedCount: Int = 0) {
        self.record = record
        self.queuedAt = queuedAt
        self.approvedAt = approvedAt
        self.sentAt = sentAt
        self.edited = edited
        self.sentTo = sentTo
        self.rejectedReason = rejectedReason
        self.rejectedCount = rejectedCount
    }

    /// Rejected `maxRejections` times for the same reason: no longer sent.
    public var gaveUp: Bool { rejectedCount >= Self.maxRejections }

    /// What the sender would post for this item with no client matched.
    public var payload: WorkBlockPayload { WorkBlockPayload(record) }
}

/// Items grouped into stretches of capturing, so people approve a stretch of time, not every window.
public struct OutboxBatch: Identifiable, Sendable {
    /// Never empty.
    public let items: [OutboxItem]

    public var id: UUID { items[0].id }
    /// When capturing started and stopped in this stretch: the first and last thing captured.
    public var start: Date { items[0].record.startedAt }
    public var end: Date { items.map(\.record.endedAt).max() ?? start }
    public var redactions: Int { items.reduce(0) { $0 + $1.record.redactionCount } }

    /// One batch per stretch of capturing: items stay together until nothing was
    /// captured for more than `Limits.batchGapSeconds`. Newest batch first; items
    /// oldest first within a batch.
    public static func group(_ items: [OutboxItem]) -> [OutboxBatch] {
        var batches: [[OutboxItem]] = []
        var lastEnd = Date.distantPast
        for item in items.sorted(by: { $0.record.startedAt < $1.record.startedAt }) {
            if batches.isEmpty || item.record.startedAt.timeIntervalSince(lastEnd) > Limits.batchGapSeconds {
                batches.append([item])
            } else {
                batches[batches.count - 1].append(item)
            }
            lastEnd = max(lastEnd, item.record.endedAt)
        }
        return batches.reversed().map { OutboxBatch(items: $0) }
    }
}

/// Which client a block was matched to, and how (decision B).
public struct BlockMatch: Sendable, Equatable {
    public var clientId: String?
    public var method: MatchMethod
    public var confidence: Double

    public init(clientId: String?, method: MatchMethod, confidence: Double) {
        self.clientId = clientId
        self.method = method
        self.confidence = confidence
    }

    public static let none = BlockMatch(clientId: nil, method: .none, confidence: 0)

    public init(_ match: ClientMatch?) {
        if let match {
            self.init(clientId: match.client.id, method: match.method, confidence: match.confidence)
        } else {
            self = .none
        }
    }
}

/// One work block as sent to POST /v1/work-blocks (docs/mac-v1.md). Shown in the
/// Outbox, so what people approve is exactly what is sent. Only these fields.
public struct WorkBlockPayload: Codable, Sendable, Equatable {
    /// The record's UUID: resends always carry the same id.
    public var localId: String
    public var startedAt: Date
    public var endedAt: Date
    public var appBundleId: String
    public var appName: String
    public var windowTitle: String
    public var domainPath: String?
    public var matchedClientId: String?
    public var matchMethod: MatchMethod
    public var matchConfidence: Double
    /// The redacted text cut to `snippetLimit` characters.
    public var snippet: String
    /// SHA-256 hex of the full local text.
    public var textHash: String
    public var redactionCount: Int

    public static let snippetLimit = 1_500

    enum CodingKeys: String, CodingKey {
        case localId = "local_id"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case appBundleId = "app_bundle_id"
        case appName = "app_name"
        case windowTitle = "window_title"
        case domainPath = "domain_path"
        case matchedClientId = "matched_client_id"
        case matchMethod = "match_method"
        case matchConfidence = "match_confidence"
        case snippet
        case textHash = "text_hash"
        case redactionCount = "redaction_count"
    }

    public init(_ record: ActivityRecord, match: BlockMatch = .none) {
        localId = record.id.uuidString
        startedAt = record.startedAt
        endedAt = record.endedAt
        appBundleId = record.appBundleId
        appName = record.appName
        windowTitle = record.windowTitle
        domainPath = record.domainPath
        matchedClientId = match.clientId
        // "none" whenever no client is sent; "manual" only says the person chose.
        matchMethod = match.clientId == nil && match.method != .manual ? .none : match.method
        matchConfidence = match.clientId == nil ? 0 : (match.confidence * 100).rounded() / 100
        snippet = String(record.text.prefix(Self.snippetLimit))
        textHash = Segmenter.hash(record.text)
        redactionCount = record.redactionCount
    }

    /// Nil fields are sent as null, so the backend sees every field.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(localId, forKey: .localId)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(endedAt, forKey: .endedAt)
        try c.encode(appBundleId, forKey: .appBundleId)
        try c.encode(appName, forKey: .appName)
        try c.encode(windowTitle, forKey: .windowTitle)
        try c.encode(domainPath, forKey: .domainPath)
        try c.encode(matchedClientId, forKey: .matchedClientId)
        try c.encode(matchMethod, forKey: .matchMethod)
        try c.encode(matchConfidence, forKey: .matchConfidence)
        try c.encode(snippet, forKey: .snippet)
        try c.encode(textHash, forKey: .textHash)
        try c.encode(redactionCount, forKey: .redactionCount)
    }

    /// SHA-256 hex of the sorted local ids joined by newlines.
    public static func batchHash(_ blocks: [WorkBlockPayload]) -> String {
        Segmenter.hash(blocks.map(\.localId).sorted().joined(separator: "\n"))
    }

    public static func encoder(pretty: Bool = false) -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes] : [.sortedKeys]
        return encoder
    }

    /// The JSON shown in the Outbox's "what will be sent" view.
    public var preview: String {
        (try? String(decoding: Self.encoder(pretty: true).encode(self), as: UTF8.self)) ?? ""
    }
}
