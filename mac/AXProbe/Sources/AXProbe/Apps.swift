import AppKit
import ApplicationServices
import CoreGraphics

enum AppKind: String {
    case native = "Native"
    case chromium = "Chromium"
    case electron = "Electron"
}

struct FrontApp {
    let pid: pid_t
    let name: String
    let bundleId: String
    let kind: AppKind

    var isBrowser: Bool {
        Apps.chromiumBrowsers.contains(bundleId) || bundleId.hasPrefix("com.apple.Safari")
    }
}

enum Apps {
    static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
        "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
    ]

    /// The app in front right now. The on-screen window order comes first because
    /// it is always current. NSWorkspace's frontmost app is not used: it only
    /// updates while a run loop runs, which this command line tool never does, so
    /// it kept reporting Terminal.
    static func frontmost() -> FrontApp? {
        (windowListFrontPid() ?? accessibilityFrontPid()).flatMap(describe)
    }

    /// Owner of the topmost normal window on screen. Needs no permission: window
    /// titles would need Screen Recording, but owner and layer do not.
    static func windowListFrontPid() -> pid_t? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
        for window in windows { // front to back
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let pid = window[kCGWindowOwnerPID as String] as? pid_t else { continue }
            // Skip tiny helper windows some apps keep at the normal layer.
            if let bounds = window[kCGWindowBounds as String] as? [String: Any],
               let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
               width < 50 || height < 50 { continue }
            return pid
        }
        return nil
    }

    /// The app with keyboard focus, per the Accessibility API.
    static func accessibilityFrontPid() -> pid_t? {
        let system = AXUIElementCreateSystemWide()
        var pid: pid_t = 0
        guard let app = AXReader.element(AXReader.copy(system, kAXFocusedApplicationAttribute)),
              AXUIElementGetPid(app, &pid) == .success else { return nil }
        return pid
    }

    /// Both readings side by side, for when the probe picks the wrong app.
    static func diagnose() -> String {
        func label(_ pid: pid_t?) -> String {
            guard let pid else { return "unknown" }
            return describe(pid)?.name ?? "pid \(pid)"
        }
        return "window order says \(label(windowListFrontPid())), Accessibility says \(label(accessibilityFrontPid()))"
    }

    static func describe(_ pid: pid_t) -> FrontApp? {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
        return FrontApp(
            pid: pid, name: app.localizedName ?? "pid \(pid)", bundleId: app.bundleIdentifier ?? "", kind: kind(of: app)
        )
    }

    static func kind(of app: NSRunningApplication) -> AppKind {
        if let id = app.bundleIdentifier, chromiumBrowsers.contains(id) { return .chromium }
        guard let url = app.bundleURL else { return .native }
        let frameworks = url.appendingPathComponent("Contents/Frameworks").path
        let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworks)) ?? []
        if names.contains("Electron Framework.framework") { return .electron }
        if names.contains(where: { $0.contains("Chrome") || $0.contains("Chromium") }) { return .chromium }
        return .native
    }
}

/// App-level switches that turn a Chromium or Electron accessibility tree on.
/// AXManualAccessibility is Electron's, and what the spec uses (5.4). Chrome
/// rejected it in M0 round 1. AXEnhancedUserInterface is banned by the spec for
/// the app (it can break window animations and tiling tools) and is used here
/// only in a test-only Chrome row.
enum TreeFlag: String {
    case manual = "AXManualAccessibility"
    case enhanced = "AXEnhancedUserInterface"

    func read(_ app: AXUIElement) -> String {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(app, rawValue as CFString, &value)
        guard error == .success else { return axName(error) }
        return (value as? Bool) == true ? "on" : "off"
    }

    func set(_ app: AXUIElement, _ on: Bool) -> AXError {
        AXUIElementSetAttributeValue(app, rawValue as CFString, (on ? kCFBooleanTrue : kCFBooleanFalse)!)
    }
}
