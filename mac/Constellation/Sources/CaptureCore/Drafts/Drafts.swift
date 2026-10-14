import Foundation

// The daily draft: time entries the backend builds from the day's work blocks,
// which the person accepts, edits, rejects, or moves to another client.

public struct Draft: Codable, Sendable, Equatable {
    /// The person's local day, "2026-10-13".
    public var date: String
    public var entries: [DraftEntry]

    public init(date: String, entries: [DraftEntry]) {
        self.date = date
        self.entries = entries
    }

    /// Minutes of everything not rejected.
    public var totalMinutes: Int { entries.filter { $0.status != .rejected }.reduce(0) { $0 + $1.minutes } }
}

public struct DraftEntry: Codable, Sendable, Equatable, Identifiable {
    public enum Status: String, Codable, Sendable {
        case pending, accepted, rejected
    }

    public var id: String
    public var clientId: String?
    public var description: String
    public var minutes: Int
    public var startedAt: Date?
    public var endedAt: Date?
    /// The work blocks this entry was made from.
    public var blockIds: [String]
    public var status: Status
    /// The person changed the description, minutes, or client.
    public var edited: Bool

    enum CodingKeys: String, CodingKey {
        case id, description, minutes, status, edited
        case clientId = "client_id"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case blockIds = "block_ids"
    }

    public init(id: String, clientId: String?, description: String, minutes: Int, startedAt: Date? = nil,
                endedAt: Date? = nil, blockIds: [String] = [], status: Status = .pending, edited: Bool = false) {
        self.id = id
        self.clientId = clientId
        self.description = description
        self.minutes = minutes
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.blockIds = blockIds
        self.status = status
        self.edited = edited
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        clientId = try c.decodeIfPresent(String.self, forKey: .clientId)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        minutes = try c.decodeIfPresent(Int.self, forKey: .minutes) ?? 0
        startedAt = try c.decodeIfPresent(Date.self, forKey: .startedAt)
        endedAt = try c.decodeIfPresent(Date.self, forKey: .endedAt)
        blockIds = try c.decodeIfPresent([String].self, forKey: .blockIds) ?? []
        status = try c.decodeIfPresent(Status.self, forKey: .status) ?? .pending
        edited = try c.decodeIfPresent(Bool.self, forKey: .edited) ?? false
    }
}

/// POST /v1/drafts/entries/:id/review
public struct DraftReview: Encodable, Sendable, Equatable {
    public enum Action: String, Encodable, Sendable {
        /// Approve the entry, with any changes included.
        case accept
        /// Not work to record.
        case reject
        /// Save changes and keep it pending.
        case edit
    }

    public var action: Action
    public var description: String?
    public var minutes: Int?
    /// Only sent when `changeClient` is true; then nil means "no client".
    public var clientId: String?
    public var changeClient: Bool

    public init(action: Action, description: String? = nil, minutes: Int? = nil, clientId: String? = nil, changeClient: Bool = false) {
        self.action = action
        self.description = description
        self.minutes = minutes
        self.clientId = clientId
        self.changeClient = changeClient
    }

    enum CodingKeys: String, CodingKey {
        case action, description, minutes
        case clientId = "client_id"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        try c.encodeIfPresent(description, forKey: .description)
        try c.encodeIfPresent(minutes, forKey: .minutes)
        // An explicit null moves the entry to "no client"; leaving the key out keeps the client.
        if changeClient { try c.encode(clientId, forKey: .clientId) }
    }

    /// Minutes allowed for one entry.
    public static let minuteRange = 1...1_440
    public static let maxDescription = 500
}

public extension Int {
    /// "45 min", "1 h 05 min", "2 h".
    var asDuration: String {
        let hours = self / 60, minutes = self % 60
        if hours == 0 { return "\(minutes) min" }
        return minutes == 0 ? "\(hours) h" : String(format: "%d h %02d min", hours, minutes)
    }
}
