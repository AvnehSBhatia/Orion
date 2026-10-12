import AppKit
import ApplicationServices

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = Settings()
    private let stats = DebugStats()
    private lazy var engine = CaptureEngine(settings: settings, stats: stats)
    private var menuBar: MenuBarController?

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
        // A menu bar app has no window, so open the apps window until there is something to capture.
        if !settings.captureOn || settings.allowed.isEmpty {
            menuBar?.showApps()
        }
    }
}
