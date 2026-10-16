import AppKit
import ApplicationServices
import CaptureCore

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = Settings()
    private let stats = DebugStats()
    private let smokeTest = CommandLine.arguments.contains("--smoke-test")
    // The smoke test never opens the store: after a rebuild, macOS asks before
    // the new binary may use the Keychain key, and nobody is there to answer.
    private lazy var engine = CaptureEngine(settings: settings, stats: stats, store: smokeTest ? nil : openStore())
    private lazy var outbox: OutboxModel = {
        let model = OutboxModel(store: engine.store, settings: settings, names: engine.names)
        engine.outbox = model
        return model
    }()
    private lazy var directory = ClientDirectory(store: engine.store, names: engine.names)
    private lazy var sender: Sender = {
        let sender = Sender(settings: settings, store: engine.store, directory: directory, useKeychain: !smokeTest)
        sender.outbox = outbox
        outbox.sender = sender
        outbox.directory = directory
        engine.directory = directory
        return sender
    }()
    private lazy var drafts = DraftModel(sender: sender, settings: settings, store: engine.store)
    private var menuBar: MenuBarController?

    /// The encrypted store. If it cannot open (for example the Keychain refuses), capture
    /// still works and records stay in memory; the debug view says so.
    private func openStore() -> RecordStore? {
        do {
            return try RecordStore.openDefault()
        } catch {
            print("Constellation store: could not open (\(error)). Records will stay in memory only.")
            return nil
        }
    }

    /// A menu bar app has no menu of its own; this one only makes Command-Q (quit),
    /// Command-W (close) and the edit shortcuts work while a Constellation window is in front.
    private func installMainMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu()
        appItem.submenu?.addItem(withTitle: "Quit Orion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // No permission prompt here: the welcome screens explain what is read first,
        // and ask for the permission themselves (spec 5.1).
        AppFont.register()
        menuBar = MenuBarController(settings: settings, engine: engine, stats: stats, outbox: outbox, sender: sender, drafts: drafts)
        installMainMenu()

        if smokeTest {
            // Build everything, start nothing, and quit: no app is read.
            #if DEBUG
            if let folder = ProcessInfo.processInfo.environment["CONSTELLATION_RENDER_DIR"] {
                menuBar?.renderScreens(to: URL(fileURLWithPath: folder))
            }
            #endif
            let laidOut = menuBar?.layOutWindowsOffscreen() ?? false
            print("Smoke test: menu bar built, windows laid out: \(laidOut ? "yes" : "NO"), capture is \(settings.captureOn ? "on" : "off"), \(settings.allowed.count) app(s) turned on.")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { NSApp.terminate(nil) }
            return
        }
        engine.start()
        sender.start()

        print("""
        Orion is running, and its window should be in front.
        The sidebar says Orion, next to three stars. Scroll a page and the title bar leaves. Scroll back to the top and it returns.
        If the sidebar still says Constellation, this is an older copy: quit, then pull and rebuild.
        Setup is listed in the sidebar, under Today, Outbox, Apps, and Settings.
        The eye in the menu bar opens that window again. On a MacBook, a full menu bar can hide the eye behind the camera notch, so the window also opens whenever you start the app.
        Press Ctrl+C here, or choose Quit Orion in the menu bar popover, to stop.
        """)
        // First run, or no permission yet: the welcome screens, then the window on Apps.
        // After that the window still opens. The menu bar eye is easy to lose under the notch.
        if !settings.onboardingDone || !AXIsProcessTrusted() {
            menuBar?.showWelcome()
        } else {
            menuBar?.show(.today)
        }
    }
}
