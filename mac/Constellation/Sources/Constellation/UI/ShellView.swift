import CaptureCore
import SwiftUI

/// Where you are in the one Constellation window.
enum ShellPlace: String, CaseIterable, Identifiable {
    case today, outbox, apps, settings

    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: "Today"
        case .outbox: "Outbox"
        case .apps: "Apps"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .outbox: "tray.full"
        case .apps: "app.badge"
        case .settings: "gearshape"
        }
    }

    var help: String {
        switch self {
        case .today: "Today's timesheet, command 1"
        case .outbox: "What is still on this Mac, command 2"
        case .apps: "Which apps may be read, command 3"
        case .settings: "Connection and privacy, command 4"
        }
    }

    var shortcut: KeyEquivalent {
        switch self {
        case .today: "1"
        case .outbox: "2"
        case .apps: "3"
        case .settings: "4"
        }
    }
}

/// The window's current place. The menu bar sets it, then shows the one window.
@MainActor final class ShellNavigation: ObservableObject {
    @Published var place: ShellPlace = .today
}

/// One window. The sidebar is the map. The page on the right is the only thing in front of you.
struct ShellView: View {
    @ObservedObject var navigation: ShellNavigation
    @ObservedObject var settings: Settings
    @ObservedObject var engine: CaptureEngine
    @ObservedObject var outbox: OutboxModel
    @ObservedObject var drafts: DraftModel
    @ObservedObject var sender: Sender
    @ObservedObject var stats: DebugStats
    @ObservedObject var baseline: BaselineModel
    var deleteAll: () -> Void
    var showWelcome: () -> Void

    @State private var showBaseline = false

    var body: some View {
        ZStack {
            SpaceBackground()
            HStack(spacing: 0) {
                sidebar
                Rectangle().fill(Color.white.opacity(0.08)).frame(width: 1)
                detail
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .font(Theme.Typo.body)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showBaseline) {
            BaselineView(model: baseline, directory: sender.directory)
                .frame(minWidth: 640, minHeight: 560)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            VStack(alignment: .leading, spacing: 2) {
                ConstellationMark().frame(width: 64, height: 28).accessibilityHidden(true)
                Text("Constellation").font(.system(size: 15, weight: .semibold))
                Text("On this Mac").font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
            }
            .padding(.bottom, Theme.Space.s)

            ForEach(ShellPlace.allCases) { place in
                sidebarRow(place)
            }

            Spacer(minLength: Theme.Space.l)
            captureControl
        }
        .padding(.horizontal, Theme.Space.m)
        .padding(.top, Theme.titlebarInset + Theme.Space.s)
        .padding(.bottom, Theme.Space.l)
        .frame(width: 212)
        .background(Color.black.opacity(0.22))
    }

    private func sidebarRow(_ place: ShellPlace) -> some View {
        let selected = navigation.place == place
        let badge = badgeCount(place)
        return Button {
            navigation.place = place
        } label: {
            HStack(spacing: Theme.Space.s) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(selected ? Theme.accent : Color.clear)
                    .frame(width: 2, height: 16)
                Image(systemName: place.symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 16)
                    .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                Text(place.label)
                    .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                Spacer(minLength: 4)
                if badge > 0 {
                    Text("\(badge)")
                        .font(Theme.Typo.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.warning)
                }
            }
            .padding(.vertical, 6)
            .padding(.trailing, 8)
            .contentShape(Rectangle())
            .background(selected ? Color.white.opacity(0.07) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .keyboardShortcut(place.shortcut, modifiers: [.command])
        .help(place.help)
        .accessibilityLabel(place.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func badgeCount(_ place: ShellPlace) -> Int {
        switch place {
        case .outbox: outbox.toReviewCount
        case .today: drafts.pendingCount
        default: 0
        }
    }

    private var captureControl: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(spacing: Theme.Space.s) {
                GlowDot(color: dotColor, size: 8)
                Text(headline).font(Theme.Typo.bodyStrong)
            }
            Text(captureDetail)
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            captureButton
        }
        .padding(Theme.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: Theme.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.08)))
    }

    @ViewBuilder private var captureButton: some View {
        switch engine.status.state {
        case .off:
            if settings.policy.captureEnabled {
                Button("Turn On") { settings.captureOn = true }.buttonStyle(PrimaryButtonStyle(small: true))
            }
        case .paused:
            Button("Resume") { settings.resume() }.buttonStyle(PrimaryButtonStyle(small: true))
        case .on:
            Menu {
                Button("For 1 Hour") { settings.pause(for: 3600) }
                Button("Until Tomorrow") { settings.pauseUntilTomorrow() }
            } label: {
                Text("Pause")
            }
            .menuStyle(.button)
            .buttonStyle(PrimaryButtonStyle(small: true))
            .menuIndicator(.hidden)
            .fixedSize()
        }
    }

    private var headline: String {
        switch engine.status.state {
        case .on: "On"
        case .paused: "Paused"
        case .off: settings.policy.captureEnabled ? "Off" : "Paused"
        }
    }

    private var captureDetail: String {
        switch engine.status.state {
        case .off: return settings.policy.captureEnabled ? "Nothing is read." : "Paused by your company."
        case .paused(let until): return "Until \(until.formatted(date: .omitted, time: .shortened))."
        case .on:
            if !engine.status.trusted { return "Needs Accessibility permission." }
            if settings.allowed.isEmpty { return "Choose apps to read." }
            return "Reading \(settings.allowed.count) \(settings.allowed.count == 1 ? "app" : "apps")."
        }
    }

    private var dotColor: Color {
        switch engine.status.state {
        case .off: Theme.danger
        case .paused: Theme.warning
        case .on: engine.status.trusted && engine.status.systemAvailable && !settings.allowed.isEmpty ? Theme.success : Theme.warning
        }
    }

    private var detail: some View {
        ZStack {
            page(.today) {
                DraftView(
                    model: drafts,
                    directory: sender.directory,
                    embedded: true,
                    batchesWaiting: outbox.toReviewCount,
                    connected: sender.isConnected,
                    appsChosen: !settings.allowed.isEmpty,
                    onOutbox: { navigation.place = .outbox },
                    onApps: { navigation.place = .apps },
                    onSettings: { navigation.place = .settings },
                    onBaseline: { showBaseline = true }
                )
            }
            page(.outbox) {
                OutboxView(
                    model: outbox,
                    settings: settings,
                    sender: sender,
                    embedded: true,
                    draftPending: drafts.pendingCount,
                    openSettings: { navigation.place = .settings },
                    openToday: { navigation.place = .today }
                )
            }
            page(.apps) {
                AppPickerView(settings: settings, engine: engine, appsOnly: true) {}
            }
            page(.settings) {
                SettingsView(
                    settings: settings,
                    engine: engine,
                    sender: sender,
                    stats: stats,
                    deleteAll: deleteAll,
                    showWelcome: showWelcome
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func page<V: View>(_ place: ShellPlace, @ViewBuilder _ view: () -> V) -> some View {
        view()
            .opacity(navigation.place == place ? 1 : 0)
            .allowsHitTesting(navigation.place == place)
            .disabled(navigation.place != place)
            .accessibilityHidden(navigation.place != place)
    }
}
