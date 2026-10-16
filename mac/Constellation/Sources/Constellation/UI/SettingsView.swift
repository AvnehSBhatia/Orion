import CaptureCore
import SwiftUI

/// Connection, what leaves this Mac, and the quiet tools. Destructive actions sit at the bottom.
struct SettingsView: View {
    @ObservedObject var settings: Settings
    @ObservedObject var engine: CaptureEngine
    @ObservedObject var sender: Sender
    @ObservedObject var stats: DebugStats
    var deleteAll: () -> Void
    var showWelcome: () -> Void

    @State private var confirmDelete = false
    @State private var tab: Tab = .connection

    private enum Tab: String, CaseIterable, Identifiable {
        case connection = "Connection & redaction"
        case privacy = "Privacy & exclusions"
        var id: String { rawValue }
    }

    var body: some View {
        SpaceScreen(embedded: true) {
            WindowHeader(
                title: "Settings",
                subtitle: tab == .connection
                    ? "Connect this Mac, choose when work leaves, and see what is replaced."
                    : "What is always replaced, and the windows this Mac never reads.",
                statusLabel: sender.isConnected ? "Connected" : "Not connected",
                statusColor: sender.isConnected ? Theme.success : Theme.warning
            )
            Picker("Section", selection: $tab) {
                ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        } content: {
            switch tab {
            case .connection:
                connection
                sharing
                RedactionSettings(settings: settings, includeAlwaysReplaced: false)
                howItWorks
                diagnostics
                delete
            case .privacy:
                privateAddresses
                safeguards
                SkipRulesSettings(settings: settings)
                Text("App-level capture preferences are managed in Apps.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .alert("Delete all data?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive, action: deleteAll)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Removes every record on this Mac and asks Orion to delete yours. This cannot be undone.")
        }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "Connection", info: "The one-time code is in the Orion web app, under Settings, Connect your Mac. It expires in 15 minutes.")
            ConnectionCard(sender: sender, settings: settings, directory: sender.directory)
        }
    }

    private var sharing: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "When work leaves this Mac")
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    Picker("Mode", selection: $settings.outboxMode) {
                        Text("Review first").tag(OutboxMode.reviewFirst)
                        Text("Log only").tag(OutboxMode.logOnly)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(maxWidth: 280, alignment: .leading)
                    Text(settings.outboxMode == .reviewFirst
                         ? "You read each batch and approve it. Your company keeps nothing until you do."
                         : "A finished batch is approved on its own and listed in the Outbox as a log.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if settings.outboxMode == .reviewFirst {
                        Toggle("Auto-approve after \(Limits.autoApproveMinutes) minutes", isOn: $settings.autoApprove)
                            .toggleStyle(.switch)
                            .controlSize(.small)
                    }
                }
            }
        }
    }

    private var privateAddresses: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "Private network addresses")
            GlassCard {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Private network addresses")
                        Text("Become [IP]").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                    }
                    Spacer(minLength: Theme.Space.s)
                    Toggle("", isOn: $settings.redactPrivateIPs)
                        .toggleStyle(.switch)
                        .controlSize(.small)
                        .labelsHidden()
                        .accessibilityLabel("Private network addresses")
                }
            }
        }
    }

    private var safeguards: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "Sensitive content", info: "These are replaced on this Mac before anything is saved. They cannot be turned off.")
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    safeguard("Sensitive numbers", "Card numbers and Social Security numbers are always replaced.")
                    safeguard("Password fields", "Passwords and password fields are never kept.")
                    safeguard("Protected fields", "API keys and tokens are always replaced.")
                }
            }
        }
    }

    private func safeguard(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: "lock.fill").font(Theme.Typo.bodyStrong)
            Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
        }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "How this works")
            GlassCard {
                HStack(alignment: .center, spacing: Theme.Space.m) {
                    Text("The short introduction: what is read, the permission, and how sharing works.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.Space.s)
                    Button("Show introduction", action: showWelcome).buttonStyle(GhostButtonStyle(small: true))
                }
            }
        }
    }

    private var diagnostics: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(
                title: "Capture diagnostics",
                info: "Counts only. Captured text, titles, and addresses are never shown here."
            )
            DebugView(stats: stats, engine: engine, embedded: true)
        }
    }

    private var delete: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            SectionHeader(title: "Delete")
            GlassCard {
                HStack(alignment: .center, spacing: Theme.Space.m) {
                    Text("Delete every record on this Mac, and ask Orion to delete yours.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Theme.Space.s)
                    Button("Delete all data") { confirmDelete = true }
                        .buttonStyle(GhostButtonStyle(small: true, color: Theme.danger))
                }
            }
        }
    }
}
