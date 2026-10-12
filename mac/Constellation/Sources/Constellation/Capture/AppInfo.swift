import AppKit
import CaptureCore

enum AppKind: String {
    case native = "Native"
    case chromium = "Chromium"
    case electron = "Electron"
}

/// How well an app is known to work, from the M0 measurements.
enum Support: Equatable {
    case verified(note: String?)
    case unverified
    case blocked

    var label: String {
        switch self {
        case .verified: "Verified"
        case .unverified: "Unverified"
        case .blocked: "Blocked"
        }
    }
}

enum AppInfo {
    static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
        "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
    ]
    static let otherBrowsers: Set<String> = [
        "com.apple.Safari", "com.apple.SafariTechnologyPreview", "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition",
    ]

    /// Measured in M0. Everything else is unverified until measured.
    static let verified: [String: String?] = [
        "com.apple.Safari": "Title and URL only",
        "com.google.Chrome": "Title and URL only",
        "com.apple.mail": nil,
        "com.apple.Terminal": nil,
        "com.microsoft.VSCode": nil,
        "us.zoom.xos": nil,
    ]

    /// Browsers are captured as title plus domain and path only, never page text.
    static func isBrowser(_ bundleId: String) -> Bool {
        chromiumBrowsers.contains(bundleId) || otherBrowsers.contains(bundleId)
    }

    static func support(_ bundleId: String) -> Support {
        if ExclusionRules.isBlocked(bundleId: bundleId) { return .blocked }
        if let note = verified[bundleId] { return .verified(note: note) }
        return .unverified
    }

    @MainActor private static var kindCache: [String: AppKind] = [:]

    @MainActor static func kind(bundleId: String, bundleURL: URL?) -> AppKind {
        if let cached = kindCache[bundleId] { return cached }
        let kind = detectKind(bundleId: bundleId, bundleURL: bundleURL)
        kindCache[bundleId] = kind
        return kind
    }

    private static func detectKind(bundleId: String, bundleURL: URL?) -> AppKind {
        if chromiumBrowsers.contains(bundleId) { return .chromium }
        guard let bundleURL else { return .native }
        let frameworks = bundleURL.appendingPathComponent("Contents/Frameworks").path
        let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworks)) ?? []
        if names.contains("Electron Framework.framework") { return .electron }
        if names.contains(where: { $0.contains("Chrome") || $0.contains("Chromium") }) { return .chromium }
        return .native
    }
}
