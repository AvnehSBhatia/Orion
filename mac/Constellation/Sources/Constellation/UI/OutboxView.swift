import CaptureCore
import SwiftUI

/// The Outbox (spec 9): exactly what would leave this Mac, batched by stretches of capturing.
/// People can read, edit, delete, or approve. Names are highlighted so they are noticed.
struct OutboxView: View {
    @ObservedObject var model: OutboxModel
    @ObservedObject var settings: Settings
    @ObservedObject var sender: Sender
    @State private var editing: OutboxItem?
    @State private var showAllSent = false

    static let sentCollapsed = 5

    var body: some View {
        SpaceScreen {
            WindowHeader(title: "Outbox", subtitle: "Your company's AI summarizes each batch. Nothing is kept until you approve it.")
        } content: {
            NowCard(model: model, settings: settings)
            modeRow
            ConnectionCard(sender: sender, settings: settings, directory: sender.directory)
            if !model.available {
                Label("The encrypted store is unavailable, so there is nothing to show.", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.warning)
            }
            BatchSection(title: "Waiting for Review", empty: "Nothing to review.", batches: model.toReview,
                         kind: .review, model: model, connected: sender.isConnected, editing: $editing)
            BatchSection(title: "Approved", empty: "Nothing approved yet.", batches: model.approved,
                         kind: .approved, model: model, connected: sender.isConnected, editing: $editing)
            BatchSection(title: "Sent", empty: "Nothing sent yet.",
                         batches: showAllSent ? model.sent : Array(model.sent.prefix(Self.sentCollapsed)),
                         kind: .sent, model: model, connected: sender.isConnected, editing: $editing, total: model.sent.reduce(0) { $0 + $1.items.count })
            if model.sent.count > Self.sentCollapsed {
                Button(showAllSent ? "Show Fewer" : "Show All \(model.sent.count) Sent Batches") { showAllSent.toggle() }
                    .buttonStyle(LinkButtonStyle())
            }
        }
        .onAppear { model.refresh() }
        .sheet(item: $editing) { item in
            EditTextSheet(item: item) { text in
                model.saveEdit(item, text: text)
                editing = nil
            } onCancel: {
                editing = nil
            }
        }
    }

