import AppKit
import ApplicationServices
import CaptureCore

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = Settings()
    private let stats = DebugStats()
    private lazy var engine = CaptureEngine(settings: settings, stats: stats, store: openStore())
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !AXIsProcessTrusted() {
            // Opens the system prompt. When run from Terminal, the permission belongs to Terminal.
            AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        }
        menuBar = MenuBarController(settings: settings, engine: engine, stats: stats)

        if CommandLine.arguments.contains("--smoke-test") {
            // Build everything, start nothing, and quit: no app is read.
            let laidOut = menuBar?.layOutWindowsOffscreen() ?? false
            print("Smoke test: menu bar built, windows laid out: \(laidOut ? "yes" : "NO"), capture is \(settings.captureOn ? "on" : "off"), \(settings.allowed.count) app(s) turned on.")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { NSApp.terminate(nil) }
            return
        }
        engine.start()

        print("""
        Constellation is running. Look for the eye icon at the top right of your menu bar.
        If your menu bar is full, macOS may hide it behind the camera notch; the Apps window has the same controls.
        Press Ctrl+C here, or choose Quit in the menu, to stop.
        """)
        // A menu bar app has no window of its own, so open the apps window on every
        // launch while M1 is run from Terminal. Onboarding (M4) replaces this.
        menuBar?.showApps()
    }
}
