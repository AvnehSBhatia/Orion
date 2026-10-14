import CaptureCore
import SwiftUI

/// Today's time entries, drafted by the backend from the work blocks sent today.
/// Each can be accepted, rejected, edited (description, time), or moved to another client.
struct DraftView: View {
    @ObservedObject var model: DraftModel
    @ObservedObject var directory: ClientDirectory

    var body: some View {
        SpaceScreen {
            WindowHeader(
                title: "Today's draft",
                detail: Date().formatted(.dateTime.weekday(.wide).month(.wide).day()),
                subtitle: "Review each entry. Accept, edit or reject."
            ) {
                if model.loading { ProgressView().controlSize(.small) }
                IconButton(symbol: "arrow.clockwise", help: "Refresh") { Task { await model.refresh() } }
            }
            if let draft = model.draft {
                HStack(spacing: Theme.Space.s) {
                    StatusPill(icon: "clock", text: draft.totalMinutes.asDuration, color: Theme.textPrimary)
                    StatusPill(icon: "list.bullet", text: "\(draft.entries.count) \(draft.entries.count == 1 ? "entry" : "entries")")
                    let pending = draft.entries.filter { $0.status == .pending }.count
                    StatusPill(icon: "star", text: "\(pending) to review", color: pending > 0 ? Theme.warning : Theme.textSecondary)
                }
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
            }
        } content: {
            if let draft = model.draft, draft.entries.isEmpty {
                EmptyState(title: "Nothing yet today", message: "Entries appear here once work blocks have been sent.")
            }
            ForEach(model.draft?.entries ?? []) { entry in
                EntryCard(entry: entry, model: model, clients: directory.list.clients)
                    .id("\(entry.id)-\(entry.status)-\(entry.description)-\(entry.minutes)-\(entry.clientId ?? "")")
            }
        }
        .task { await model.refresh() }
    }
}

private struct EntryCard: View {
    let entry: DraftEntry
    let model: DraftModel
    let clients: [Client]
    @State private var description: String
    @State private var minutes: Int
    @State private var clientId: String?
    @State private var editingText = false
    @State private var showEvidence = false
    /// After accepting or rejecting, the buttons come back only when asked for.
    @State private var reopened = false
    @FocusState private var textFocused: Bool

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

    private var badge: StarBadge.Kind {
        switch entry.status {
        case .accepted: .accepted
        case .rejected: .rejected
        case .pending: clientId == nil ? .noClient : .needsReview
        }
    }

    var body: some View {
        GlassCard(emphasis: clientId == nil && entry.status != .rejected ? .dashed : .normal) {
            VStack(alignment: .leading, spacing: Theme.Space.m) {
                topRow
                descriptionView
                bottomRow
                if showEvidence { evidence }
            }
        }
        .opacity(entry.status == .rejected ? 0.65 : 1)
        .disabled(model.saving == entry.id)
    }

    // Client pill, minutes, time range, badge.
    private var topRow: some View {
        HStack(spacing: Theme.Space.m) {
            Menu {
                Button("No client") { clientId = nil }
                Divider()
                ForEach(clients) { client in Button(client.name) { clientId = client.id } }
            } label: {
                Text(clientName).font(Theme.Typo.bodyStrong)
                    .foregroundStyle(clientId == nil ? Theme.textSecondary : Theme.textPrimary)
            }
            .pillMenu()
            .help("Change the client")

            HStack(spacing: 2) {
                IconButton(symbol: "minus", help: "5 minutes less") { minutes = max(DraftReview.minuteRange.lowerBound, minutes - 5) }
                Text(minutes.asDuration).font(Theme.Typo.bodyStrong).monospacedDigit().frame(minWidth: 72)
                IconButton(symbol: "plus", help: "5 minutes more") { minutes = min(DraftReview.minuteRange.upperBound, minutes + 5) }
            }

            if let start = entry.startedAt, let end = entry.endedAt {
                Text("\(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))")
                    .font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: Theme.Space.s)
            // With no client, the pill already says "Pick a client": the ghost star alone.
            StarBadge(kind: badge, label: badge == .noClient ? "" : nil)
        }
    }