    // Mode and auto approve in one compact row, the explanation in small text.
    private var modeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: Theme.Space.l) {
                Picker("Mode", selection: $settings.outboxMode) {
                    Text("Review First").tag(OutboxMode.reviewFirst)
                    Text("Log Only").tag(OutboxMode.logOnly)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                if settings.outboxMode == .reviewFirst {
                    Toggle("Auto-approve after \(Limits.autoApproveMinutes) minutes", isOn: $settings.autoApprove)
                        .toggleStyle(.switch)
                        .controlSize(.small)
                }
                Spacer(minLength: 0)
            }
            Text(settings.outboxMode == .reviewFirst
                 ? "You approve batches before your company keeps them."
                 : "Batches are approved as soon as they close, and listed here as a log.")
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: Now

/// Whether anything new can arrive, and what's being captured right now. Without
/// it the Outbox looks frozen while capture is off or a record is still open.
private struct NowCard: View {
    @ObservedObject var model: OutboxModel
    @ObservedObject var settings: Settings

    var body: some View {
        GlassCard(emphasis: settings.state == .on ? .normal : .warning) {
            HStack(alignment: .top, spacing: Theme.Space.m) {
                GlowDot(color: dotColor).padding(.top, 6)
                VStack(alignment: .leading, spacing: 4) {
                    switch settings.state {
                    case .off:
                        Text(settings.policy.captureEnabled ? "Capture is off, so nothing new arrives here." : "Paused by your company.")
                    case .paused(let until):
                        Text("Paused until \(until.formatted(date: .omitted, time: .shortened)), so nothing new arrives here.")
                    case .on:
                        if let record = model.now {
                            let summary = ItemSummary(record)
                            HStack(spacing: Theme.Space.s) {
                                Text("Capturing now").foregroundStyle(Theme.textSecondary)
                                Image(systemName: summary.symbol).foregroundStyle(Theme.textSecondary)
                                Text(summary.headline).lineLimit(1).truncationMode(.tail)
                                if let detail = summary.detail {
                                    Text(detail).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                }
                            }
                            Text("It moves to Waiting for Review when you open another email, window, or app, or after \(Int(Limits.idleGapSeconds / 60)) minutes idle.")
                                .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text("Capture is on. Open one of your chosen apps, and it will appear here.")
                            Text("Reading: \(settings.allowed.isEmpty ? "no apps chosen yet" : "\(settings.allowed.count) \(settings.allowed.count == 1 ? "app" : "apps")")")
                                .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                        }
                    }
                }
                Spacer(minLength: Theme.Space.s)
                switch settings.state {
                case .off: Button("Turn On") { settings.captureOn = true }.buttonStyle(PrimaryButtonStyle(small: true))
                case .paused: Button("Resume") { settings.resume() }.buttonStyle(PrimaryButtonStyle(small: true))
                case .on: EmptyView()
                }
            }
        }
    }

    private var dotColor: Color {
        switch settings.state {
        case .on: model.now == nil ? Theme.textSecondary : Theme.success
        case .paused: Theme.warning
        case .off: Theme.danger
        }
    }
}

// MARK: Connection

/// One card: a glowing dot and one line of status; the address is editable only after Edit.
private struct ConnectionCard: View {
    @ObservedObject var sender: Sender
    @ObservedObject var settings: Settings
    @ObservedObject var directory: ClientDirectory
    @State private var editing = false
    @State private var url = ""
    @State private var code = ""

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: Theme.Space.m) {
                    GlowDot(color: dotColor)
                    Text(line).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: Theme.Space.s)
                    if sender.isConnected {
                        Button("Send Now") { sender.sendNow() }.buttonStyle(PrimaryButtonStyle(small: true))
                        Menu {
                            Button("Sync Clients") { Task { await sender.syncClients() } }
                            Divider()
                            Button("Disconnect", role: .destructive) { sender.disconnect() }
                        } label: {
                            Image(systemName: "ellipsis")
                        }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                        .help("More")
                    } else {
                        if !editing {
                            IconButton(symbol: "pencil", help: "Edit the backend address") {
                                url = settings.backendURL
                                editing = true
                            }
                        }
                        Button("Connect") {
                            Task { await sender.connect(urlText: editing ? url : settings.backendURL, authCode: code) }
                        }
                        .buttonStyle(PrimaryButtonStyle(small: true))
                        .disabled(sender.state == .connecting || code.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                if !sender.isConnected {
                    if editing {
                        TextField("Backend address, e.g. https://api.example.com", text: $url).spaceField()
                    }
                    TextField("Auth code", text: $code).spaceField()
                    Text("From the Orion web app: Settings → Connect your Mac").font(Theme.Typo.caption)
                        .foregroundStyle(Theme.textTertiary)
                    if editing { Button("Cancel") { editing = false }.buttonStyle(LinkButtonStyle(color: Theme.textSecondary)) }
                }
                if sender.isConnected, settings.consentPending {
                    ConsentNotice(sender: sender, settings: settings)
                }
                if sender.isConnected, settings.policy.browserPageText {
                    Toggle("Also read page text in browsers (your company allows it)", isOn: $settings.browserPageText)
                        .font(Theme.Typo.caption)
                }

                if case .failed(let message) = sender.state {
                    Text(message).font(Theme.Typo.caption).foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let error = sender.policyError, sender.isConnected {
                    Text("Company policy couldn't update. \(error)").font(Theme.Typo.caption).foregroundStyle(Theme.warning)
                }
                if sender.isConnected {
                    Text(clientsCaption).font(Theme.Typo.caption)
                        .foregroundStyle(directory.syncError == nil ? Theme.textTertiary : Theme.warning)
                } else if !editing {
                    Text(settings.backendURL).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                }
            }
        }
        .onChange(of: sender.isConnected) { _, connected in if connected { editing = false } }
    }

    private var host: String { sender.destination ?? settings.backendURL }

    private var line: String {
        switch sender.state {
        case .notConnected: return "Not connected. Approved items wait here."
        case .connecting: return "Connecting…"
        case .sending: return "Sending · \(host)"
        case .failed: return sender.isConnected ? "Connected · \(host) · couldn't send" : "Not connected"
        case .connected:
            let last = sender.lastSentAt.map { "last sent \($0.formatted(date: .omitted, time: .shortened))" } ?? "nothing sent yet"
            return "Connected · \(host) · \(last)"
        }
    }

    private var dotColor: Color {
        switch sender.state {
        case .connected: Theme.success
        case .sending, .connecting: Theme.warning
        case .failed: sender.isConnected ? Theme.warning : Theme.danger
        case .notConnected: Theme.danger
        }
    }

    private var clientsCaption: String {
        if let error = directory.syncError { return "Clients couldn't sync. \(error)" }
        guard let at = directory.list.syncedAt else { return "Clients not synced yet" }
        let count = directory.list.clients.count
        return "\(count) \(count == 1 ? "client" : "clients") synced \(at.formatted(date: .omitted, time: .shortened))"
    }
}

