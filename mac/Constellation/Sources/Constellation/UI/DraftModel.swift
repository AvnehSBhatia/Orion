import CaptureCore
import AppKit
import Foundation
import UniformTypeIdentifiers

/// Today's draft, fetched from the backend, and the person's reviews of it.
@MainActor final class DraftModel: ObservableObject {
    @Published private(set) var draft: Draft?
    @Published private(set) var loading = false
    @Published var error: String?
    /// Entry being saved right now, to disable its buttons.
    @Published private(set) var saving: String?
    /// Set once "Done for Today" went through: how many entries were exported.
    @Published private(set) var exported: Int?
    @Published private(set) var finalizing = false
    @Published private(set) var downloading = false

    let sender: Sender
    private let settings: Settings
    private let store: RecordStore?

    init(sender: Sender, settings: Settings, store: RecordStore?) {
        self.sender = sender
        self.settings = settings
        self.store = store
    }

    #if DEBUG
    /// Fake entries for previews and screen renders. Never real captured text.
    func loadSample(finalized: Bool = false) {
        let now = Date()
        draft = Draft(draftId: "d1", day: "2026-10-14", entries: [
            DraftEntry(id: "s1", clientId: "c_acme", narrative: "Drafted the Acme renewal reply and checked the pricing table.",
                       minutes: 45, startedAt: now.addingTimeInterval(-7200), endedAt: now.addingTimeInterval(-4500),
                       evidence: [Evidence(workBlockId: "a", quote: "Renewal terms for Q4"), Evidence(workBlockId: "b", quote: "Pricing table v3"),
                                  Evidence(workBlockId: "c", quote: "Re: Acme renewal")], status: .accepted, edited: true),
            DraftEntry(id: "s2", clientId: "c_globex", narrative: "Reviewed the GLX-12 rollout notes and replied to the team.",
                       minutes: 30, startedAt: now.addingTimeInterval(-4000), endedAt: now.addingTimeInterval(-2200),
                       evidence: [Evidence(workBlockId: "d", quote: "GLX-12 rollout checklist"), Evidence(workBlockId: "e", quote: "Thanks, shipping Friday")]),
            DraftEntry(id: "s3", clientId: nil, narrative: "Read the quarterly planning document and other work with no client.",
                       minutes: 12, startedAt: now.addingTimeInterval(-1800), endedAt: now.addingTimeInterval(-1080),
                       evidence: [Evidence(workBlockId: "f", quote: "Quarterly planning draft")], unmatched: true),
        ])
        if finalized { exported = 3 }
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
    func review(_ entry: DraftEntry, action: DraftReview.Action, narrative description: String, minutes: Int, clientId: String?) async {
        var review = DraftReview(action: action)
        if action != .reject {
            let trimmed = String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(DraftReview.maxNarrative))
            if trimmed != entry.narrative {
                review.narrative = Redactor.redact(trimmed, options: settings.redaction).text
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

    var pendingCount: Int { draft?.entries.filter { $0.status == .pending }.count ?? 0 }

    /// POST /v1/drafts/:id/finalize
    func finalize() async {
        guard let id = draft?.draftId else { return }
        finalizing = true
        defer { finalizing = false }
        do {
            exported = try await sender.finalize(draft: id).exported
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// GET /v1/drafts/:id/export, then the save panel. Returns the file written, if any.
    func downloadCSV() async {
        guard let draft else { return }
        downloading = true
        defer { downloading = false }
        do {
            let data = try await sender.exportCSV(draft: draft.draftId)
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.commaSeparatedText]
            panel.nameFieldStringValue = "constellation-\(draft.day).csv"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            try data.write(to: url, options: .atomic)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension Sender {
    func finalize(draft id: String) async throws -> FinalizeResponse {
        try await withBackend { client, credentials in try await client.finalize(draft: id, credentials: credentials) }
    }

    func exportCSV(draft id: String) async throws -> Data {
        try await withBackend { client, credentials in try await client.exportCSV(draft: id, credentials: credentials) }
    }

    func saveBaseline(_ baseline: Baseline) async throws -> Baseline {
        try await withBackend { client, credentials in try await client.saveBaseline(baseline, credentials: credentials) }
    }
}
