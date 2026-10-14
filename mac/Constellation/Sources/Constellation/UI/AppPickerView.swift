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
        SpaceScreen {
            WindowHeader(title: "Apps and Privacy", subtitle: "Every app starts off. Browsers share only the tab title and address.") {
                IconButton(symbol: "gauge.with.dots.needle.33percent", help: "Open the debug view", action: showDebug)
            }
            captureRow
            Picker("Section", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if tab == .apps {
                HStack(spacing: Theme.Space.s) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
                    TextField("Search apps", text: $search).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.12)))
            }
        } content: {
            switch tab {
            case .apps: appsTab
            case .privacy: privacyTab
            case .rules: rulesTab
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
        GlassCard(padding: 0) {
            LazyVStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { Divider().overlay(Color.white.opacity(0.05)) }
                    AppRow(entry: entry, isOn: binding(for: entry))
                }
                if shown.isEmpty {
                    EmptyState(title: "No apps found", message: "Try another name.")
                }
            }
        }
    }

    private func binding(for entry: AppEntry) -> Binding<Bool> {
        Binding(get: { settings.allowed.contains(entry.id) }, set: { settings.setAllowed(entry.id, $0) })
    }

    // MARK: Privacy

    private var privacyTab: some View {
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
                    PrivacySwitch(title: "Private network addresses", detail: "10.x and 192.168.x become [IP]", isOn: $settings.redactPrivateIPs)
                }
            }
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

    // MARK: Rules

    private var rulesTab: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            SectionHeader(title: "Always skip these domains",
                          info: "One per line. A word with no dot matches any domain containing it, e.g. \"bank\".")
            RulesEditor(lines: $settings.skipDomains, placeholder: "chase.com\nbank\nmyhealth.example.org")
            SectionHeader(title: "Always skip windows containing",
                          info: "One word or phrase per line. A window whose title or text contains one is never captured.")
            RulesEditor(lines: $settings.skipWords, placeholder: "Payroll\nMedical\nPersonal")
        }
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
            badge
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .controlSize(.small)
                .labelsHidden()
                .disabled(entry.support == .blocked)
                .accessibilityLabel("Read \(entry.name)")
        }
        .padding(.horizontal, Theme.Space.l)
        .padding(.vertical, 9)
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
            StarBadge(kind: .needsReview, label: "Unverified").help("Not measured yet. Check the debug view to see what comes through.")
        case .blocked:
            Label("Blocked", systemImage: "nosign")
                .font(Theme.Typo.caption.weight(.medium))
                .foregroundStyle(Theme.danger)
                .help("Password managers and system settings are never read.")
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
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.12)))
    }
}