/// The company's monitoring notice. Nothing is sent until it is accepted.
private struct ConsentNotice: View {
    @ObservedObject var sender: Sender
    @ObservedObject var settings: Settings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your company's monitoring notice").font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
            ScrollView {
                Text((try? AttributedString(markdown: settings.policy.consent.notice,
                                            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                    ?? AttributedString(settings.policy.consent.notice))
                    .font(Theme.Typo.caption).frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 140)
            Text("Until you accept, nothing is sent.").font(Theme.Typo.caption).foregroundStyle(Theme.warning)
            Button("Accept and continue") { Task { await sender.acceptConsent() } }
                .buttonStyle(PrimaryButtonStyle(small: true))
                .disabled(sender.consentBusy)
        }
    }
}

// MARK: Batches

private struct BatchSection: View {
    enum Kind { case review, approved, sent }

    let title: String
    let empty: String
    let batches: [OutboxBatch]
    let kind: Kind
    let model: OutboxModel
    let connected: Bool
    @Binding var editing: OutboxItem?
    /// Items in the whole section, when only some batches are shown.
    var total: Int?

    var body: some View {
        let count = total ?? batches.reduce(0) { $0 + $1.items.count }
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: title, count: count, countColor: kind == .review && count > 0 ? Theme.warning : Theme.textSecondary)
            if batches.isEmpty {
                Text(empty).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
            } else {
                GlassCard(emphasis: kind == .review ? .warning : .normal, padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(batches.enumerated()), id: \.element.id) { index, batch in
                            if index > 0 { Divider().overlay(Color.white.opacity(0.06)) }
                            BatchRow(batch: batch, kind: kind, model: model, connected: connected, editing: $editing)
                        }
                    }
                }
            }
        }
    }
}

private struct BatchRow: View {
    let batch: OutboxBatch
    let kind: BatchSection.Kind
    @ObservedObject var model: OutboxModel // observed: summaries arrive after the batch is shown
    let connected: Bool
    @Binding var editing: OutboxItem?
    @State private var expanded: Bool
    @State private var confirmDelete = false

    init(batch: OutboxBatch, kind: BatchSection.Kind, model: OutboxModel, connected: Bool, editing: Binding<OutboxItem?>) {
        self.batch = batch
        self.kind = kind
        self.model = model
        self.connected = connected
        _editing = editing
        #if DEBUG
        _expanded = State(initialValue: batch.items.contains { $0.id == model.sampleOpen })
        #else
        _expanded = State(initialValue: false)
        #endif
    }

    /// "Email · Your Apple ID was used… · Web page · Pricing · +12 more": scan a batch without opening it.
    private var preview: String {
        let heads = batch.items.prefix(3).map { item -> String in
            let summary = ItemSummary(item.record)
            return "\(summary.kind): \(summary.headline)"
        }
        let more = batch.items.count - heads.count
        return heads.joined(separator: "  ·  ") + (more > 0 ? "  ·  +\(more) more" : "")
    }

