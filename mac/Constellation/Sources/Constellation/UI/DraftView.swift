import CaptureCore
import SwiftUI

/// Today's time entries, drafted by the backend from the work blocks sent today.
/// Each can be accepted, rejected, edited (description, time), or moved to another client.
struct DraftView: View {
    @ObservedObject var model: DraftModel
    @ObservedObject var directory: ClientDirectory
    var embedded = false
    var batchesWaiting = 0
    var connected = true
    var appsChosen = true
    var onOutbox: () -> Void = {}
    var onApps: () -> Void = {}
    var onSettings: () -> Void = {}
    var onBaseline: (() -> Void)? = nil
    var macFooter: String? = nil

    var body: some View {
        SpaceScreen(embedded: embedded) {
            WindowHeader(
                title: "Today",
                detail: Date().formatted(.dateTime.weekday(.wide).month(.wide).day()),
                subtitle: promise,
                eyebrow: "Workspace / Today",
                statusLabel: connected ? "Connected" : "Not connected",
                statusColor: connected ? Theme.success : Theme.warning
            ) {
                if model.loading { ProgressView().controlSize(.small) }
                IconButton(symbol: "arrow.clockwise", help: "Refresh") { Task { await model.refresh() } }
            }
            if let draft = model.draft, !draft.entries.isEmpty {
                HStack(spacing: Theme.Space.s) {
                    StatusPill(icon: "clock", text: draft.totalMinutes.asDuration, color: Theme.accent)
                    StatusPill(icon: "list.bullet", text: "\(keptCount(draft)) \(keptCount(draft) == 1 ? "entry" : "entries")")
                    StatusPill(icon: "star", text: pendingLabel, color: model.pendingCount > 0 ? Theme.warning : Theme.success)
                }
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
            }
        } content: {
            cue
            timesheet
            if embedded, let macFooter { macStatus(macFooter) }
        }
        .task { await model.refresh() }
    }

    /// What this page is for, in the state the person is actually in.
    private var promise: String {
        guard let draft = model.draft else { return "Your timesheet, written from the work you already did." }
        if draft.entries.isEmpty {
            if !connected { return "Your timesheet, written from the work you already did." }
            return "Approving a batch in the Outbox is what fills this page. You confirm the day. You do not rewrite it."
        }
        let names = clientNames(in: draft)
        let who = names.isEmpty
            ? "with no client yet"
            : "for \(names.prefix(3).joined(separator: ", "))\(names.count > 3 ? " +\(names.count - 3)" : "")"
        if model.exported != nil {
            return "\(draft.totalMinutes.asDuration) \(who). This day is finished, and the CSV is the record."
        }
        if model.pendingCount == 0 {
            return "\(draft.totalMinutes.asDuration) \(who). Every entry is reviewed. Done for today locks it."
        }
        return "\(draft.totalMinutes.asDuration) \(who). Confirm what is right. The writing is already done."
    }

    private var pendingLabel: String {
        model.pendingCount > 0 ? "\(model.pendingCount) to confirm" : "All confirmed"
    }

    private func keptCount(_ draft: Draft) -> Int {
        draft.entries.filter { $0.status != .rejected }.count
    }

    private func clientNames(in draft: Draft) -> [String] {
        var seen = Set<String>()
        return draft.entries.filter { $0.status != .rejected }.compactMap { entry -> String? in
            guard let id = entry.clientId, seen.insert(id).inserted else { return nil }
            return directory.list.clients.first { $0.id == id }?.name ?? "A client"
        }
    }

    private var emptyMessage: String {
        if batchesWaiting > 0 { return "Work is waiting in the Outbox. Approve it, and it shows up here as time by client." }
        if !appsChosen { return "No apps are turned on, so nothing is being read." }
        if !connected { return "This Mac is not connected yet, so finished work cannot be drafted into a timesheet." }
        return "Keep working in an app you turned on. When a stretch finishes and you approve it, the entry appears here."
    }

    @ViewBuilder private var timesheet: some View {
        if let draft = model.draft, !draft.entries.isEmpty {
            ForEach(draft.entries) { entry in
                EntryCard(entry: entry, model: model, clients: directory.list.clients)
                    .id("\(entry.id)-\(entry.status)-\(entry.edited)-\(entry.narrative)-\(entry.minutes)-\(entry.clientId ?? "")")
            }
            DoneForToday(model: model)
            baselineLink
        } else if !connected {
            awaitingConnection
        } else if model.draft != nil || model.error != nil {
            emptyTimesheet
        }
    }

