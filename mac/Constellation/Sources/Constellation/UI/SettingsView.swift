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

    var body: some View {
        SpaceScreen(maxWidth: 720, embedded: true) {
            WindowHeader(
                title: "Settings",
                subtitle: "Connect this Mac, choose what is redacted, and see that capture is behaving."
            )
        } content: {
            connection
            sharing
            RedactionSettings(settings: settings)
            SkipRulesSettings(settings: settings)
            howItWorks
            diagnostics
            delete
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
