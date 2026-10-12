import CaptureCore
import Foundation

/// What the Outbox window shows, read from the encrypted store.
@MainActor final class OutboxModel: ObservableObject {
    @Published private(set) var toReview: [OutboxBatch] = []
    @Published private(set) var approved: [OutboxBatch] = []
    @Published private(set) var sent: [OutboxBatch] = []
    var sender: Sender?
    static let sentShown = 100
    let available: Bool

    private let store: RecordStore?
    private let settings: Settings
    private let names: NameMasker

    init(store: RecordStore?, settings: Settings, names: NameMasker) {
        self.store = store
        self.settings = settings
        self.names = names
        self.available = store != nil
    }

    var toReviewCount: Int { toReview.reduce(0) { $0 + $1.items.count } }
    var approvedCount: Int { approved.reduce(0) { $0 + $1.items.count } }

    func refresh() {
        guard let store else { return }
        let items = (try? store.outbox([.queued, .approved])) ?? []
        toReview = OutboxBatch.group(items.filter { $0.record.status == .queued })
        approved = OutboxBatch.group(items.filter { $0.record.status == .approved })
        sent = OutboxBatch.group((try? store.outbox([.sent], limit: Self.sentShown)) ?? [])
    }

    func approve(_ batch: OutboxBatch) {
        try? store?.approve(batch.items.map(\.id))
        refresh()
        sender?.sendNow() // if connected, send right away
    }

    /// Permanent (spec 9).
    func delete(_ ids: [UUID]) {
        try? store?.delete(ids)
        refresh()
    }

    /// Edited text goes through the same redaction as captured text, so nothing
    /// typed into an edit can skip it.
    func saveEdit(_ item: OutboxItem, text: String) {
        var cleaned = Redactor.redact(text, options: settings.redaction).text
        if settings.maskNames { cleaned = names.mask(lines: [cleaned]).lines[0] }
        let count = Redactor.countTokens(in: item.record.windowTitle) + Redactor.countTokens(in: item.record.domainPath)
            + Redactor.countTokens(in: cleaned)
        try? store?.updateText(item.id, text: cleaned, redactionCount: count)
        refresh()
    }
}
