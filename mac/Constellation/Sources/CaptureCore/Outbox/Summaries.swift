import CryptoKit
import Foundation

// POST /v1/summaries: the backend's AI summarizes a batch while it waits in the
// Outbox, so people read a summary instead of raw captured text. The blocks are
// the same redacted payloads POST /v1/work-blocks would get. The backend must not
// keep them or the summary; only approved, sent blocks are stored (decision D).

public struct SummaryRequest: Codable, Sendable {
    public var blocks: [WorkBlockPayload]

    public init(blocks: [WorkBlockPayload]) { self.blocks = blocks }
}

public struct SummaryResponse: Codable, Sendable, Equatable {
    /// Plain text, a few sentences, about what was done.
    public var summary: String

    public init(summary: String) {
        self.summary = summary
    }
}

extension OutboxBatch {
    /// Changes whenever what would be summarized changes: an item added, deleted, or edited.
    public var signature: String {
        var hasher = SHA256()
        for item in items {
            for part in [item.id.uuidString, item.record.windowTitle, item.record.domainPath ?? "", item.record.text] {
                hasher.update(data: Data(part.utf8))
                hasher.update(data: Data([0]))
            }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
