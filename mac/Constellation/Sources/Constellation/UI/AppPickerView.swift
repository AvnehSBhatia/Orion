import CaptureCore
import SwiftUI

/// Apps and privacy, in three tabs: which apps are read (spec 7), what is
/// replaced before anything is kept, and skip rules. The header and search stay
/// pinned while the list scrolls.
struct AppPickerView: View {
    enum Tab: String, CaseIterable {
        case apps = "Apps"
        case privacy = "Privacy"
        case rules = "Rules"
    }

    @ObservedObject var settings: Settings
    @ObservedObject var engine: CaptureEngine
    var appsOnly = false
    let showDebug: () -> Void
    @State private var tab: Tab = .apps
    @State private var apps: [AppEntry] = []
    @State private var search = ""

    /// Turned-on apps first, then by name.
    private var shown: [AppEntry] {
        let matching = search.isEmpty ? apps : apps.filter { $0.name.localizedCaseInsensitiveContains(search) }
        return matching.sorted { a, b in
            let aOn = settings.allowed.contains(a.id), bOn = settings.allowed.contains(b.id)
            if aOn != bOn { return aOn }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        SpaceScreen(embedded: appsOnly) {
            WindowHeader(
                title: appsOnly ? "Apps" : "Apps and Privacy",
                subtitle: appsOnly
                    ? "Turn on the apps you work in. Browsers share only the tab title and address. Everything else on this Mac stays unread."
                    : "Every app starts off. Browsers share only the tab title and address."
            ) {
                if !appsOnly {
                    IconButton(symbol: "gauge.with.dots.needle.33percent", help: "Open the debug view", action: showDebug)
                }
            }
            if !appsOnly { captureRow }
            if !appsOnly {
                Picker("Section", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            if appsOnly || tab == .apps {
                HStack(spacing: Theme.Space.s) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
                    TextField("Search apps", text: $search).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
            }
        } content: {
            if appsOnly {
                appsTab
            } else {
                switch tab {
                case .apps: appsTab
                case .privacy: RedactionSettings(settings: settings)
                case .rules: SkipRulesSettings(settings: settings)
                }
            }
        }
        .onAppear { apps = AppCatalog.load() }
    }

    // MARK: Capture

    /// The same controls as the menu bar, for when its icon is hidden behind the notch.
    private var captureRow: some View {
        HStack(spacing: Theme.Space.m) {
            GlowDot(color: dotColor)
            Toggle("Capture", isOn: $settings.captureOn).toggleStyle(.switch).controlSize(.small)
            Text(stateText).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary).lineLimit(1)
            Spacer(minLength: Theme.Space.s)
            if case .paused = engine.status.state {
                Button("Resume") { settings.resume() }.buttonStyle(GhostButtonStyle(small: true))
            } else if settings.captureOn {
                Button("Pause for 1 Hour") { settings.pause(for: 3600) }.buttonStyle(GhostButtonStyle(small: true))
            }
        }
    }

    private var stateText: String {
        switch engine.status.state {
        case .off: return "Off. Nothing is read."
        case .paused(let until): return "Paused until \(until.formatted(date: .omitted, time: .shortened))"
        case .on:
            if !engine.status.trusted { return "Needs Accessibility permission" }
            if settings.allowed.isEmpty { return "On, but no apps are turned on" }
            return "On. Reading turned-on apps while in front."
        }
    }

    private var dotColor: Color {
        switch engine.status.state {
        case .off: Theme.danger
        case .paused: Theme.warning
        case .on: engine.status.trusted && !settings.allowed.isEmpty ? Theme.success : Theme.warning
        }
    }

    // MARK: Apps

    private var appsTab: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            GlassCard(padding: 0) {
                LazyVStack(spacing: 0) {
                    columnHeader
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, entry in
                        Divider().overlay(Theme.border)
                        AppRow(entry: entry, isOn: binding(for: entry))
                    }
                    if shown.isEmpty {
                        EmptyState(title: "No apps found", message: "Try another name.")
                    }
                }
            }
            Text("Only enabled apps are read. Everything else on this Mac stays unread.")
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private var columnHeader: some View {
        HStack(spacing: Theme.Space.m) {
            Text("Application")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Verification")
                .frame(width: 130, alignment: .leading)
            Text("Capture")
                .frame(width: 56, alignment: .trailing)
        }
        .font(Theme.Typo.sectionHeader)
        .kerning(0.8)
        .foregroundStyle(Theme.textTertiary)
        .textCase(.uppercase)
        .padding(.horizontal, Theme.Space.l)
        .padding(.vertical, 10)
    }

    private func binding(for entry: AppEntry) -> Binding<Bool> {
        Binding(get: { settings.allowed.contains(entry.id) }, set: { settings.setAllowed(entry.id, $0) })
    }

}

private struct AppRow: View {
    let entry: AppEntry
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: Theme.Space.m) {
            Image(nsImage: entry.icon).resizable().frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name).lineLimit(1)
                if let subtitle { Text(subtitle).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary).lineLimit(1) }
            }
            Spacer(minLength: Theme.Space.s)
            badge.frame(width: 130, alignment: .leading)
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .controlSize(.small)
                .labelsHidden()
                .disabled(entry.support == .blocked)
                .accessibilityLabel("Read \(entry.name)")
                .frame(width: 56, alignment: .trailing)
        }
        .padding(.horizontal, Theme.Space.l)
        .padding(.vertical, 9)
        .background(isOn ? Theme.selectedNav : Color.clear)
    }

    private var subtitle: String? {
        switch entry.support {
        case .verified(let note): note ?? (entry.kind == .native ? nil : entry.kind.rawValue)
        case .unverified: entry.kind == .native ? nil : entry.kind.rawValue
        case .blocked: "Never read"
        }
    }

    @ViewBuilder private var badge: some View {
        switch entry.support {
        case .verified:
            StarBadge(kind: .accepted, label: "Verified").help("Measured in testing: text comes through.")
        case .unverified:
            StarBadge(kind: .needsReview, label: "Unverified").help("Not measured yet. Counts for this app are in Settings, under Capture diagnostics.")
        case .blocked:
            Label("Blocked", systemImage: "nosign")
                .font(Theme.Typo.caption.weight(.medium))
                .foregroundStyle(Theme.danger)
                .help("Password managers and system settings are never read.")
        }
    }
}

