import CaptureCore
import Foundation

/// Today's draft, fetched from the backend, and the person's reviews of it.
@MainActor final class DraftModel: ObservableObject {
    @Published private(set) var draft: Draft?
    @Published private(set) var loading = false
    @Published var error: String?
    /// Entry being saved right now, to disable its buttons.
    @Published private(set) var saving: String?

    let sender: Sender
    private let settings: Settings
    private let store: RecordStore?

    init(sender: Sender, settings: Settings, store: RecordStore?) {
        self.sender = sender
        self.settings = settings
        self.store = store
    }

    /// The work blocks an entry was made from, as kept on this Mac (read only, for the
    /// "From N work blocks" evidence). Blocks no longer on this Mac are simply missing.
    func evidence(for entry: DraftEntry) -> [OutboxItem] {
        guard let store, !entry.blockIds.isEmpty else { return [] }
        let ids = Set(entry.blockIds)
        let items = (try? store.outbox([.sent, .approved, .queued], limit: 2_000)) ?? []
        return items.filter { ids.contains($0.id.uuidString) }.sorted { $0.record.startedAt < $1.record.startedAt }
    }

    #if DEBUG
    /// Fake entries for previews and screen renders. Never real captured text.
    func loadSample() {
        let now = Date()
        draft = Draft(date: "2026-10-14", entries: [
            DraftEntry(id: "s1", clientId: "c_acme", description: "Drafted the Acme renewal reply and checked the pricing table.",
                       minutes: 45, startedAt: now.addingTimeInterval(-7200), endedAt: now.addingTimeInterval(-4500),
                       blockIds: ["a", "b", "c"], status: .accepted, edited: true),
            DraftEntry(id: "s2", clientId: "c_globex", description: "Reviewed the GLX-12 rollout notes and replied to the team.",
                       minutes: 30, startedAt: now.addingTimeInterval(-4000), endedAt: now.addingTimeInterval(-2200), blockIds: ["d", "e"]),
            DraftEntry(id: "s3", clientId: nil, description: "Read the quarterly planning document.",
                       minutes: 12, startedAt: now.addingTimeInterval(-1800), endedAt: now.addingTimeInterval(-1080), blockIds: ["f"]),
        ])
    }
    #endif

    func refresh() async {
        guard sender.isConnected else {
            error = BackendError.notConnected.localizedDescription
            return
        }
        loading = true
        defer { loading = false }
        do {
            draft = try await sender.fetchDraft()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Accept, reject, or save changes. An edited description goes through the
    /// person's redaction choices first, like anything else they send.
    func review(_ entry: DraftEntry, action: DraftReview.Action, description: String, minutes: Int, clientId: String?) async {
        var review = DraftReview(action: action)
        if action != .reject {
            let trimmed = String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(DraftReview.maxDescription))
            if trimmed != entry.description {
                review.description = Redactor.redact(trimmed, options: settings.redaction).text
            }
            let clamped = min(max(minutes, DraftReview.minuteRange.lowerBound), DraftReview.minuteRange.upperBound)
            if clamped != entry.minutes { review.minutes = clamped }
            if clientId != entry.clientId {
                review.clientId = clientId
                review.changeClient = true
            }
        }
        saving = entry.id
        defer { saving = nil }
        do {
            let updated = try await sender.review(entry: entry.id, review)
            if let index = draft?.entries.firstIndex(where: { $0.id == updated.id }) {
                draft?.entries[index] = updated
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
