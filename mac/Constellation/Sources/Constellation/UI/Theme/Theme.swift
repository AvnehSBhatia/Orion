import AppKit
import CoreText
import SwiftUI

/// Figtree, the geometric sans used for this window.
/// Four static faces are registered from beside the executable. Missing files use the system font, so the window still opens.
enum AppFont {
    static let regular: CGFloat = 400
    static let medium: CGFloat = 500
    static let semibold: CGFloat = 600
    static let bold: CGFloat = 700

    private static let faceFiles = [
        "Figtree-Regular.ttf",
        "Figtree-Medium.ttf",
        "Figtree-SemiBold.ttf",
        "Figtree-Bold.ttf",
    ]

    private static let registered: Void = {
        let urls = fontFileURLs()
        guard urls.count == faceFiles.count else {
            print("Orion typeface: system font. Figtree was not next to the app.")
            return
        }
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        print("Orion typeface: Figtree.")
    }()

    /// Safe to call more than once. Views also call it the first time they draw text.
    static func register() {
        _ = registered
    }

    static func font(_ size: CGFloat, _ weight: CGFloat = regular) -> Font {
        _ = registered
        return Font.custom(postScriptName(weight), size: size)
    }

    private static func postScriptName(_ weight: CGFloat) -> String {
        switch weight {
        case ..<450: "Figtree-Regular"
        case ..<550: "Figtree-Medium"
        case ..<650: "Figtree-SemiBold"
        default: "Figtree-Bold"
        }
    }

    /// Swift packages place resources in a sibling bundle. `Bundle.module` quits the app when that bundle is not found, so this looks beside the executable instead.
    /// The faces are static files. The variable font's only PostScript name is Figtree-Light, and SwiftUI then logs "Unable to update NSCTFontDescriptor" for every line.
    private static func fontFileURLs() -> [URL] {
        let manager = FileManager.default
        var roots: [URL] = []
        if let executable = Bundle.main.executableURL {
            roots.append(executable.deletingLastPathComponent())
        }
        if let resources = Bundle.main.resourceURL {
            roots.append(resources) // Orion.app/Contents/Resources, where scripts/package.sh puts the font
        }
        roots.append(Bundle.main.bundleURL)
        roots.append(Bundle.main.bundleURL.deletingLastPathComponent())

        var seen = Set<String>()
        for root in roots where seen.insert(root.path).inserted {
            if let match = fontFiles(in: root, manager) { return match }
            guard let items = try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { continue }
            for item in items where item.pathExtension == "bundle" {
                if let match = fontFiles(in: item, manager) { return match }
            }
        }
        return []
    }

    private static func fontFiles(in directory: URL, _ manager: FileManager) -> [URL]? {
        let folders = ["Fonts", "Resources/Fonts", ""]
        for folder in folders {
            let base = folder.isEmpty ? directory : directory.appendingPathComponent(folder)
            let urls = faceFiles.map { base.appendingPathComponent($0) }
            if urls.allSatisfy({ manager.fileExists(atPath: $0.path) }) { return urls }
        }
        return nil
    }
}

/// Warm dark surfaces, cream type, and one light pill for the main action.
enum Theme {
    // MARK: Background
    static let canvas = Color(hex: 0x161513)
    static let sidebar = canvas
    static let panel = Color(hex: 0x201F1C)
    static let welcomePanel = Color(hex: 0x242320)
    static let backgroundTop = canvas
    static let backgroundBottom = canvas
    static let glow = canvas
    static let nebula = canvas
    static let windowBackground = NSColor(srgbRed: 22 / 255, green: 21 / 255, blue: 19 / 255, alpha: 1)

    // MARK: Text
    static let textPrimary = Color(hex: 0xF4F2EC)
    static let textSecondary = Color(hex: 0xA8A59C)
    static let textTertiary = Color(hex: 0x7C7A73)

    // MARK: Accent and status
    /// Ember, for the planet ring and small highlights. Main buttons use primaryFill.
    static let accent = Color(hex: 0xE8943A)
    static let onAccent = Color(hex: 0x1A1916)
    static let primaryFill = Color(hex: 0xF3F1EA)
    static let onPrimary = Color(hex: 0x1A1916)
    static let line = accent
    static let star = accent
    static let success = Color(hex: 0x8FCBB0)
    static let warning = Color(hex: 0xE3BA79)
    static let danger = Color(hex: 0xE39AA4)
    static let planetMid = Color(hex: 0x8A5A32)

    // MARK: Surfaces
    static let cardFill = Color(hex: 0x2A2926)
    static let cardFillHover = Color(hex: 0x302F2B)
    static let buttonFill = Color(hex: 0x32312D)
    static let selectedNav = Color.white.opacity(0.08)
    static let border = Color.white.opacity(0.08)
    static let cardBorder = border
    static let cardBorderHover = border
    static let cardSolid = cardFill
    static let inset = Color(hex: 0x181715)
    static let fieldFill = Color(hex: 0x181715)

    // MARK: Spacing and shape
    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
    }

    static let cardPadding: CGFloat = 16
    static let cardRadius: CGFloat = 16
    static let panelRadius: CGFloat = 20
    static let controlRadius: CGFloat = 10
    static let windowPadding: CGFloat = 24
    static let pageInset: CGFloat = 28
    static let pageTop: CGFloat = 22
    static let contentMaxWidth: CGFloat = 720
    static let sidebarWidth: CGFloat = 228
    /// Room for the traffic lights, since content runs under the transparent title bar.
    static let titlebarInset: CGFloat = 28

    // MARK: Type
    enum Typo {
        static let windowTitle = AppFont.font(26, AppFont.semibold)
        static let sheetTitle = AppFont.font(20, AppFont.semibold)
        static let sectionHeader = AppFont.font(11, AppFont.medium)
        static let body = AppFont.font(14, AppFont.regular)
        static let bodyStrong = AppFont.font(14, AppFont.semibold)
        static let subtitle = AppFont.font(14, AppFont.regular)
        static let caption = AppFont.font(13, AppFont.regular)
        static let nav = AppFont.font(14, AppFont.medium)
        static let stat = AppFont.font(28, AppFont.medium)
        static let wordmark = AppFont.font(15, AppFont.semibold)
        static let mono = Font.system(size: 12, design: .monospaced)
        static let monoSmall = Font.system(size: 11, design: .monospaced)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
