import CaptureCore
import SwiftUI

/// The Outbox (spec 9): exactly what would leave this Mac, in 30 minute batches.
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
            WindowHeader(title: "Outbox", subtitle: "Nothing leaves this Mac until it's here first.")
        } content: {
            modeRow
            ConnectionCard(sender: sender, settings: settings, directory: sender.directory)
            if !model.available {
                Label("The encrypted store is unavailable, so there is nothing to show.", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.warning)
            }
            BatchSection(title: "Waiting for review", empty: "Nothing to review.", batches: model.toReview,
                         kind: .review, model: model, editing: $editing)
            BatchSection(title: "Approved", empty: "Nothing approved yet.", batches: model.approved,
                         kind: .approved, model: model, editing: $editing)
            BatchSection(title: "Sent", empty: "Nothing sent yet.",
                         batches: showAllSent ? model.sent : Array(model.sent.prefix(Self.sentCollapsed)),
                         kind: .sent, model: model, editing: $editing, total: model.sent.reduce(0) { $0 + $1.items.count })
            if model.sent.count > Self.sentCollapsed {
                Button(showAllSent ? "Show fewer" : "Show all \(model.sent.count) sent batches") { showAllSent.toggle() }
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
                    Text("Review first").tag(OutboxMode.reviewFirst)
                    Text("Log only").tag(OutboxMode.logOnly)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                if settings.outboxMode == .reviewFirst {
                    Toggle("Auto approve after \(Limits.autoApproveMinutes) min", isOn: $settings.autoApprove)
                        .toggleStyle(.switch)
                        .controlSize(.small)
                }
                Spacer(minLength: 0)
            }
            Text(settings.outboxMode == .reviewFirst
                 ? "You approve batches before they're sent."
                 : "Batches are approved as soon as they close, and listed here as a log.")
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textSecondary)
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
                        Button("Send now") { sender.sendNow() }.buttonStyle(PrimaryButtonStyle(small: true))
                        Menu {
                            Button("Sync clients") { Task { await sender.syncClients() } }
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
                            Task { await sender.connect(urlText: editing ? url : settings.backendURL, enrollmentCode: code) }
                        }
                        .buttonStyle(PrimaryButtonStyle(small: true))
                        .disabled(sender.state == .connecting)
                    }
                }

                if editing && !sender.isConnected {
                    TextField("Backend address, e.g. https://api.example.com", text: $url).spaceField()
                    TextField("Enrollment code, only if your company gave you one", text: $code).spaceField()
                    Button("Cancel") { editing = false }.buttonStyle(LinkButtonStyle(color: Theme.textSecondary))
                }

                if case .failed(let message) = sender.state {
                    Text(message).font(Theme.Typo.caption).foregroundStyle(Theme.warning)
                        .fixedSize(horizontal: false, vertical: true)
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
        case .notConnected: return "Not connected · approved items wait here"
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

// MARK: Batches

private struct BatchSection: View {
    enum Kind { case review, approved, sent }

    let title: String
    let empty: String
    let batches: [OutboxBatch]
    let kind: Kind
    let model: OutboxModel
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
                            BatchRow(batch: batch, kind: kind, model: model, editing: $editing)
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
    let model: OutboxModel
    @Binding var editing: OutboxItem?
    @State private var expanded: Bool
    @State private var confirmDelete = false

    init(batch: OutboxBatch, kind: BatchSection.Kind, model: OutboxModel, editing: Binding<OutboxItem?>) {
        self.batch = batch
        self.kind = kind
        self.model = model
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
                if kind == .sent { StarBadge(kind: .sent, label: "") }
                Spacer(minLength: Theme.Space.s)
                if kind == .review {
                    Button("Approve") { model.approve(batch) }.buttonStyle(PrimaryButtonStyle(small: true))
                }
                IconButton(symbol: "trash", help: "Delete this batch", color: Theme.danger) { confirmDelete = true }
            }
            if !expanded {
                Text(preview)
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .padding(.leading, 18)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(batch.items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().overlay(Color.white.opacity(0.05)) }
                        ItemRow(item: item, match: model.match(item), preview: model.preview(item), sent: kind == .sent,
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
                               : "They're removed from this Mac and never sent.")
        }
    }
}