struct RedactionSettings: View {
    @ObservedObject var settings: Settings
    var includeAlwaysReplaced = true

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            SectionHeader(title: "Replaced before anything is kept",
                          info: "These are replaced on this Mac, before anything is saved or sent. Changes apply to what's captured from now on.")
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    PrivacySwitch(title: "Email addresses", detail: "Become [EMAIL]", isOn: $settings.redactEmails)
                    PrivacySwitch(title: "Keep the company part", detail: "Shows [EMAIL]@acme.com instead of [EMAIL]", isOn: $settings.keepEmailDomain)
                        .padding(.leading, 28)
                        .disabled(!settings.redactEmails)
                        .opacity(settings.redactEmails ? 1 : 0.5)
                    PrivacySwitch(title: "Phone numbers", detail: "Become [PHONE]", isOn: $settings.redactPhones)
                    PrivacySwitch(title: "Street addresses", detail: "Become [ADDRESS]", isOn: $settings.redactAddresses)
                    PrivacySwitch(title: "People's names", detail: "Become [Person 1], [Person 2]", isOn: $settings.maskNames)
                    PrivacySwitch(title: "Private network addresses", detail: "Become [IP]", isOn: $settings.redactPrivateIPs)
                }
            }
            if includeAlwaysReplaced {
                SectionHeader(title: "Always replaced")
                GlassCard {
                    VStack(alignment: .leading, spacing: Theme.Space.s) {
                        ForEach(["Card numbers", "Social Security numbers", "Passwords and password fields", "API keys and tokens"], id: \.self) { item in
                            Label(item, systemImage: "lock.fill")
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
            }
        }
    }
}

struct SkipRulesSettings: View {
    @ObservedObject var settings: Settings

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            SectionHeader(title: "Always skip these domains",
                          info: "One per line. A word with no dot matches any domain containing it, e.g. \"bank\".")
            RulesEditor(lines: $settings.skipDomains, placeholder: "chase.com\nbank\nmyhealth.example.org")
            Text("One domain per line").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
            SectionHeader(title: "Always skip windows containing",
                          info: "One word or phrase per line. A window whose title or text contains one is never captured.")
            RulesEditor(lines: $settings.skipWords, placeholder: "Payroll\nMedical\nPersonal")
            Text("One phrase per line").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
        }
    }
}

private struct PrivacySwitch: View {
    let title: String
    let detail: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
            }
            Spacer(minLength: Theme.Space.s)
            Toggle("", isOn: $isOn).toggleStyle(.switch).controlSize(.small).labelsHidden().accessibilityLabel(title)
        }
    }
}

private struct RulesEditor: View {
    @Binding var lines: [String]
    let placeholder: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: Binding(
                get: { lines.joined(separator: "\n") },
                set: { lines = $0.components(separatedBy: .newlines) }
            ))
            .font(Theme.Typo.mono)
            .scrollContentBackground(.hidden)
            if lines.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
                Text(placeholder)
                    .font(Theme.Typo.mono)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.top, 1)
                    .padding(.leading, 5)
                    .allowsHitTesting(false)
            }
        }
        .padding(Theme.Space.s)
        .frame(height: 130)
        .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
    }
}
