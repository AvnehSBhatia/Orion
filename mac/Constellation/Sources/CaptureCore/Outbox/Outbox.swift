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

    public var id: UUID { record.id }

    public init(record: ActivityRecord, queuedAt: Date? = nil, approvedAt: Date? = nil, sentAt: Date? = nil,
                edited: Bool = false, sentTo: String? = nil) {
        self.record = record
        self.queuedAt = queuedAt
        self.approvedAt = approvedAt
        self.sentAt = sentAt
        self.edited = edited
        self.sentTo = sentTo
    }

    /// Exactly what the sender will post for this item.
    public var payload: WorkBlockPayload { WorkBlockPayload(record) }
}

/// Items grouped into 30 minute slots, so people approve a stretch of time, not every window.
public struct OutboxBatch: Identifiable, Sendable {
    public let start: Date
    public let items: [OutboxItem]

    public var id: Date { start }
    public var end: Date { start.addingTimeInterval(Limits.outboxBatchSeconds) }
    public var redactions: Int { items.reduce(0) { $0 + $1.record.redactionCount } }

    /// Newest batch first; items oldest first within a batch.
    public static func group(_ items: [OutboxItem]) -> [OutboxBatch] {
        let slot = Limits.outboxBatchSeconds
        let grouped = Dictionary(grouping: items) { item in
            Date(timeIntervalSince1970: (item.record.endedAt.timeIntervalSince1970 / slot).rounded(.down) * slot)
        }
        return grouped
            .map { OutboxBatch(start: $0.key, items: $0.value.sorted { $0.record.startedAt < $1.record.startedAt }) }
            .sorted { $0.start > $1.start }
    }
}

/// One work block as sent to POST /v1/work-blocks. Shown verbatim in the Outbox,
/// so what people approve is exactly what is sent. Only these fields, nothing else.
public struct WorkBlockPayload: Codable, Sendable, Equatable {
    public var id: String
    public var startedAt: Date
    public var endedAt: Date
    public var appBundleId: String
    public var appName: String
    public var windowTitle: String
    public var domainPath: String?
    public var text: String
    public var redactionCount: Int
    /// Set by on-device client matching (a later step); nil until then.
    public var clientId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case appBundleId = "app_bundle_id"
        case appName = "app_name"
        case windowTitle = "window_title"
        case domainPath = "domain_path"
        case text
        case redactionCount = "redaction_count"
        case clientId = "client_id"
    }

    public init(_ record: ActivityRecord, clientId: String? = nil) {
        id = record.id.uuidString
        startedAt = record.startedAt
        endedAt = record.endedAt
        appBundleId = record.appBundleId
        appName = record.appName
        windowTitle = record.windowTitle
        domainPath = record.domainPath
        text = record.text
        redactionCount = record.redactionCount
        self.clientId = clientId
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
