import SwiftUI

/// What opens from the menu bar eye: the status in big type with a glowing dot,
/// one Pause button, the windows, Delete all, and Quit.
struct MenuPopoverView: View {
    struct Actions {
        var openDraft: () -> Void
        var openOutbox: () -> Void
        var openApps: () -> Void
        var openWelcome: () -> Void
        var openDebug: () -> Void
        var deleteAll: () -> Void
        var quit: () -> Void
    }

    @ObservedObject var settings: Settings
    @ObservedObject var engine: CaptureEngine
    @ObservedObject var outbox: OutboxModel
    let actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            HStack(spacing: Theme.Space.m) {
                GlowDot(color: dotColor, size: 11)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.system(size: 20, weight: .semibold))
                    Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: Theme.Space.s) {
                switch engine.status.state {
                case .off:
                    Button("Turn on") { settings.captureOn = true }.buttonStyle(PrimaryButtonStyle())
                case .paused:
                    Button("Resume") { settings.resume() }.buttonStyle(PrimaryButtonStyle())
                    Button("Turn off") { settings.captureOn = false }.buttonStyle(GhostButtonStyle())
                case .on:
                    Menu {
                        Button("For 1 hour") { settings.pause(for: 3600) }
                        Button("Until tomorrow") { settings.pauseUntilTomorrow() }
                    } label: {
                        Label("Pause", systemImage: "pause.fill")
                    }
                    .menuStyle(.button)
                    .buttonStyle(PrimaryButtonStyle())
                    .menuIndicator(.visible)
                    .fixedSize()
                    Button("Turn off") { settings.captureOn = false }.buttonStyle(GhostButtonStyle())
                }
            }

            ConstellationDivider()

            VStack(alignment: .leading, spacing: 2) {
                row("Today's draft", symbol: "list.bullet.rectangle", action: actions.openDraft)
                row("Outbox", symbol: "tray.and.arrow.up", badge: outbox.toReviewCount, action: actions.openOutbox)
                row("Apps and privacy", symbol: "app.badge.checkmark", action: actions.openApps)
                row("Welcome and permission", symbol: "hand.wave", action: actions.openWelcome)
                row("Debug", symbol: "gauge.with.dots.needle.33percent", action: actions.openDebug)
            }

            ConstellationDivider()

            HStack {
                Button(role: .destructive, action: actions.deleteAll) {
                    Label("Delete all data", systemImage: "trash")
                }
                .buttonStyle(LinkButtonStyle(color: Theme.danger))
                .fixedSize()
                .help("Deletes every record, the Outbox, and the encryption key, in one click")
                Spacer(minLength: Theme.Space.s)
                Button(action: actions.quit) {
                    Label("Quit Constellation", systemImage: "power")
                }
                .buttonStyle(GhostButtonStyle(small: true))
                .fixedSize()
                .keyboardShortcut("q")
                .help("Stop capturing and quit (Command-Q)")
            }
        }
        .padding(Theme.Space.l + 2)
        .frame(width: 300)
        .background(SpaceBackground())
        .foregroundStyle(Theme.textPrimary)
        .font(Theme.Typo.body)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
    }

    private func row(_ title: String, symbol: String, badge: Int = 0, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Theme.Space.s) {
                Image(systemName: symbol).frame(width: 18).foregroundStyle(Theme.textSecondary)
                Text(title)
                Spacer()
                if badge > 0 { Chip(text: "\(badge) to review", color: Theme.warning) }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(MenuRowStyle())
    }

    private var headline: String {
        switch engine.status.state {
        case .on: "On"
        case .paused: "Paused"
        case .off: "Off"
        }
    }

    private var detail: String {
        let status = engine.status
        switch status.state {
        case .off: return "Nothing is read."
        case .paused(let until): return "Until \(until.formatted(date: .abbreviated, time: .shortened))"
        case .on:
            if !status.trusted { return "Needs Accessibility permission" }
            if settings.allowed.isEmpty { return "No apps chosen yet" }
            if !status.systemAvailable { return "Waiting: screen locked or asleep" }
            return "Reading \(settings.allowed.count) \(settings.allowed.count == 1 ? "app" : "apps") while in front"
        }
    }

    private var dotColor: Color {
        let status = engine.status
        switch status.state {
        case .off: return Theme.danger
        case .paused: return Theme.warning
        case .on: return status.trusted && status.systemAvailable && !settings.allowed.isEmpty ? Theme.success : Theme.warning
        }
    }
}

private struct MenuRowStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.white.opacity(configuration.isPressed ? 0.1 : (hovering ? 0.06 : 0)),
                        in: RoundedRectangle(cornerRadius: 6))
            .onHover { hovering = $0 }
    }
}
