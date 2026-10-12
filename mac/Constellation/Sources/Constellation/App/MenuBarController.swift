import AppKit
import Combine
import SwiftUI

/// The menu bar icon (spec 2.6): always visible, and it shows whether capture is
/// on, paused, or off. Pause and delete all are one click each (spec 2.7).
@MainActor final class MenuBarController: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let settings: Settings
    private let engine: CaptureEngine
    private let stats: DebugStats
    private var windows: [String: NSWindow] = [:]
    private var sink: AnyCancellable?

    init(settings: Settings, engine: CaptureEngine, stats: DebugStats) {
        self.settings = settings
        self.engine = engine
        self.stats = stats
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        sink = engine.$status.receive(on: RunLoop.main).sink { [weak self] status in
            MainActor.assumeIsolated { self?.updateIcon(status) }
        }
        updateIcon(engine.status)
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

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let status = engine.status
        menu.addItem(disabled(headline(status)))
        menu.addItem(.separator())

        switch status.state {
        case .off:
            menu.addItem(action("Turn capture on", #selector(turnOn)))
        case .on:
            menu.addItem(action("Pause for 1 hour", #selector(pauseHour)))
            menu.addItem(action("Pause until tomorrow", #selector(pauseTomorrow)))
            menu.addItem(action("Turn capture off", #selector(turnOff)))
        case .paused:
            menu.addItem(action("Resume", #selector(resume)))
            menu.addItem(action("Turn capture off", #selector(turnOff)))
        }
        menu.addItem(.separator())
        menu.addItem(action("Choose apps…", #selector(showApps)))
        menu.addItem(action("Debug view…", #selector(showDebug)))
        menu.addItem(.separator())
        menu.addItem(action("Delete all captured data", #selector(deleteAll)))
        menu.addItem(.separator())
        menu.addItem(action("Quit Constellation", #selector(quit)))
    }

    private func headline(_ status: CaptureStatus) -> String {
        switch status.state {
        case .off: return "Capture is off"
        case .paused(let until): return "Paused until \(until.formatted(date: .abbreviated, time: .shortened))"
        case .on:
            if !status.trusted { return "Needs Accessibility permission" }
            if settings.allowed.isEmpty { return "Capture is on, no apps chosen" }
            return status.systemAvailable ? "Capture is on" : "Capture is on, waiting (locked or asleep)"
        }
    }

    // MARK: Actions

    @objc private func turnOn() { settings.captureOn = true }
    @objc private func turnOff() { settings.captureOn = false }
    @objc private func pauseHour() { settings.pause(for: 3600) }
    @objc private func pauseTomorrow() { settings.pauseUntilTomorrow() }
    @objc private func resume() { settings.resume() }
    @objc private func deleteAll() { engine.deleteAll() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc func showApps() {
        show("apps", title: "Constellation: apps", AppPickerView(settings: settings, engine: engine) { [weak self] in
            self?.showDebug()
        })
    }

    @objc func showDebug() {
        show("debug", title: "Constellation: debug", DebugView(stats: stats, engine: engine))
    }

    /// Smoke test: lay out both windows' views without showing them.
    func layOutWindowsOffscreen() -> Bool {
        let apps = NSHostingController(rootView: AppPickerView(settings: settings, engine: engine) {})
        let debug = NSHostingController(rootView: DebugView(stats: stats, engine: engine))
        for controller in [apps.view, debug.view] { controller.layoutSubtreeIfNeeded() }
        return apps.view.fittingSize.width > 0 && debug.view.fittingSize.width > 0
    }

    // MARK: Helpers

    private func show<V: View>(_ id: String, title: String, _ view: V) {
        let window = windows[id] ?? {
            let window = NSWindow(contentViewController: NSHostingController(rootView: view))
            window.title = title
            window.isReleasedWhenClosed = false
            window.center()
            windows[id] = window
            return window
        }()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func action(_ title: String, _ selector: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        item.target = self
        return item
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }
}