    private var awaitingConnection: some View {
        GlassCard {
            VStack(spacing: Theme.Space.m) {
                Text("Your daily timesheet")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.1)
                    .foregroundStyle(Theme.textTertiary)
                    .textCase(.uppercase)
                Text("Awaiting connection")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.1)
                    .foregroundStyle(Theme.warning)
                    .textCase(.uppercase)
                OrbitalIllustration()
                    .frame(maxWidth: 264, minHeight: 140, maxHeight: 160)
                Text("A little space for your day.")
                    .font(.system(size: 16))
                Text("Today’s timesheet will appear here once this Mac is connected.")
                    .font(Theme.Typo.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
                baselineLink
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.m)
        }
    }

    private var emptyTimesheet: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            GlassCard {
                VStack(spacing: Theme.Space.m) {
                    OrbitalIllustration()
                        .frame(maxWidth: 220, minHeight: 120, maxHeight: 140)
                    Text("Nothing on today's timesheet yet")
                        .font(Theme.Typo.bodyStrong)
                    Text(emptyMessage)
                        .font(Theme.Typo.subtitle)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 440)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Space.s)
            }
            baselineLink
        }
    }

    @ViewBuilder private var baselineLink: some View {
        if onBaseline != nil {
            Button("Compare with your usual timesheet") { onBaseline?() }
                .buttonStyle(LinkButtonStyle())
        }
    }

    private func macStatus(_ line: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text("On this Mac")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.1)
                    .foregroundStyle(Theme.textTertiary)
                    .textCase(.uppercase)
                Text("Constellation").font(Theme.Typo.bodyStrong)
            }
            Spacer(minLength: Theme.Space.s)
            Text(line)
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.top, Theme.Space.s)
    }

    @ViewBuilder private var cue: some View {
        if batchesWaiting > 0 {
            NextStepBanner(
                message: "\(batchesWaiting) \(batchesWaiting == 1 ? "item is" : "items are") still on this Mac. Approving \(batchesWaiting == 1 ? "it" : "them") writes today's timesheet.",
                button: "Review in Outbox",
                action: onOutbox
            )
        } else if !connected {
            NextStepBanner(
                message: "Connect this Mac. Until you do, today's timesheet cannot arrive.",
                button: "Connect",
                action: onSettings
            )
        } else if !appsChosen {
            NextStepBanner(
                message: "Turn on the apps you work in. Nothing else on this Mac is read.",
                button: "Choose apps",
                action: onApps
            )
        }
    }
}

/// The end of the day: finalize, then the CSV.
private struct DoneForToday: View {
    @ObservedObject var model: DraftModel

    var body: some View {
        GlassCard {
            if let exported = model.exported {
                HStack(spacing: Theme.Space.m) {
                    StarBadge(kind: .accepted)
                    Text("Exported \(exported) \(exported == 1 ? "entry" : "entries")").font(Theme.Typo.bodyStrong)
                    Spacer(minLength: Theme.Space.s)
                    Button("Download CSV") { Task { await model.downloadCSV() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.downloading)
                }
            } else {
                HStack(spacing: Theme.Space.m) {
                    Text(model.pendingCount > 0 ? "\(model.pendingCount) still to review" : "Everything is reviewed")
                        .font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: Theme.Space.s)
                    Button("Done for Today") { Task { await model.finalize() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(model.finalizing)
                }
            }
        }
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
        _description = State(initialValue: entry.narrative)
        _minutes = State(initialValue: entry.minutes)
        _clientId = State(initialValue: entry.clientId)
    }

    private var changed: Bool {
        description != entry.narrative || minutes != entry.minutes || clientId != entry.clientId
    }

    private var badge: StarBadge.Kind {
        switch entry.status {
        case .accepted: .accepted
        case .rejected: .rejected
        case .pending: clientId == nil ? .noClient : .needsReview
        }
    }

    var body: some View {
        GlassCard(emphasis: (clientId == nil || entry.unmatched) && entry.status != .rejected ? .dashed : .normal) {
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
                Button("No Client") { clientId = nil }
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
                    description = entry.narrative
                    minutes = entry.minutes
                    clientId = entry.clientId
                }
                .buttonStyle(LinkButtonStyle(color: Theme.textSecondary))
                Button("Save") { submit(.edit) }.buttonStyle(GhostButtonStyle(small: true))
            }

            if entry.status != .pending, !changed, !reopened {
                // The badge already says Accepted or Rejected. There is no "back to pending"
                // in the API, so this reopens the choice rather than undoing it on the server.
                Button("Change Decision") { reopened = true }.buttonStyle(LinkButtonStyle())
            } else {
                Button("Reject") { submit(.reject) }.buttonStyle(GhostButtonStyle(small: true, color: Theme.danger))
                Button(changed ? "Accept with Changes" : "Accept") { submit(.accept) }
                    .buttonStyle(PrimaryButtonStyle(small: true))
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    /// The quotes the entry was written from, each under the block it came from.
    private var evidence: some View {
        InsetPanel {
            VStack(alignment: .leading, spacing: 4) {
                if entry.evidence.isEmpty {
                    Text("No quotes kept for this entry.")
                }
                ForEach(Array(entry.evidence.enumerated()), id: \.offset) { _, item in
                    Text("\u{201C}\(item.quote)\u{201D}").lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
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
        Task { await model.review(entry, action: action, narrative: description, minutes: minutes, clientId: clientId) }
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