    private func isSampleOpen(_ item: OutboxItem) -> Bool {
        #if DEBUG
        item.id == model.sampleOpen
        #else
        false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                Button { expanded.toggle() } label: {
                    HStack(spacing: Theme.Space.s) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                            .foregroundStyle(Theme.textSecondary)
                        Text(timeRange(batch.start, batch.end)).font(Theme.Typo.bodyStrong)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(expanded ? "Hide the items" : "Show the items")

                Chip(text: "\(batch.items.count) \(batch.items.count == 1 ? "item" : "items")")
                Chip(text: "\(batch.redactions) \(batch.redactions == 1 ? "redaction" : "redactions")")
                Spacer(minLength: Theme.Space.s)
                if kind == .review {
                    Button("Approve") { model.approve(batch) }.buttonStyle(PrimaryButtonStyle(small: true))
                }
                IconButton(symbol: "trash", help: "Delete this batch", color: Theme.danger) { confirmDelete = true }
            }
            summaryView.padding(.leading, 18)
            if !expanded {
                Text(preview)
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
                    .padding(.leading, 18)
            } else {
                Text("What was captured").font(Theme.Typo.caption.weight(.semibold)).foregroundStyle(Theme.textSecondary)
                    .padding(.leading, 18).padding(.top, 4)
                VStack(spacing: 0) {
                    ForEach(Array(batch.items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().overlay(Color.white.opacity(0.05)) }
                        ItemRow(item: item, match: model.match(item), sent: kind == .sent,
                                startOpen: isSampleOpen(item), onEdit: { editing = item }, onDelete: { model.delete([item.id]) })
                    }
                }
                .padding(.leading, 18)
            }
        }
        .padding(Theme.Space.m)
        .confirmationDialog("Delete \(batch.items.count) \(batch.items.count == 1 ? "item" : "items") permanently?",
                            isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { model.delete(batch.items.map(\.id)) }
        } message: {
            Text(kind == .sent ? "They're removed from this Mac. Copies already sent stay with the backend."
                               : "They're removed from this Mac, and the backend never keeps them.")
        }
    }

    /// The backend AI's summary: the first thing read in a batch.
    @ViewBuilder private var summaryView: some View {
        let summary = model.summaries[batch.id]
        if let text = summary?.text {
            VStack(alignment: .leading, spacing: 4) {
                Text(Highlight.apply(text))
                    .font(Theme.Typo.body)
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if summary?.state == .loading {
                    Text("Updating the summary…").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                } else if case .failed(let message) = summary?.state {
                    Text("Couldn't update the summary. \(message)").font(Theme.Typo.caption).foregroundStyle(Theme.warning)
                }
            }
        } else if summary?.state == .loading {
            HStack(spacing: Theme.Space.s) {
                ProgressView().controlSize(.small)
                Text("Summarizing…").font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
            }
        } else if case .failed(let message) = summary?.state {
            Text("Couldn't get a summary. \(message)").font(Theme.Typo.caption).foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
        } else if !connected {
            Text("Connect to the backend to see a summary of this batch.")
                .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
        }
    }
}

/// One item as a single readable line ("subject  from sender"); click to read it.
/// Details lists exactly what is sent, in words rather than code.
private struct ItemRow: View {
    let item: OutboxItem
    let match: ClientMatch?
    let sent: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void
    @State private var open: Bool
    @State private var showFull = false
    @State private var showDetails = false
    @State private var confirmDelete = false

    init(item: OutboxItem, match: ClientMatch?, sent: Bool, startOpen: Bool = false,
         onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.item = item
        self.match = match
        self.sent = sent
        self.onEdit = onEdit
        self.onDelete = onDelete
        _open = State(initialValue: startOpen)
        _showDetails = State(initialValue: startOpen) // debug renders only
    }

