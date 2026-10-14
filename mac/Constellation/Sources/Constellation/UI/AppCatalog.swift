import AppKit
import UniformTypeIdentifiers

struct AppEntry: Identifiable {
    let id: String // bundle id
    let name: String
    let support: Support
    let kind: AppKind
    let url: URL?

    /// The app's own icon, for the picker.
    @MainActor var icon: NSImage { AppIcons.icon(for: url) }
}

@MainActor enum AppIcons {
    private static var cache: [URL: NSImage] = [:]
    private static let fallback = NSWorkspace.shared.icon(for: .application)

    static func icon(for url: URL?) -> NSImage {
        guard let url else { return fallback }
        if let cached = cache[url] { return cached }
        let icon = NSWorkspace.shared.icon(forFile: url.path)
        cache[url] = icon
        return icon
    }
}

/// Installed apps for the picker (spec 7), plus any running app not found on disk.
enum AppCatalog {
    @MainActor static func load() -> [AppEntry] {
        let folders = [
            "/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
            NSHomeDirectory() + "/Applications",
        ]
        var entries: [String: AppEntry] = [:]
        func add(id: String, name: String, url: URL?) {
            guard entries[id] == nil else { return }
            entries[id] = AppEntry(id: id, name: name, support: AppInfo.support(id), kind: AppInfo.kind(bundleId: id, bundleURL: url), url: url)
        }
        for folder in folders {
            let names = (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []
            for file in names where file.hasSuffix(".app") {
                let url = URL(fileURLWithPath: folder).appendingPathComponent(file)
                guard let id = Bundle(url: url)?.bundleIdentifier else { continue }
                add(id: id, name: String(file.dropLast(4)), url: url)
            }
        }
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            guard let id = app.bundleIdentifier, id != Bundle.main.bundleIdentifier else { continue }
            add(id: id, name: app.localizedName ?? id, url: app.bundleURL)
        }
        return entries.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}
