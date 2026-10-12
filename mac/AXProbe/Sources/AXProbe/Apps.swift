import AppKit
import ApplicationServices

enum AppKind: String {
    case native = "Native"
    case chromium = "Chromium"
    case electron = "Electron"
}

struct FrontApp {
    let pid: pid_t
    let name: String
    let kind: AppKind
}

enum Apps {
    static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
        "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
    ]

    /// The app with keyboard focus right now, read fresh from the Accessibility API.
    /// (NSWorkspace's frontmost app only updates when a run loop is running, which
    /// this command line tool does not do.)
    static func frontmost() -> FrontApp? {
        let system = AXUIElementCreateSystemWide()
        var pid: pid_t = 0
        if let app = AXReader.element(AXReader.copy(system, kAXFocusedApplicationAttribute)),
           AXUIElementGetPid(app, &pid) == .success {
            return describe(pid)
        }
        return NSWorkspace.shared.frontmostApplication.flatMap { describe($0.processIdentifier) }
    }

    static func describe(_ pid: pid_t) -> FrontApp? {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return nil }
        return FrontApp(pid: pid, name: app.localizedName ?? "pid \(pid)", kind: kind(of: app))
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

/// Electron's switch for turning its accessibility tree on, used instead of
/// AXEnhancedUserInterface (spec 5.4). Whether Chrome itself honors it is one of
/// the things M0 finds out, so every result is recorded rather than assumed.
enum ManualAccessibility {
    static let attribute = "AXManualAccessibility" as CFString

    static func read(_ app: AXUIElement) -> String {
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(app, attribute, &value)
        guard error == .success else { return axName(error) }
        return (value as? Bool) == true ? "on" : "off"
    }

    static func set(_ app: AXUIElement, _ on: Bool) -> AXError {
        AXUIElementSetAttributeValue(app, attribute, (on ? kCFBooleanTrue : kCFBooleanFalse)!)
    }
}
