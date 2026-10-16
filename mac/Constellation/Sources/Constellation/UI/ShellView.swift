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
        case .outbox: "tray"
        case .apps: "rectangle.on.rectangle"
        case .settings: "gearshape.2"
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
                Rectangle().fill(Theme.border).frame(width: 1)
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
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 10) {
                ConstellationMark().frame(width: 22, height: 22).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Constellation").font(.system(size: 14, weight: .semibold))
                    Text("On this Mac").font(Theme.Typo.monoSmall).foregroundStyle(Theme.textTertiary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, Theme.Space.m)

            ForEach(ShellPlace.allCases) { place in
                sidebarRow(place)
            }
            if showsGuide {
                setupGuide
                    .padding(.top, 14)
            } else if needsSetup {
                Button("Show setup steps") { settings.guideDismissed = false }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }

            Spacer(minLength: Theme.Space.l)
            captureControl
        }
        .padding(.horizontal, 12)
        .padding(.top, Theme.titlebarInset + Theme.Space.s)
        .padding(.bottom, Theme.Space.l)
        .frame(width: Theme.sidebarWidth)
        .background(Theme.sidebar)
    }

    private func sidebarRow(_ place: ShellPlace) -> some View {
        let selected = navigation.place == place
        let badge = badgeCount(place)
        return Button {
            navigation.place = place
        } label: {
            HStack(spacing: 12) {
                Image(systemName: place.symbol)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .frame(width: 16)
                Text(place.label)
                    .font(.system(size: 14, weight: selected ? .semibold : .regular))
                Spacer(minLength: 4)
                if badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .foregroundStyle(selected ? Color.white : Theme.textSecondary)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .contentShape(Rectangle())
            .background(selected ? Theme.selectedNav : Color.clear, in: RoundedRectangle(cornerRadius: 8))
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
                GlowDot(color: dotColor, size: 6)
                Text(headline).font(Theme.Typo.bodyStrong)
            }
            Text(captureDetail)
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            captureButton
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardFill, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).strokeBorder(Theme.border))
    }

    @ViewBuilder private var captureButton: some View {
        switch engine.status.state {
        case .off:
            if settings.policy.captureEnabled {
                Button("Turn On") { settings.captureOn = true }.buttonStyle(PrimaryButtonStyle(small: true))
            }
        case .paused:
            Button { settings.resume() } label: {
                Label("Resume", systemImage: "play.fill")
            }
            .buttonStyle(GhostButtonStyle(small: true))
        case .on:
            Menu {
                Button("For 1 Hour") { settings.pause(for: 3600) }
                Button("Until Tomorrow") { settings.pauseUntilTomorrow() }
            } label: {
                Text("Pause")
            }
            .menuStyle(.button)
            .buttonStyle(GhostButtonStyle(small: true))
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

    /// Permission, connection, or apps still missing. The path stays until those are done.
    private var needsSetup: Bool {
        !engine.status.trusted || !sender.isConnected || settings.allowed.isEmpty
    }

    private var showsGuide: Bool { needsSetup && !settings.guideDismissed }

    private var detail: some View { pageStack }

    private var pageStack: some View {
        ZStack {
            page(.today) {
                DraftView(
                    model: drafts,
                    directory: sender.directory,
                    embedded: true,
                    batchesWaiting: outbox.toReviewCount,
                    connected: sender.isConnected,
                    appsChosen: !settings.allowed.isEmpty,
                    guideVisible: showsGuide,
                    onOutbox: { navigation.place = .outbox },
                    onApps: { navigation.place = .apps },
                    onSettings: { navigation.place = .settings },
                    onBaseline: { showBaseline = true },
                    macFooter: "\(headline) · \(captureDetail)"
                )
            }
            page(.outbox) {
                OutboxView(
                    model: outbox,
                    settings: settings,
                    sender: sender,
                    embedded: true,
                    draftPending: drafts.pendingCount,
                    guideVisible: showsGuide,
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

    private struct GuideStep: Identifiable {
        let id: Int
        let title: String
        let detail: String
        let done: Bool
        let current: Bool
        let place: ShellPlace?
    }

    private var guideSteps: [GuideStep] {
        let trusted = engine.status.trusted
        let connected = sender.isConnected
        let apps = !settings.allowed.isEmpty
        let current = !trusted ? 1 : (!connected ? 2 : (!apps ? 3 : 4))
        return [
            GuideStep(id: 1, title: "Allow reading", detail: "Accessibility", done: trusted, current: current == 1, place: nil),
            GuideStep(id: 2, title: "Connect", detail: "This Mac", done: connected, current: current == 2, place: .settings),
            GuideStep(id: 3, title: "Choose apps", detail: "What gets read", done: apps, current: current == 3, place: .apps),
            GuideStep(id: 4, title: "Review Outbox", detail: "Then Today", done: false, current: current == 4, place: .outbox),
        ]
    }

    private var setupGuide: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Setup")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.0)
                    .foregroundStyle(Theme.textTertiary)
                    .textCase(.uppercase)
                Spacer()
                Button("Hide") { settings.guideDismissed = true }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
            ForEach(guideSteps) { step in
                Button {
                    if let place = step.place {
                        navigation.place = place
                    } else {
                        showWelcome()
                    }
                } label: {
                    HStack(spacing: 8) {
                        ZStack {
                            Circle().fill(step.done ? Theme.success.opacity(0.22) : (step.current ? Theme.accent : Color.clear))
                            if step.done {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(Theme.success)
                            } else {
                                Text("\(step.id)")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(step.current ? Theme.onAccent : Theme.textTertiary)
                            }
                        }
                        .frame(width: 16, height: 16)
                        .overlay(Circle().strokeBorder(step.current || step.done ? Color.clear : Theme.border, lineWidth: 1))
                        Text(step.title)
                            .font(.system(size: 13, weight: step.current ? .semibold : .regular))
                            .foregroundStyle(step.current ? Color.white : Theme.textSecondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                    .background(step.current ? Theme.selectedNav : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .help(step.detail)
            }
        }
    }

    private func page<V: View>(_ place: ShellPlace, @ViewBuilder _ view: () -> V) -> some View {
        view()
            .opacity(navigation.place == place ? 1 : 0)
            .allowsHitTesting(navigation.place == place)
            .disabled(navigation.place != place)
            .accessibilityHidden(navigation.place != place)
    }
}
