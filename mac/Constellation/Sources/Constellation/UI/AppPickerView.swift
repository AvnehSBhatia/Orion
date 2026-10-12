import SwiftUI

/// Settings > Apps (spec 7): every app starts off; blocked apps cannot be turned on.
struct AppPickerView: View {
    @ObservedObject var settings: Settings
    @State private var apps: [AppEntry] = []
    @State private var search = ""

    private var filtered: [AppEntry] {
        search.isEmpty ? apps : apps.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose which apps Constellation reads").font(.title2.bold())
            Text("Every app starts off. An app you turn on is read only while it is in front. Browsers give their tab title and web address only, never page text.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("Search apps", text: $search).textFieldStyle(.roundedBorder)

            List(filtered) { entry in
                AppRow(entry: entry, isOn: binding(for: entry))
            }
            .frame(minHeight: 280)

            HStack(alignment: .top, spacing: 16) {
                LinesEditor(title: "Always skip these domains", hint: "One per line. A word with no dot matches any domain containing it.", lines: $settings.skipDomains)
                LinesEditor(title: "Always skip windows containing", hint: "One word or phrase per line.", lines: $settings.skipWords)
            }
        }
        .padding(20)
        .frame(minWidth: 560, minHeight: 620)
        .onAppear { apps = AppCatalog.load() }
    }

    private func binding(for entry: AppEntry) -> Binding<Bool> {
        Binding(
            get: { settings.allowed.contains(entry.id) },
            set: { settings.setAllowed(entry.id, $0) }
        )
    }
}

private struct AppRow: View {
    let entry: AppEntry
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 10) {
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
                .disabled(entry.support == .blocked)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Text(entry.support.label)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(badgeColor.opacity(0.15), in: Capsule())
                .foregroundStyle(badgeColor)
                .help(badgeHelp)
        }
        .padding(.vertical, 2)
    }

    private var detail: String? {
        switch entry.support {
        case .verified(let note): note
        case .unverified: entry.kind == .native ? nil : entry.kind.rawValue
        case .blocked: "Never read"
        }
    }

    private var badgeColor: Color {
        switch entry.support {
        case .verified: .green
        case .unverified: .orange
        case .blocked: .red
        }
    }

    private var badgeHelp: String {
        switch entry.support {
        case .verified: "Measured in testing: text comes through."
        case .unverified: "Not measured yet. Check the debug view to see what comes through."
        case .blocked: "Password managers and system settings are never read."
        }
    }
}

private struct LinesEditor: View {
    let title: String
    let hint: String
    @Binding var lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(hint).font(.caption).foregroundStyle(.secondary)
            TextEditor(text: Binding(
                get: { lines.joined(separator: "\n") },
                set: { lines = $0.components(separatedBy: .newlines) }
            ))
            .font(.body.monospaced())
            .frame(height: 110)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
        }
    }
}
