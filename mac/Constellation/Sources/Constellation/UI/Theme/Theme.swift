import AppKit
import SwiftUI

/// Design tokens for the Mac window: charcoal canvas, lilac accent, one radius.
enum Theme {
    // MARK: Background
    static let canvas = Color(hex: 0x101115)
    static let sidebar = Color(hex: 0x14151A)
    static let welcomePanel = Color(hex: 0x18151F)
    static let backgroundTop = canvas
    static let backgroundBottom = canvas
    static let glow = canvas
    static let nebula = canvas
    static let windowBackground = NSColor(red: 0x10 / 255, green: 0x11 / 255, blue: 0x15 / 255, alpha: 1)

    // MARK: Text
    static let textPrimary = Color(hex: 0xF2F1F7)
    static let textSecondary = Color(hex: 0xA0A1B1)
    static let textTertiary = Color(hex: 0x858797)

    // MARK: Accent and status
    static let accent = Color(hex: 0xAD97FF)
    static let onAccent = Color(hex: 0x101115)
    static let line = accent
    static let star = accent
    static let success = Color(hex: 0x8FCBB0)
    static let warning = Color(hex: 0xE3BA79)
    static let danger = Color(hex: 0xE39AA4)
    static let planetMid = Color(hex: 0x4B3D72)

    // MARK: Surfaces
    static let cardFill = Color(hex: 0x191A21)
    static let cardFillHover = Color(hex: 0x1E1F27)
    static let buttonFill = Color(hex: 0x20212A)
    static let selectedNav = Color(hex: 0x292339)
    static let border = Color(hex: 0x2C2D37)
    static let cardBorder = border
    static let cardBorderHover = border
    static let cardSolid = cardFill
    static let inset = Color(hex: 0x101115)
    static let fieldFill = buttonFill

    // MARK: Spacing and shape
    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
    }

    static let cardPadding: CGFloat = 16
    static let cardRadius: CGFloat = 12
    static let controlRadius: CGFloat = 8
    static let windowPadding: CGFloat = 24
    static let pageInset: CGFloat = 48
    static let pageTop: CGFloat = 30
    static let contentMaxWidth: CGFloat = 680
    static let sidebarWidth: CGFloat = 232
    /// Room for the traffic lights, since content runs under the transparent title bar.
    static let titlebarInset: CGFloat = 28

    // MARK: Type
    enum Typo {
        static let windowTitle = Font.system(size: 32, weight: .regular)
        static let sheetTitle = Font.system(size: 22, weight: .regular)
        static let sectionHeader = Font.system(size: 10, weight: .medium, design: .monospaced)
        static let body = Font.system(size: 13)
        static let bodyStrong = Font.system(size: 13, weight: .semibold)
        static let subtitle = Font.system(size: 14)
        static let caption = Font.system(size: 12)
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
