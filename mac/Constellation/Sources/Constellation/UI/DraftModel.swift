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

    init(sender: Sender, settings: Settings) {
        self.sender = sender
        self.settings = settings
    }

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
