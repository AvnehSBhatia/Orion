import Foundation

// The daily draft: time entries the backend builds from the day's work blocks,
// which the person accepts, edits, rejects, or moves to another client, then
// finalizes with "Done for Today" (decision C). Shapes in docs/mac-v1.md.

public struct Draft: Codable, Sendable, Equatable {
    public var draftId: String
    /// The person's local day, "2026-10-13".
    public var day: String
    public var entries: [DraftEntry]

    enum CodingKeys: String, CodingKey {
        case entries, day
        case draftId = "draft_id"
    }

    public init(draftId: String, day: String, entries: [DraftEntry]) {
        self.draftId = draftId
        self.day = day
        self.entries = entries
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        draftId = try c.decode(String.self, forKey: .draftId)
        day = try c.decodeIfPresent(String.self, forKey: .day) ?? ""
        entries = try c.decodeIfPresent([DraftEntry].self, forKey: .entries) ?? []
    }

    /// Minutes of everything not rejected.
    public var totalMinutes: Int { entries.filter { $0.status != .rejected }.reduce(0) { $0 + $1.minutes } }
}

/// A verbatim quote from one work block, the evidence behind an entry's narrative.
public struct Evidence: Codable, Sendable, Equatable, Hashable {
    /// The block's `local_id`, so the Mac can show the item it came from.
    public var workBlockId: String
    public var quote: String

    enum CodingKeys: String, CodingKey {
        case quote
        case workBlockId = "work_block_id"
    }

    public init(workBlockId: String, quote: String) {
        self.workBlockId = workBlockId
        self.quote = quote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workBlockId = try c.decode(String.self, forKey: .workBlockId)
        quote = try c.decodeIfPresent(String.self, forKey: .quote) ?? ""
    }
}

public struct DraftEntry: Codable, Sendable, Equatable, Identifiable {
    /// The app's three states. The server's `proposed` is pending, and `edited` is
    /// accepted with `edited` set.
    public enum Status: String, Codable, Sendable {
        case pending, accepted, rejected
    }

    public var id: String
    public var clientId: String?
    public var narrative: String
    public var minutes: Int
    public var startedAt: Date?
    public var endedAt: Date?
    public var evidence: [Evidence]
    /// The day's blocks with no client, in one entry.
    public var unmatched: Bool
    public var status: Status
    /// The person changed the narrative, minutes, or client.
    public var edited: Bool

    enum CodingKeys: String, CodingKey {
        case id, narrative, minutes, status, evidence, unmatched
        case clientId = "client_id"
        case startedAt = "started_at"
        case endedAt = "ended_at"
    }

    public init(id: String, clientId: String?, narrative: String, minutes: Int, startedAt: Date? = nil,
                endedAt: Date? = nil, evidence: [Evidence] = [], unmatched: Bool = false, status: Status = .pending,
                edited: Bool = false) {
        self.id = id
        self.clientId = clientId
        self.narrative = narrative
        self.minutes = minutes
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.evidence = evidence
        self.unmatched = unmatched
        self.status = status
        self.edited = edited
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        clientId = try c.decodeIfPresent(String.self, forKey: .clientId)
        narrative = try c.decodeIfPresent(String.self, forKey: .narrative) ?? ""
        minutes = try c.decodeIfPresent(Int.self, forKey: .minutes) ?? 0
        startedAt = try c.decodeIfPresent(Date.self, forKey: .startedAt)
        endedAt = try c.decodeIfPresent(Date.self, forKey: .endedAt)
        evidence = try c.decodeIfPresent([Evidence].self, forKey: .evidence) ?? []
        unmatched = try c.decodeIfPresent(Bool.self, forKey: .unmatched) ?? false
        (status, edited) = Self.status(from: try c.decodeIfPresent(String.self, forKey: .status))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(clientId, forKey: .clientId)
        try c.encode(narrative, forKey: .narrative)
        try c.encode(minutes, forKey: .minutes)
        try c.encodeIfPresent(startedAt, forKey: .startedAt)
        try c.encodeIfPresent(endedAt, forKey: .endedAt)
        try c.encode(evidence, forKey: .evidence)
        try c.encode(unmatched, forKey: .unmatched)
        let wire = switch status {
        case .pending: "proposed"
        case .accepted: edited ? "edited" : "accepted"
        case .rejected: "rejected"
        }
        try c.encode(wire, forKey: .status)
    }