    private var summary: ItemSummary { ItemSummary(item.record) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                Button { open.toggle() } label: {
                    HStack(spacing: Theme.Space.s) {
                        Image(systemName: summary.symbol).foregroundStyle(Theme.textSecondary).frame(width: 16)
                        Text(summary.headline).lineLimit(1).truncationMode(.tail)
                        if let detail = summary.detail {
                            Text(detail).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(summary.headline + (summary.detail.map { " (\($0))" } ?? ""))
                Spacer(minLength: Theme.Space.s)
                Text(item.record.startedAt.formatted(date: .omitted, time: .shortened))
                    .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary).monospacedDigit()
                if !sent { IconButton(symbol: "pencil", help: "Edit the text", action: onEdit) } // what was sent can't change
                IconButton(symbol: "trash", help: "Delete this item", color: Theme.danger) { confirmDelete = true }
            }
            .padding(.vertical, 4)

            if open {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    let lines = ItemSummary.excerpt(item.record)
                    if item.record.text.isEmpty {
                        Text("Only the page title and address are captured for web pages.")
                            .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                    } else if lines.isEmpty {
                        Text("Only short labels were captured. Choose Show Full Text to see them.")
                            .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                                Text(Highlight.apply(line)).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    HStack(spacing: Theme.Space.l) {
                        if !item.record.text.isEmpty {
                            Button(showFull ? "Hide Full Text" : "Show Full Text") { showFull.toggle() }
                                .buttonStyle(LinkButtonStyle())
                        }
                        Button(showDetails ? "Hide Details" : "Show Details") { showDetails.toggle() }
                            .buttonStyle(LinkButtonStyle(color: Theme.textSecondary))
                    }
                    if showFull {
                        InsetPanel {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(Array(ItemSummary.lines(item.record).enumerated()), id: \.offset) { _, line in
                                        Text(Highlight.apply(line)).fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                .font(Theme.Typo.body)
                                .foregroundStyle(Theme.textPrimary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 260)
                        }
                    }
                    if showDetails { details }
                }
                .padding(.leading, 24)
                .padding(.bottom, Theme.Space.s)
            }
        }
        .confirmationDialog("Delete this item permanently?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive, action: onDelete)
        }
    }

    /// Every field the backend receives, as plain labelled rows.
    private var details: some View {
        let record = item.record
        let rows: [(String, String)] = [
            ("Status", status),
            ("Title", record.windowTitle.isEmpty ? "None" : record.windowTitle),
            record.domainPath.map { ("Address", $0) },
            ("App", record.appName),
            ("Time", timeRange(record.startedAt, record.endedAt)),
            ("Client", match?.client.name ?? "None"),
            ("Hidden details", record.redactionCount == 0 ? "None" : "\(record.redactionCount) replaced with markers like [EMAIL]"),
            ("Text", record.text.isEmpty ? "None" : "\(record.text.count) characters (Show Full Text)"),
        ].compactMap { $0 }
        return InsetPanel {
            VStack(alignment: .leading, spacing: 6) {
                Text("What the backend receives").font(Theme.Typo.caption.weight(.semibold)).foregroundStyle(Theme.textSecondary)
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Theme.Space.m, verticalSpacing: 6) {
                    ForEach(rows, id: \.0) { label, value in
                        GridRow {
                            Text(label).foregroundStyle(Theme.textTertiary)
                            Text(Highlight.apply(value)).foregroundStyle(Theme.textPrimary)
                                .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        }
                    }
                }
            }
            .font(Theme.Typo.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var status: String {
        if let sentAt = item.sentAt {
            return "Sent at \(sentAt.formatted(date: .omitted, time: .shortened)) to \(item.sentTo ?? "the backend")"
        }
        if let reason = item.rejectedReason, item.rejectedCount > 0 {
            return item.gaveUp ? "Not accepted by the server: \(reason)" : "Not accepted by the server: \(reason). Will try again."
        }
        if item.record.status == .approved { return "Approved, waiting to send" }
        return item.edited ? "Waiting for review (edited)" : "Waiting for review"
    }
}

// MARK: Edit

private struct EditTextSheet: View {
    let item: OutboxItem
    let onSave: (String) -> Void
    let onCancel: () -> Void
    @State private var text: String

    init(item: OutboxItem, onSave: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.item = item
        self.onSave = onSave
        self.onCancel = onCancel
        _text = State(initialValue: item.record.text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.m) {
            Text("Edit Text").font(Theme.Typo.windowTitle)
            HStack(spacing: 6) {
                Text("\(item.record.appName) · \(timeRange(item.record.startedAt, item.record.endedAt))")
                    .foregroundStyle(Theme.textSecondary)
                InfoButton(text: "Your edit is checked for private details again, with your redaction choices, before it is saved.")
            }
            TextEditor(text: $text)
                .font(Theme.Typo.body)
                .scrollContentBackground(.hidden)
                .padding(Theme.Space.s)
                .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.12)))
                .frame(minHeight: 260)
            HStack {
                Spacer()
                Button("Cancel", action: onCancel).buttonStyle(GhostButtonStyle()).keyboardShortcut(.cancelAction)
                Button("Save") { onSave(text) }.buttonStyle(PrimaryButtonStyle()).keyboardShortcut(.defaultAction)
            }
        }
        .padding(Theme.windowPadding)
        .frame(width: 620)
        .background(SpaceBackground())
        .foregroundStyle(Theme.textPrimary)
        .preferredColorScheme(.dark)
    }
}

// MARK: Helpers

/// Names get an amber highlight (spec 8: shown highlighted in the Outbox);
/// redaction markers like [EMAIL] are dimmed.
enum Highlight {
    private static let tokens = try! NSRegularExpression(pattern: #"\[(?:EMAIL|PHONE|CARD|SSN|ADDRESS|SECRET|IP|Person \d+)\]"#)

    static func apply(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        for range in NameDetector.ranges(in: text) {
            if let attributed = Range(range, in: result) {
                result[attributed].backgroundColor = Theme.warning.opacity(0.28)
                result[attributed].foregroundColor = Theme.textPrimary
            }
        }
        let whole = NSRange(text.startIndex..., in: text)
        for match in tokens.matches(in: text, range: whole) {
            if let stringRange = Range(match.range, in: text), let attributed = Range(stringRange, in: result) {
                result[attributed].foregroundColor = Theme.textTertiary
                result[attributed].backgroundColor = Color.white.opacity(0.08)
            }
        }
        return result
    }
}

private func timeRange(_ start: Date, _ end: Date) -> String {
    let day = Calendar.current.isDateInToday(start) ? "Today" : start.formatted(.dateTime.weekday(.abbreviated).month().day())
    let from = start.formatted(date: .omitted, time: .shortened), to = end.formatted(date: .omitted, time: .shortened)
    return from == to ? "\(day) \(from)" : "\(day) \(from)–\(to)"
}
