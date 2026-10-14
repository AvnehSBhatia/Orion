import CaptureCore
import SwiftUI

/// Today's time entries, drafted by the backend from the work blocks sent today.
/// Each can be accepted, rejected, edited (description, time), or moved to another client.
struct DraftView: View {
    @ObservedObject var model: DraftModel
    @ObservedObject var directory: ClientDirectory

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Today's draft").font(.title2.bold())
                Text(dateText).foregroundStyle(.secondary)
                Spacer()
                if model.loading { ProgressView().controlSize(.small) }
                Button("Refresh") { Task { await model.refresh() } }
            }
            Text("Time entries made from the work you sent today. Check each one: accept it, fix the description, time, or client, or reject it.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let draft = model.draft {
                let pending = draft.entries.filter { $0.status == .pending }.count
                Text("Total \(draft.totalMinutes.asDuration) · \(draft.entries.count) entries · \(pending) to review")
                    .font(.headline)
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let draft = model.draft, draft.entries.isEmpty {
                        Text("Nothing yet today. Entries appear once work blocks have been sent.").foregroundStyle(.secondary)
                    }
                    ForEach(model.draft?.entries ?? []) { entry in
                        EntryRow(entry: entry, model: model, clients: directory.list.clients)
                            .id("\(entry.id)-\(entry.status)-\(entry.description)-\(entry.minutes)-\(entry.clientId ?? "")")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(20)
        .frame(minWidth: 760, minHeight: 520)
        .task { await model.refresh() }
    }

    private var dateText: String {
        Date().formatted(date: .complete, time: .omitted)
    }
}

private struct EntryRow: View {
    let entry: DraftEntry
    let model: DraftModel
    let clients: [Client]
    @State private var description: String
    @State private var minutes: Int
    @State private var clientId: String?

    init(entry: DraftEntry, model: DraftModel, clients: [Client]) {
        self.entry = entry
        self.model = model
        self.clients = clients
        _description = State(initialValue: entry.description)
        _minutes = State(initialValue: entry.minutes)
        _clientId = State(initialValue: entry.clientId)
    }

    private var changed: Bool {
        description != entry.description || minutes != entry.minutes || clientId != entry.clientId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Picker("Client", selection: $clientId) {
                    Text("No client").tag(String?.none)
                    ForEach(clients) { Text($0.name).tag(Optional($0.id)) }
                    if let id = entry.clientId, !clients.contains(where: { $0.id == id }) {
                        Text("Unknown client (\(id))").tag(Optional(id)) // not in the synced list yet
                    }
                }
                .frame(width: 260)
                Stepper(value: $minutes, in: DraftReview.minuteRange, step: 5) {
                    Text(minutes.asDuration).monospacedDigit().frame(minWidth: 90, alignment: .leading)
                }
                if let start = entry.startedAt, let end = entry.endedAt {
                    Text("\(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusBadge(status: entry.status, edited: entry.edited)
            }

            TextField("Description", text: $description, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)
                .strikethrough(entry.status == .rejected)

            HStack {
                Text("From \(entry.blockIds.count) work \(entry.blockIds.count == 1 ? "block" : "blocks")")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                if changed {
                    Button("Revert") {
                        description = entry.description
                        minutes = entry.minutes
                        clientId = entry.clientId
                    }
                    Button("Save changes") { submit(.edit) }
                }
                Button("Reject", role: .destructive) { submit(.reject) }
                    .disabled(entry.status == .rejected && !changed)
                Button(changed ? "Accept with changes" : "Accept") { submit(.accept) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(entry.status == .accepted && !changed)
            }
            .disabled(model.saving == entry.id)
        }
        .padding(12)
        .background(.quaternary.opacity(entry.status == .rejected ? 0.2 : 0.45), in: RoundedRectangle(cornerRadius: 8))
        .opacity(entry.status == .rejected ? 0.7 : 1)
    }

    private func submit(_ action: DraftReview.Action) {
        Task { await model.review(entry, action: action, description: description, minutes: minutes, clientId: clientId) }
    }
}

private struct StatusBadge: View {
    let status: DraftEntry.Status
    let edited: Bool

    var body: some View {
        HStack(spacing: 6) {
            if edited { Text("edited").font(.caption).foregroundStyle(.secondary) }
            Text(label)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(color.opacity(0.15), in: Capsule())
                .foregroundStyle(color)
        }
    }

    private var label: String {
        switch status {
        case .pending: "To review"
        case .accepted: "Accepted"
        case .rejected: "Rejected"
        }
    }

    private var color: Color {
        switch status {
        case .pending: .orange
        case .accepted: .green
        case .rejected: .secondary
        }
    }
}