    /// proposed → pending, edited → accepted and edited. Unknown values read as pending.
    static func status(from wire: String?) -> (Status, Bool) {
        switch wire {
        case "accepted": (.accepted, false)
        case "edited": (.accepted, true)
        case "rejected": (.rejected, false)
        default: (.pending, false)
        }
    }

    /// The work blocks behind this entry, once each, in order.
    public var blockIds: [String] {
        var seen = Set<String>()
        return evidence.map(\.workBlockId).filter { seen.insert($0).inserted }
    }
}

/// POST /v1/drafts/entries/{id}/review
public struct DraftReview: Encodable, Sendable, Equatable {
    public enum Action: String, Encodable, Sendable {
        /// Approve the entry, with any changes included.
        case accept
        /// Not work to record.
        case reject
        /// Save changes.
        case edit
    }

    public var action: Action
    public var narrative: String?
    public var minutes: Int?
    /// Only sent when `changeClient` is true; then nil means "no client".
    public var clientId: String?
    public var changeClient: Bool

    public init(action: Action, narrative: String? = nil, minutes: Int? = nil, clientId: String? = nil, changeClient: Bool = false) {
        self.action = action
        self.narrative = narrative
        self.minutes = minutes
        self.clientId = clientId
        self.changeClient = changeClient
    }

    enum CodingKeys: String, CodingKey {
        case action, narrative, minutes
        case clientId = "client_id"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        try c.encodeIfPresent(narrative, forKey: .narrative)
        try c.encodeIfPresent(minutes, forKey: .minutes)
        // An explicit null moves the entry to "no client"; leaving the key out keeps the client.
        if changeClient { try c.encode(clientId, forKey: .clientId) }
    }

    /// Minutes allowed for one entry.
    public static let minuteRange = 1...1_440
    public static let maxNarrative = 500
}

/// The review reply: `{ entry }`.
public struct DraftReviewResponse: Codable, Sendable {
    public var entry: DraftEntry
}

/// POST /v1/drafts/{id}/finalize
public struct FinalizeResponse: Codable, Sendable, Equatable {
    /// How many entries went into the export.
    public var exported: Int

    public init(exported: Int) {
        self.exported = exported
    }
}

/// POST /v1/baseline: the person's usual timesheet for one day, before Constellation.
public struct Baseline: Codable, Sendable, Equatable {
    public struct Entry: Codable, Sendable, Equatable {
        public var clientId: String
        public var minutes: Int

        enum CodingKeys: String, CodingKey {
            case minutes
            case clientId = "client_id"
        }

        public init(clientId: String, minutes: Int) {
            self.clientId = clientId
            self.minutes = minutes
        }
    }

    /// "2026-10-13"
    public var day: String
    public var entries: [Entry]

    public init(day: String, entries: [Entry]) {
        self.day = day
        self.entries = entries
    }

    /// "2026-10-13" for a date in the given calendar's time zone.
    public static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// The week to fill in: the seven days ending yesterday, oldest first.
    public static func week(endingBefore today: Date, calendar: Calendar = .current) -> [Date] {
        let start = calendar.startOfDay(for: today)
        return (1...7).reversed().compactMap { calendar.date(byAdding: .day, value: -$0, to: start) }
    }
}

public extension Int {
    /// "45 min", "1 h 05 min", "2 h".
    var asDuration: String {
        let hours = self / 60, minutes = self % 60
        if hours == 0 { return "\(minutes) min" }
        return minutes == 0 ? "\(hours) h" : String(format: "%d h %02d min", hours, minutes)
    }
}
