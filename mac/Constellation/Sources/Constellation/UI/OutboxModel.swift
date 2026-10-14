import CaptureCore
import Foundation

/// What the Outbox window shows, read from the encrypted store.
@MainActor final class OutboxModel: ObservableObject {
    @Published private(set) var toReview: [OutboxBatch] = []
    @Published private(set) var approved: [OutboxBatch] = []
    @Published private(set) var sent: [OutboxBatch] = []
    /// The record still being written; it joins "Waiting for review" when it closes.
    @Published var now: ActivityRecord?
    var sender: Sender?
    var directory: ClientDirectory?
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

    #if DEBUG
    /// Fake items for previews and screen renders. Never real captured text.
    /// Debug renders only: this item is drawn already open.
    var sampleOpen: UUID?

    func loadSample() {
        func item(_ minutesAgo: Double, _ bundle: String, _ app: String, _ title: String, _ text: String,
                  domainPath: String? = nil, status: RecordStatus) -> OutboxItem {
            let end = Date().addingTimeInterval(-minutesAgo * 60)
            let record = ActivityRecord(
                id: UUID(), startedAt: end.addingTimeInterval(-240), endedAt: end, appBundleId: bundle, appName: app,
                windowTitle: title, domainPath: domainPath, text: text, textHash: "", redactionCount: Redactor.countTokens(in: text),
                status: status, snapshotCount: 1
            )
            return OutboxItem(record: record, sentAt: status == .sent ? end.addingTimeInterval(120) : nil,
                              sentTo: status == .sent ? "localhost:8787" : nil)
        }
        let mail = "com.apple.mail"
        let renewal = item(5, mail, "Mail", "Re: Acme renewal — Jane Doe", """
            message headers
            Jane Doe
            To: [EMAIL]
            Summarize
            Hi Jane, the renewal draft is attached with the updated seat count.
            I moved the start date to November so it lines up with your budget year.
            Call me at [PHONE] if anything in section 4 looks off.
            Thanks,
            """, status: .queued)
        sampleOpen = renewal.id
        now = item(0, mail, "Mail", "Q4 roadmap review — Priya Shah", "", status: .local).record
        toReview = OutboxBatch.group([
            renewal,
            item(8, mail, "Mail", "Pricing questions — Globex", "Thanks Tom, here are the GLX-12 numbers we discussed on Monday.", status: .queued),
            item(12, "com.google.Chrome", "Google Chrome", "Pricing – Initech", "", domainPath: "initech.com/pricing", status: .queued),
            item(16, "com.microsoft.VSCode", "Code", "invoice.ts — acme-billing", "export function total(lines: Line[]) {\nreturn lines.reduce((sum, line) => sum + line.amount, 0)", status: .queued),
        ])
        approved = []
        sent = OutboxBatch.group((0..<7).map { index in
            item(Double(60 + index * 35), mail, "Mail", "Weekly update \(index + 1) — Acme", "Status notes for the week are below, and the open questions are at the end.", status: .sent)
        })
    }
    #endif

    func approve(_ batch: OutboxBatch) {
        try? store?.approve(batch.items.map(\.id))
        refresh()
        sender?.sendNow() // if connected, send right away
    }

    func match(_ item: OutboxItem) -> ClientMatch? { directory?.match(item.record) }

    /// False until a client list has synced, so "No client" isn't shown when nothing could match.
    var hasClients: Bool { directory?.list.clients.isEmpty == false }

    /// The JSON shown under "What will be sent": exactly what the sender posts.
    func preview(_ item: OutboxItem) -> String { (directory?.payload(for: item) ?? item.payload).preview }

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
