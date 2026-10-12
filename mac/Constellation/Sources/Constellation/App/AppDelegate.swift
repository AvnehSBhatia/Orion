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
            print("Smoke test: menu bar built, capture is \(settings.captureOn ? "on" : "off"), \(settings.allowed.count) app(s) turned on.")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { NSApp.terminate(nil) }
            return
        }
        engine.start()
    }
}
