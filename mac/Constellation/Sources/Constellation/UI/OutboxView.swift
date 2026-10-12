import CaptureCore
import SwiftUI

/// The Outbox (spec 9): exactly what would leave this Mac, in 30 minute batches.
/// People can read, edit, delete, or approve. Names are highlighted so they are noticed.
struct OutboxView: View {
    @ObservedObject var model: OutboxModel
    @ObservedObject var settings: Settings
    @State private var editing: OutboxItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Outbox").font(.title2.bold())
            Text("Nothing leaves this Mac unless it appears here first. What you see is exactly what would be sent.")
                .foregroundStyle(.secondary)

            HStack(spacing: 16) {
                Picker("Mode", selection: $settings.outboxMode) {
                    Text("Review first").tag(OutboxMode.reviewFirst)
                    Text("Log only").tag(OutboxMode.logOnly)
                }
                .pickerStyle(.segmented)
                .frame(width: 280)
                if settings.outboxMode == .reviewFirst {
                    Toggle("Approve automatically after \(Limits.autoApproveMinutes) minutes", isOn: $settings.autoApprove)
                } else {
                    Text("New items are approved as soon as they close.").foregroundStyle(.secondary)
                }
            }

            Label("Destination: not connected yet. Approved items wait here; nothing is sent until the sender is set up.",
                  systemImage: "arrow.up.circle")
                .foregroundStyle(.secondary)

            if !model.available {
                Text("The encrypted store is unavailable, so there is nothing to show.").foregroundStyle(.orange)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    BatchSection(title: "Waiting for review", empty: "Nothing to review.", batches: model.toReview,
                                 canApprove: true, model: model, editing: $editing)
                    BatchSection(title: "Approved, waiting to send", empty: "Nothing approved yet.", batches: model.approved,
                                 canApprove: false, model: model, editing: $editing)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(20)
        .frame(minWidth: 780, minHeight: 580)
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
}

private struct BatchSection: View {
    let title: String
    let empty: String
    let batches: [OutboxBatch]
    let canApprove: Bool
    let model: OutboxModel
    @Binding var editing: OutboxItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(title) (\(batches.reduce(0) { $0 + $1.items.count }))").font(.headline)
            if batches.isEmpty {
                Text(empty).foregroundStyle(.secondary)
            }
            ForEach(batches) { batch in
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(batch.items) { item in
                            ItemCard(item: item, onEdit: { editing = item }, onDelete: { model.delete([item.id]) })
                        }
                    }
                    .padding(.top, 6)
                } label: {
                    HStack {
                        Text(timeRange(batch.start, batch.end)).font(.body.weight(.medium))
                        Text("\(batch.items.count) \(batch.items.count == 1 ? "item" : "items") · \(batch.redactions) redactions")
                            .foregroundStyle(.secondary)
                        Spacer()
                        if canApprove { Button("Approve") { model.approve(batch) } }
                        Button("Delete", role: .destructive) { model.delete(batch.items.map(\.id)) }
                    }
                }
                .padding(10)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

private struct ItemCard: View {
    let item: OutboxItem
    let onEdit: () -> Void
    let onDelete: () -> Void
    @State private var title: AttributedString?
    @State private var text: AttributedString?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.record.appName).font(.body.weight(.semibold))
                Text(timeRange(item.record.startedAt, item.record.endedAt))
                Text("· \(item.record.redactionCount) redactions")
                if item.edited { Text("· edited") }
                Spacer()
                Button("Edit", action: onEdit)
                Button("Delete", role: .destructive, action: onDelete)
            }
            .foregroundStyle(.primary)

            field("Title") { Text(title ?? AttributedString(item.record.windowTitle)) }
            if let domainPath = item.record.domainPath {
                field("Web address") { Text(domainPath) }
            }
            field("Text") {
                if item.record.text.isEmpty {
                    Text("None (browsers send title and web address only)").foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        Text(text ?? AttributedString(item.record.text))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 150)
                }
            }
            DisclosureGroup("What will be sent") {
                Text(item.payload.preview)
                    .font(.caption.monospaced())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .font(.caption)
        }
        .textSelection(.enabled)
        .padding(10)
        .background(.background, in: RoundedRectangle(cornerRadius: 6))
        .onAppear {
            title = Highlight.apply(item.record.windowTitle)
            text = Highlight.apply(item.record.text)
        }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
            content()
        }
    }
}

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
        VStack(alignment: .leading, spacing: 10) {
            Text("Edit text").font(.title3.bold())
            Text("\(item.record.appName) · \(timeRange(item.record.startedAt, item.record.endedAt)). Your edit is checked for private details again before it is saved.")
                .foregroundStyle(.secondary)
            TextEditor(text: $text)
                .font(.body)
                .frame(minHeight: 260)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
            HStack {
                Spacer()
                Button("Cancel", action: onCancel).keyboardShortcut(.cancelAction)
                Button("Save") { onSave(text) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 620)
    }
}

/// Names get a yellow highlight (spec 8: shown highlighted in the Outbox);
/// redaction markers like [EMAIL] are greyed.
enum Highlight {
    private static let tokens = try! NSRegularExpression(pattern: #"\[(?:EMAIL|PHONE|CARD|SSN|ADDRESS|SECRET|IP|Person \d+)\]"#)

    static func apply(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        for range in NameDetector.ranges(in: text) {
            if let attributed = Range(range, in: result) {
                result[attributed].backgroundColor = .yellow.opacity(0.35)
            }
        }
        let whole = NSRange(text.startIndex..., in: text)
        for match in tokens.matches(in: text, range: whole) {
            if let stringRange = Range(match.range, in: text), let attributed = Range(stringRange, in: result) {
                result[attributed].foregroundColor = .secondary
                result[attributed].backgroundColor = .gray.opacity(0.18)
            }
        }
        return result
    }
}

private func timeRange(_ start: Date, _ end: Date) -> String {
    let day = Calendar.current.isDateInToday(start) ? "Today" : start.formatted(.dateTime.weekday(.abbreviated).month().day())
    return "\(day) \(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))"
}
