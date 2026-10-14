import AppKit
import CaptureCore
import Combine
import SwiftUI

/// The menu bar icon (spec 2.6): always visible, and it shows whether capture is
/// on, paused, or off. Clicking it opens a small popover with the status, Pause,
/// the windows, and Delete all (one click, spec 2.7).
@MainActor final class MenuBarController: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let popover = NSPopover()
    private let settings: Settings
    private let engine: CaptureEngine
    private let stats: DebugStats
    private let outbox: OutboxModel
    private let sender: Sender
    private let drafts: DraftModel
    private var windows: [String: NSWindow] = [:]
    private var sink: AnyCancellable?

    /// Default and minimum content sizes. Every screen is checked at its minimum.
    private static let sizes: [String: (initial: CGSize, minimum: CGSize)] = [
        "draft": (CGSize(width: 760, height: 680), CGSize(width: 560, height: 480)),
        "outbox": (CGSize(width: 780, height: 720), CGSize(width: 580, height: 520)),
        "apps": (CGSize(width: 680, height: 720), CGSize(width: 560, height: 520)),
        "welcome": (CGSize(width: 620, height: 560), CGSize(width: 560, height: 500)),
        "debug": (CGSize(width: 1040, height: 480), CGSize(width: 820, height: 360)),
    ]

    init(settings: Settings, engine: CaptureEngine, stats: DebugStats, outbox: OutboxModel, sender: Sender, drafts: DraftModel) {
        self.settings = settings
        self.engine = engine
        self.stats = stats
        self.outbox = outbox
        self.sender = sender
        self.drafts = drafts
        super.init()

        popover.behavior = .transient
        popover.appearance = NSAppearance(named: .darkAqua)
        popover.contentViewController = NSHostingController(rootView: popoverView)
        item.button?.target = self
        item.button?.action = #selector(togglePopover)

        sink = engine.$status.receive(on: RunLoop.main).sink { [weak self] status in
            MainActor.assumeIsolated { self?.updateIcon(status) }
        }
        updateIcon(engine.status)
    }

    private var popoverView: MenuPopoverView {
        MenuPopoverView(settings: settings, engine: engine, outbox: outbox, actions: MenuPopoverView.Actions(
            openDraft: { [weak self] in self?.open { $0.showDraft() } },
            openOutbox: { [weak self] in self?.open { $0.showOutbox() } },
            openApps: { [weak self] in self?.open { $0.showApps() } },
            openWelcome: { [weak self] in self?.open { $0.showWelcome() } },
            openDebug: { [weak self] in self?.open { $0.showDebug() } },
            deleteAll: { [weak self] in self?.engine.deleteAll() },
            quit: { NSApp.terminate(nil) }
        ))
    }

    private func open(_ show: (MenuBarController) -> Void) {
        popover.performClose(nil)
        show(self)
    }

    @objc private func togglePopover() {
        guard let button = item.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            outbox.refresh() // fresh "to review" count
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    private func updateIcon(_ status: CaptureStatus) {
        let (symbol, label): (String, String) = switch status.state {
        case .on: ("eye", "Constellation: capture on")
        case .paused: ("pause.circle", "Constellation: paused")
        case .off: ("eye.slash", "Constellation: capture off")
        }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = label
    }

    // MARK: Windows

    @objc func showApps() {
        show("apps", title: "Constellation: Apps and Privacy", AppPickerView(settings: settings, engine: engine) { [weak self] in
            self?.showDebug()
        })
    }

    @objc func showOutbox() {
        show("outbox", title: "Constellation: Outbox", OutboxView(model: outbox, settings: settings, sender: sender))
    }

    @objc func showDraft() {
        show("draft", title: "Constellation: Today's Draft", DraftView(model: drafts, directory: sender.directory))
    }

    @objc func showWelcome() {
        show("welcome", title: "Welcome to Constellation", OnboardingView(
            settings: settings,
            openApps: { [weak self] in self?.showApps() },
            finish: { [weak self] in self?.windows["welcome"]?.close() }
        ))
    }

    @objc func showDebug() {
        show("debug", title: "Constellation: Debug", DebugView(stats: stats, engine: engine))
    }

    /// Smoke test: lay out every screen without showing it.
    func layOutWindowsOffscreen() -> Bool {
        let views: [NSView] = [
            NSHostingController(rootView: AppPickerView(settings: settings, engine: engine) {}).view,
            NSHostingController(rootView: DebugView(stats: stats, engine: engine)).view,
            NSHostingController(rootView: OnboardingView(settings: settings, openApps: {}, finish: {})).view,
            NSHostingController(rootView: OutboxView(model: outbox, settings: settings, sender: sender)).view,
            NSHostingController(rootView: DraftView(model: drafts, directory: sender.directory)).view,
            NSHostingController(rootView: popoverView).view,
        ]
        views.forEach {
            $0.frame = NSRect(x: 0, y: 0, width: 600, height: 500)
            $0.layoutSubtreeIfNeeded()
        }
        return views.allSatisfy { $0.fittingSize.width > 0 }
    }

    #if DEBUG
    /// Development aid: render every screen at its minimum and default size, with
    /// fake sample data, to PNG files. Run with CONSTELLATION_RENDER_DIR=<folder> and
    /// --smoke-test. Nothing appears on screen.
    func renderScreens(to folder: URL) {
        drafts.loadSample()
        outbox.loadSample()
        sender.directory.apply(ClientsResponse(clients: [
            Client(id: "c_acme", name: "Acme Corp"), Client(id: "c_globex", name: "Globex"), Client(id: "c_initech", name: "Initech"),
        ], nextSince: nil))
        for (index, app) in ["Mail", "Safari", "Terminal"].enumerated() {
            var snapshot = Snapshot(appBundleId: "com.example.\(app)", appName: app)
            snapshot.foundWindow = true
            snapshot.chars = 1200 * (index + 1)
            snapshot.readMs = 12.5 * Double(index + 1)
            snapshot.redactionCount = index * 3
            stats.record(snapshot, trigger: .appSwitch)
        }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var screens: [(String, AnyView)] = [
            ("draft", AnyView(DraftView(model: drafts, directory: sender.directory))),
            ("outbox", AnyView(OutboxView(model: outbox, settings: settings, sender: sender))),
            ("apps", AnyView(AppPickerView(settings: settings, engine: engine) {})),
            ("debug", AnyView(DebugView(stats: stats, engine: engine))),
        ]
        for step in 0..<5 {
            screens.append(("welcome", AnyView(OnboardingView(settings: settings, openApps: {}, finish: {}, startStep: step))))
        }
        var counts: [String: Int] = [:]
        for (id, view) in screens {
            guard let size = Self.sizes[id] else { continue }
            counts[id, default: 0] += 1
            let suffix = id == "welcome" ? "-step\(counts[id]!)" : ""
            render(view, size: size.minimum, to: folder.appendingPathComponent("\(id)\(suffix)-min.png"))
            render(view, size: size.initial, to: folder.appendingPathComponent("\(id)\(suffix)-default.png"))
        }
        render(AnyView(popoverView), size: CGSize(width: 300, height: 430), to: folder.appendingPathComponent("popover.png"))
    }

    private func render(_ view: AnyView, size: CGSize, to url: URL) {
        let hosting = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        hosting.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.3)) // let SwiftUI settle
        guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return }
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }
    #endif

    /// Transparent title bar with full-size content, so the space background reaches
    /// the top; traffic lights stay, and the background is draggable.
    private func show<V: View>(_ id: String, title: String, _ view: V) {
        let window = windows[id] ?? {
            let hosting = NSHostingController(rootView: view)
            hosting.sizingOptions = [] // the window's size is ours, not the view's ideal size
            let window = NSWindow(contentViewController: hosting)
            window.title = title
            window.styleMask.insert([.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView])
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isMovableByWindowBackground = true
            window.appearance = NSAppearance(named: .darkAqua)
            window.backgroundColor = Theme.windowBackground
            window.isReleasedWhenClosed = false
            if let size = Self.sizes[id] {
                window.setContentSize(size.initial)
                window.contentMinSize = size.minimum
            }
            window.center()
            windows[id] = window
            return window
        }()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}