    // Plain text, editable on click.
    @ViewBuilder private var descriptionView: some View {
        if editingText {
            TextField("Description", text: $description, axis: .vertical)
                .lineLimit(1...5)
                .focused($textFocused)
                .spaceField()
                .onSubmit { editingText = false }
                .onChange(of: textFocused) { _, focused in if !focused { editingText = false } }
        } else {
            Text(description.isEmpty ? "Add a description" : description)
                .foregroundStyle(description.isEmpty ? Theme.textTertiary : Theme.textPrimary)
                .lineLimit(2)
                .strikethrough(entry.status == .rejected)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    editingText = true
                    textFocused = true
                }
                .help("Click to edit")
                .accessibilityAddTraits(.isButton)
        }
    }

    private var bottomRow: some View {
        HStack(spacing: Theme.Space.s) {
            Button {
                showEvidence.toggle()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: showEvidence ? "chevron.down" : "chevron.right").font(.system(size: 9, weight: .semibold))
                    Text("From \(entry.blockIds.count) work \(entry.blockIds.count == 1 ? "block" : "blocks")")
                }
            }
            .buttonStyle(LinkButtonStyle(color: Theme.textTertiary))

            Spacer(minLength: Theme.Space.s)

            if changed {
                Button("Revert") {
                    description = entry.description
                    minutes = entry.minutes
                    clientId = entry.clientId
                }
                .buttonStyle(LinkButtonStyle(color: Theme.textSecondary))
                Button("Save") { submit(.edit) }.buttonStyle(GhostButtonStyle(small: true))
            }

            if entry.status != .pending, !changed, !reopened {
                // The badge already says Accepted or Rejected. There is no "back to pending"
                // in the API, so this reopens the choice rather than undoing it on the server.
                Button("Change decision") { reopened = true }.buttonStyle(LinkButtonStyle())
            } else {
                Button("Reject") { submit(.reject) }.buttonStyle(GhostButtonStyle(small: true, color: Theme.danger))
                Button(changed ? "Accept with changes" : "Accept") { submit(.accept) }
                    .buttonStyle(PrimaryButtonStyle(small: true))
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    private var evidence: some View {
        let blocks = model.evidence(for: entry)
        return InsetPanel {
            VStack(alignment: .leading, spacing: 4) {
                if blocks.isEmpty {
                    Text("These blocks aren't on this Mac any more.")
                }
                ForEach(blocks) { item in
                    Text("\(item.record.startedAt.formatted(date: .omitted, time: .shortened))  \(item.record.appName)  \(item.record.windowTitle)")
                        .lineLimit(1)
                }
                if !blocks.isEmpty, blocks.count < entry.blockIds.count {
                    Text("\(entry.blockIds.count - blocks.count) more not on this Mac")
                }
            }
        }
    }

    private var clientName: String {
        guard let clientId else { return "Pick a client" }
        return clients.first { $0.id == clientId }?.name ?? "Unknown client"
    }

    private func submit(_ action: DraftReview.Action) {
        editingText = false
        reopened = false
        Task { await model.review(entry, action: action, description: description, minutes: minutes, clientId: clientId) }
    }
}

#if DEBUG
/// Fake sample data only.
struct DraftView_Previews: PreviewProvider {
    static var previews: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Acme Corp").font(Theme.Typo.bodyStrong).pillMenuPreview()
                    Text("45 min").font(Theme.Typo.bodyStrong)
                    Spacer()
                    StarBadge(kind: .needsReview)
                }
                Text("Drafted the Acme renewal reply and checked the pricing table.")
                StarBadge(kind: .noClient)
                StarBadge(kind: .accepted)
            }
        }
        .padding(24)
        .frame(width: 600)
        .background(SpaceBackground())
        .preferredColorScheme(.dark)
    }
}

private extension View {
    func pillMenuPreview() -> some View {
        padding(.horizontal, 10).padding(.vertical, 3).background(Color.white.opacity(0.07), in: Capsule())
    }
}
#endif
