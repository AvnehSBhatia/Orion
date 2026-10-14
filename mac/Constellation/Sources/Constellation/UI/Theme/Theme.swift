import AppKit
import SwiftUI

/// Design tokens for every screen: a calm, always-dark "space" look.
/// Contrast was checked against the brightest surface (a card over the top-left
/// glow): primary 11 to 17:1, secondary 5.3 to 6.9:1, tertiary 4.5 to 5.4:1,
/// mint, amber, coral 5 to 8:1, dark text on periwinkle 8.2:1.
enum Theme {
    // MARK: Background
    static let backgroundTop = Color(hex: 0x070B1A)
    static let backgroundBottom = Color(hex: 0x0E1530)
    static let glow = Color(hex: 0x1B2350)
    static let nebula = Color(hex: 0x3A2A6B)
    static let windowBackground = NSColor(red: 0x0B / 255, green: 0x10 / 255, blue: 0x25 / 255, alpha: 1)

    // MARK: Text
    static let textPrimary = Color(hex: 0xEAF0FF)
    static let textSecondary = textPrimary.opacity(0.62)
    /// 56%, not 50%: 50% fell to 4.0:1 on cards; 55% is the lowest that passes 4.5:1 everywhere.
    static let textTertiary = textPrimary.opacity(0.56)

    // MARK: Accent and status
    static let accent = Color(hex: 0x8AA4FF) // primary actions, focus
    static let onAccent = Color(hex: 0x070B1A) // text on accent
    static let line = Color(hex: 0x6FE3FF) // constellation lines
    static let star = Color(hex: 0xFFF4D6)
    static let success = Color(hex: 0x5EE6B0)
    static let warning = Color(hex: 0xFFC46B)
    static let danger = Color(hex: 0xFF7A8A)

    // MARK: Surfaces
    static let cardFill = Color.white.opacity(0.06)
    static let cardFillHover = Color.white.opacity(0.085)
    static let cardBorder = Color.white.opacity(0.10)
    static let cardBorderHover = Color.white.opacity(0.16)
    /// Used instead of translucent fills when Reduce Transparency is on.
    static let cardSolid = Color(hex: 0x1A2140)
    static let inset = Color.black.opacity(0.28) // code and payload panels
    static let fieldFill = Color.white.opacity(0.05)

    // MARK: Spacing and shape
    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
    }

    static let cardPadding: CGFloat = 16
    static let cardRadius: CGFloat = 14
    static let controlRadius: CGFloat = 8
    static let windowPadding: CGFloat = 24
    static let contentMaxWidth: CGFloat = 680
    /// Room for the traffic lights, since content runs under the transparent title bar.
    static let titlebarInset: CGFloat = 28

    // MARK: Type
    enum Typo {
        static let windowTitle = Font.system(size: 22, weight: .semibold)
        static let sectionHeader = Font.system(size: 12, weight: .semibold)
        static let body = Font.system(size: 13)
        static let bodyStrong = Font.system(size: 13, weight: .semibold)
        static let caption = Font.system(size: 11.5)
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