/// One item as a single readable line ("Email · subject · from sender"); click to
/// read a short excerpt, the full text, or the exact data that is sent.
private struct ItemRow: View {
    let item: OutboxItem
    let match: ClientMatch?
    let preview: String
    let sent: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void
    @State private var open: Bool
    @State private var showFull = false
    @State private var showData = false
    @State private var confirmDelete = false

    init(item: OutboxItem, match: ClientMatch?, preview: String, sent: Bool, startOpen: Bool = false,
         onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.item = item
        self.match = match
        self.preview = preview
        self.sent = sent
        self.onEdit = onEdit
        self.onDelete = onDelete
        _open = State(initialValue: startOpen)
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
                .help(open ? "Hide" : "Read it")
                Spacer(minLength: Theme.Space.s)
                if let match {
                    Label(match.client.name, systemImage: "star.fill")
                        .font(Theme.Typo.caption.weight(.medium))
                        .foregroundStyle(Theme.success)
                        .lineLimit(1)
                        .help("Matched by \(match.reason)")
                } else {
                    StarBadge(kind: .noClient, label: "No client")
                }
                Text(item.record.startedAt.formatted(date: .omitted, time: .shortened))
                    .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary).monospacedDigit()
                if !sent { IconButton(symbol: "pencil", help: "Edit the text", action: onEdit) } // what was sent can't change
                IconButton(symbol: "trash", help: "Delete this item", color: Theme.danger) { confirmDelete = true }
            }
            .padding(.vertical, 4)

            if open {
                VStack(alignment: .leading, spacing: Theme.Space.s) {
                    HStack(spacing: Theme.Space.s) {
                        Chip(text: summary.kind)
                        Text("\(item.record.appName) · \(timeRange(item.record.startedAt, item.record.endedAt))")
                            .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                        if item.record.redactionCount > 0 {
                            Chip(text: "\(item.record.redactionCount) \(item.record.redactionCount == 1 ? "redaction" : "redactions")")
                        }
                        if item.edited { Chip(text: "edited") }
                        if let sentAt = item.sentAt {
                            Text("sent \(sentAt.formatted(date: .omitted, time: .shortened)) to \(item.sentTo ?? "the backend")")
                                .font(Theme.Typo.caption).foregroundStyle(Theme.line)
                        }
                    }
                    let lines = ItemSummary.excerpt(item.record)
                    if item.record.text.isEmpty {
                        Text("No text: browsers send the title and address only.")
                            .font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                    } else if lines.isEmpty {
                        Text("Only short labels were captured. Open the full text to see them.")
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
                            Button(showFull ? "Hide full text" : "Show full text") { showFull.toggle() }
                                .buttonStyle(LinkButtonStyle())
                        }
                        Button(showData ? "Hide exact data" : "Show exact data") { showData.toggle() }
                            .buttonStyle(LinkButtonStyle(color: Theme.textSecondary))
                    }
                    if showFull {
                        InsetPanel {
                            ScrollView {
                                Text(Highlight.apply(item.record.text))
                                    .font(Theme.Typo.body)
                                    .foregroundStyle(Theme.textPrimary)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 260)
                        }
                    }
                    if showData {
                        InsetPanel {
                            ScrollView {
                                Text(Highlight.apply(preview))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 220)
                        }
                    }
                }
                .padding(.leading, 24)
                .padding(.bottom, Theme.Space.s)
            }
        }
        .confirmationDialog("Delete this item permanently?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive, action: onDelete)
        }
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
            Text("Edit text").font(Theme.Typo.windowTitle)
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
    return "\(day) \(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))"
}
