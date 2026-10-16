import CaptureCore
import SwiftUI

/// What opens from the menu bar eye: whether capture is on, the one thing
/// that needs you, and Quit. The window itself holds Today, Outbox, Apps, and Settings.
struct MenuPopoverView: View {
    struct Cue {
        var title: String
        var detail: String
        var place: ShellPlace
    }

    struct Actions {
        var open: (ShellPlace) -> Void
        var quit: () -> Void
    }

    @ObservedObject var settings: Settings
    @ObservedObject var engine: CaptureEngine
    @ObservedObject var outbox: OutboxModel
    @ObservedObject var drafts: DraftModel
    @ObservedObject var sender: Sender
    let actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            HStack(spacing: Theme.Space.m) {
                GlowDot(color: dotColor, size: 11)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.system(size: 20, weight: .semibold))
                    Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let minutes = drafts.draft?.totalMinutes, minutes > 0, cue?.place != .today {
                        Text("Today so far: \(minutes.asDuration)")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.star)
                    }
                }
            }

            HStack(spacing: Theme.Space.s) {
                switch engine.status.state {
                case .off:
                    if settings.policy.captureEnabled {
                        Button("Turn On") { settings.captureOn = true }.buttonStyle(PrimaryButtonStyle())
                    }
                case .paused:
                    Button("Resume") { settings.resume() }.buttonStyle(PrimaryButtonStyle())
                    Button("Turn Off") { settings.captureOn = false }.buttonStyle(GhostButtonStyle())
                case .on:
                    Menu {
                        Button("For 1 Hour") { settings.pause(for: 3600) }
                        Button("Until Tomorrow") { settings.pauseUntilTomorrow() }
                    } label: {
                        Label("Pause", systemImage: "pause.fill")
                    }
                    .menuStyle(.button)
                    .buttonStyle(PrimaryButtonStyle())
                    .menuIndicator(.visible)
                    .fixedSize()
                    Button("Turn Off") { settings.captureOn = false }.buttonStyle(GhostButtonStyle())
                }
            }

            ConstellationDivider()

            Button { actions.open(cue?.place ?? .today) } label: {
                HStack(spacing: Theme.Space.s) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cue?.detail ?? "Today, Outbox, Apps, Settings").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                        Text(cue?.title ?? "Open Constellation").font(Theme.Typo.bodyStrong)
                    }
                    Spacer(minLength: Theme.Space.s)
                    Image(systemName: "arrow.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(MenuRowStyle())
            .help(cue.map { "Opens \($0.place.label)" } ?? "Opens Today")

            ConstellationDivider()

            HStack {
                Spacer(minLength: Theme.Space.s)
                Button(action: actions.quit) {
                    Label("Quit Constellation", systemImage: "power")
                }
                .buttonStyle(GhostButtonStyle(small: true))
                .fixedSize()
                .keyboardShortcut("q")
                .help("Stops capturing and quits Constellation (⌘Q).")
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

    /// The single next step, in the order that unblocks the timesheet.
    private var cue: Cue? {
        if !sender.isConnected {
            return Cue(title: "Connect this Mac", detail: "Opens Settings", place: .settings)
        }
        if outbox.toReviewCount > 0 {
            let n = outbox.toReviewCount
            return Cue(title: "\(n) to approve", detail: "Opens Outbox", place: .outbox)
        }
        if drafts.pendingCount > 0 {
            let minutes = drafts.draft?.totalMinutes ?? 0
            let title = minutes > 0 ? "Confirm \(minutes.asDuration)" : "Confirm today's timesheet"
            return Cue(title: title, detail: "Opens Today", place: .today)
        }
        if settings.allowed.isEmpty {
            return Cue(title: "Choose which apps are read", detail: "Opens Apps", place: .apps)
        }
        return nil
    }

    private var headline: String {
        switch engine.status.state {
        case .on: "On"
        case .paused: "Paused"
        case .off: settings.policy.captureEnabled ? "Off" : "Paused"
        }
    }

    private var detail: String {
        let status = engine.status
        switch status.state {
        case .off: return settings.policy.captureEnabled ? "Nothing is read." : "Paused by your company"
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
