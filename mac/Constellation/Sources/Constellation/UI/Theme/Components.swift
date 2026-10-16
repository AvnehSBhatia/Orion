import AppKit
import SwiftUI

// Shared building blocks. Every screen is made of these, so the look stays in one place.

// MARK: Screen

/// A window's content: canvas background, a pinned header (optional), and a column.
struct SpaceScreen<Header: View, Content: View>: View {
    var maxWidth: CGFloat = Theme.contentMaxWidth
    var scrolls = true
    /// Inside the main window the shell paints the background and the sidebar.
    var embedded = false
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .top) {
            if !embedded { SpaceBackground() }
            VStack(spacing: 0) {
                column { header }
                    .padding(.top, embedded ? Theme.pageTop : Theme.titlebarInset + Theme.Space.s)
                if scrolls {
                    ScrollView {
                        column { content }
                            .padding(.top, Theme.Space.l)
                            .padding(.bottom, Theme.windowPadding)
                    }
                    .scrollIndicators(.automatic)
                } else {
                    column { content }
                        .padding(.top, Theme.Space.l)
                        .padding(.bottom, Theme.windowPadding)
                    Spacer(minLength: 0)
                }
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .font(Theme.Typo.body)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func column<C: View>(@ViewBuilder _ inner: () -> C) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) { inner() }
            .frame(maxWidth: embedded ? .infinity : maxWidth, alignment: .leading)
            .padding(.horizontal, embedded ? Theme.pageInset : Theme.windowPadding)
            .frame(maxWidth: .infinity)
    }
}

/// Eyebrow, title, subtitle, and an optional connection status.
struct WindowHeader<Trailing: View>: View {
    let title: String
    var detail: String?
    var subtitle: String?
    var eyebrow: String? = nil
    var statusLabel: String? = nil
    var statusColor: Color = Theme.textTertiary
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            if eyebrow != nil || statusLabel != nil {
                HStack(alignment: .center, spacing: Theme.Space.s) {
                    if let eyebrow {
                        Text(eyebrow.uppercased())
                            .font(Theme.Typo.sectionHeader)
                            .kerning(1.1)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    Spacer(minLength: Theme.Space.s)
                    if let statusLabel {
                        HStack(spacing: 6) {
                            Circle().fill(statusColor).frame(width: 5, height: 5)
                            Text(statusLabel.uppercased())
                                .font(Theme.Typo.sectionHeader)
                                .kerning(0.8)
                                .foregroundStyle(statusColor)
                        }
                    }
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                Text(title).font(Theme.Typo.windowTitle)
                if let detail {
                    Text(detail).font(Theme.Typo.subtitle).foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: Theme.Space.s)
                trailing
            }
            if let subtitle {
                Text(subtitle)
                    .font(Theme.Typo.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension WindowHeader where Trailing == EmptyView {
    init(title: String, detail: String? = nil, subtitle: String? = nil, eyebrow: String? = nil, statusLabel: String? = nil, statusColor: Color = Theme.textTertiary) {
        self.init(title: title, detail: detail, subtitle: subtitle, eyebrow: eyebrow, statusLabel: statusLabel, statusColor: statusColor) { EmptyView() }
    }
}

// MARK: Cards

struct GlassCard<Content: View>: View {
    enum Emphasis { case normal, warning, dashed }

    var emphasis: Emphasis = .normal
    var padding: CGFloat = Theme.cardPadding
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(reduceTransparency ? Theme.cardSolid : Theme.cardFill))
            .overlay {
                switch emphasis {
                case .dashed:
                    shape.strokeBorder(Theme.textTertiary.opacity(0.55), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                case .warning:
                    shape.strokeBorder(Theme.warning.opacity(0.45), lineWidth: 1)
                case .normal:
                    shape.strokeBorder(Theme.border, lineWidth: 1)
                }
            }
    }
}

/// A recessed panel for monospaced content (payloads, evidence).
struct InsetPanel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .font(Theme.Typo.monoSmall)
            .foregroundStyle(Theme.textSecondary)
            .padding(Theme.Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
    }
}

// MARK: Stars and status

/// A five-pointed star outline, for StarBadge (so it can be dashed).
struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * 0.45
        var path = Path()
        for index in 0..<10 {
            let radius = index.isMultiple(of: 2) ? outer : inner
            let angle = Double(index) * .pi / 5 - .pi / 2
            let point = CGPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle))
            index == 0 ? path.move(to: point) : path.addLine(to: point)
        }
        path.closeSubpath()
        return path
    }
}

/// accepted: filled mint star. needsReview: outlined amber star. noClient: dashed ghost star.
/// sent: a small spark. rejected: a dimmed slashed star.
struct StarBadge: View {
    enum Kind { case accepted, needsReview, noClient, sent, rejected }

    let kind: Kind
    var label: String?

    var body: some View {
        HStack(spacing: 5) {
            icon.frame(width: 13, height: 13)
            if let text = label ?? defaultLabel, !text.isEmpty {
                Text(text).font(Theme.Typo.caption.weight(.medium)).foregroundStyle(color)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var icon: some View {
        switch kind {
        case .accepted: StarShape().fill(Theme.success)
        case .needsReview: StarShape().stroke(Theme.warning, lineWidth: 1.3)
        case .noClient: StarShape().stroke(Theme.textTertiary, style: StrokeStyle(lineWidth: 1, dash: [2, 1.6]))
        case .sent: Image(systemName: "sparkle").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accent)
        case .rejected: Image(systemName: "star.slash").font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
        }
    }

    private var defaultLabel: String? {
        switch kind {
        case .accepted: "Accepted"
        case .needsReview: "Needs review"
        case .noClient: "Pick a client"
        case .sent: "Sent"
        case .rejected: "Rejected"
        }
    }

    private var color: Color {
        switch kind {
        case .accepted: Theme.success
        case .needsReview: Theme.warning
        case .noClient, .rejected: Theme.textTertiary
        case .sent: Theme.accent
        }
    }
}

/// A small status dot. Paused and waiting use amber.
struct GlowDot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
    }
}

/// A rounded pill with an optional icon: stats, counts.
struct StatusPill: View {
    var icon: String?
    let text: String
    var color: Color = Theme.textSecondary

    var body: some View {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 10.5, weight: .semibold)) }
            Text(text).font(Theme.Typo.caption.weight(.medium)).monospacedDigit()
        }
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(Theme.buttonFill, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border))
    }
}

/// A tiny label chip: "3 items", "11 redactions".
struct Chip: View {
    let text: String
    var color: Color = Theme.textSecondary

    var body: some View {
        Text(text)
            .font(Theme.Typo.caption)
            .monospacedDigit()
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Theme.buttonFill, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border))
    }
}

// MARK: Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var small = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.Typo.caption.weight(.semibold) : Font.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, small ? 12 : 16)
            .padding(.vertical, small ? 6 : 11)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.82 : 1), in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

struct GhostButtonStyle: ButtonStyle {
    var small = false
    var color: Color = Theme.textPrimary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.Typo.caption.weight(.semibold) : Font.system(size: 13, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, small ? 12 : 16)
            .padding(.vertical, small ? 6 : 11)
            .background(Theme.buttonFill.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

/// Plain text that acts like a link: "Change", "Show all".
struct LinkButtonStyle: ButtonStyle {
    var color: Color = Theme.accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Typo.caption.weight(.medium))
            .foregroundStyle(color.opacity(configuration.isPressed ? 0.7 : 1))
            .contentShape(Rectangle())
    }
}

/// An SF Symbol button with a round hover background and a tooltip.
struct IconButton: View {
    let symbol: String
    let help: String
    var color: Color = Theme.textSecondary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 12.5, weight: .semibold))
        }
        .buttonStyle(IconButtonStyle(color: color))
        .help(help)
        .accessibilityLabel(help)
    }
}

struct IconButtonStyle: ButtonStyle {
    var color: Color = Theme.textSecondary
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(color)
            .frame(width: 28, height: 28)
            .background(Circle().fill(Theme.buttonFill.opacity(configuration.isPressed ? 1 : (hovering ? 0.9 : 0))))
            .contentShape(Circle())
            .onHover { hovering = $0 }
    }
}

// MARK: Headers, dividers, info

/// "WAITING FOR REVIEW  (2)  (i)"
struct SectionHeader: View {
    let title: String
    var count: Int?
    var info: String?
    var countColor: Color = Theme.textSecondary

    var body: some View {
        HStack(spacing: Theme.Space.s) {
            Text(title.uppercased())
                .font(Theme.Typo.sectionHeader)
                .kerning(0.8)
                .foregroundStyle(Theme.textTertiary)
            if let count { Chip(text: "\(count)", color: countColor) }
            if let info { InfoButton(text: info) }
            Spacer(minLength: 0)
        }
    }
}

/// An (i) that shows a short explanation in a popover.
struct InfoButton: View {
    let text: String
    @State private var shown = false

    var body: some View {
        Button { shown.toggle() } label: {
            Image(systemName: "info.circle").font(.system(size: 12))
        }
        .buttonStyle(IconButtonStyle(color: Theme.textTertiary))
        .frame(width: 20, height: 20)
        .help("More about this")
        .popover(isPresented: $shown, arrowEdge: .bottom) {
            Text(text)
                .font(Theme.Typo.body)
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 280, alignment: .leading)
                .padding(Theme.Space.l)
                .background(Theme.cardFill)
                .preferredColorScheme(.dark)
        }
    }
}

/// A one-pixel rule between regions.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(Theme.border).frame(height: 1).accessibilityHidden(true)
    }
}

/// A short accent rule under a welcome line.
struct ConstellationDivider: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Theme.accent)
            .frame(width: 36, height: 2)
            .accessibilityHidden(true)
    }
}

/// The one thing to do next. One sentence, one button.
struct NextStepBanner: View {
    let message: String
    let button: String
    var icon: String = "exclamationmark.triangle"
    let action: () -> Void

    var body: some View {
        GlassCard {
            HStack(alignment: .center, spacing: Theme.Space.m) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.warning)
                Text(message)
                    .font(Theme.Typo.body)
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Theme.Space.s)
                Button(button, action: action).buttonStyle(PrimaryButtonStyle(small: true))
            }
        }
    }
}

/// A small mark, a title, and one line.
struct EmptyState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: Theme.Space.m) {
            ConstellationMark().frame(width: 36, height: 34)
            Text(title).font(Theme.Typo.bodyStrong)
            Text(message).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Space.xl)
    }
}

/// The constellation mark: two lilac strokes.
struct ConstellationMark: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 31.3277, size.height / 30.4515)
            let origin = CGPoint(
                x: (size.width - 31.3277 * scale) / 2,
                y: (size.height - 30.4515 * scale) / 2
            )
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
            }
            var first = Path()
            first.move(to: point(30.6639, 0.348997))
            first.addLine(to: point(21.0639, 18.6099))
            first.addLine(to: point(10.2639, 4.26204))
            first.addLine(to: point(0.663853, 22.5229))
            var second = Path()
            second.move(to: point(10.2639, 4.26204))
            second.addLine(to: point(13.8639, 30.349))
            let style = StrokeStyle(lineWidth: max(1.25, 1.5 * scale), lineCap: .round, lineJoin: .round)
            context.stroke(first, with: .color(Theme.accent), style: style)
            context.stroke(second, with: .color(Theme.accent), style: style)
        }
        .accessibilityLabel("Constellation")
    }
}

/// Two orbits, a lilac body, and one point. Drawn from the design paths.
struct OrbitalIllustration: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / 264.696, size.height / 184.661)
            let origin = CGPoint(
                x: (size.width - 264.696 * scale) / 2,
                y: (size.height - 184.661 * scale) / 2
            )
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
            }
            func curve(_ start: (CGFloat, CGFloat), _ curves: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)]) -> Path {
                var path = Path()
                path.move(to: point(start.0, start.1))
                for curve in curves {
                    path.addCurve(
                        to: point(curve.4, curve.5),
                        control1: point(curve.0, curve.1),
                        control2: point(curve.2, curve.3)
                    )
                }
                path.closeSubpath()
                return path
            }
            let outer = curve(
                (264.298, 32.894),
                [
                    (269.81, 58.8244, 217.347, 91.9462, 147.119, 106.874),
                    (76.8906, 121.801, 15.4914, 112.881, 9.97976, 86.9511),
                    (4.46809, 61.0207, 56.9311, 27.8989, 127.159, 12.9715),
                    (197.387, -1.95596, 258.786, 6.96368, 264.298, 32.894),
                ]
            )
            let inner = curve(
                (178.335, 146.268),
                [
                    (164.37, 180.833, 117.765, 194.597, 74.2387, 177.011),
                    (30.7128, 159.426, 6.74901, 117.15, 20.7141, 82.5849),
                    (34.6791, 48.0202, 81.2847, 34.256, 124.811, 51.8416),
                    (168.337, 69.4272, 192.3, 111.703, 178.335, 146.268),
                ]
            )
            let stroke = StrokeStyle(lineWidth: max(1.25, 2 * scale), lineCap: .round, lineJoin: .round)
            context.stroke(outer, with: .color(Theme.border), style: stroke)
            context.stroke(inner, with: .color(Theme.selectedNav), style: stroke)
            let bodyRect = CGRect(
                x: point(130 - 32, 90 - 32).x,
                y: point(130 - 32, 90 - 32).y,
                width: 64 * scale,
                height: 64 * scale
            )
            context.fill(
                Path(ellipseIn: bodyRect),
                with: .linearGradient(
                    Gradient(colors: [Theme.accent, Theme.planetMid, Theme.canvas]),
                    startPoint: CGPoint(x: bodyRect.minX, y: bodyRect.midY),
                    endPoint: CGPoint(x: bodyRect.maxX, y: bodyRect.midY)
                )
            )
            let dot = 5 * scale
            let dotOrigin = point(222.5, 57.5)
            context.fill(
                Path(ellipseIn: CGRect(x: dotOrigin.x - dot / 2, y: dotOrigin.y - dot / 2, width: dot, height: dot)),
                with: .color(Theme.accent)
            )
        }
        .accessibilityHidden(true)
    }
}

/// The welcome portrait. Falls back to the orbital drawing if the image is missing.
struct PlanetPortrait: View {
    var body: some View {
        Group {
            if let image = Self.load() {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
            } else {
                ZStack {
                    Theme.welcomePanel
                    OrbitalIllustration().padding(24)
                }
            }
        }
        .accessibilityLabel("Constellation")
    }

    private static func load() -> NSImage? {
        guard let url = Bundle.module.url(forResource: "planet", withExtension: "jpg") else { return nil }
        return NSImage(contentsOf: url)
    }
}

// MARK: Fields

extension View {
    /// A text field look that fits the theme: solid fill, hairline border.
    func spaceField() -> some View {
        textFieldStyle(.plain)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
    }

    /// A capsule look for dropdown menus (client picker).
    func pillMenu() -> some View {
        menuStyle(.borderlessButton)
            .fixedSize()
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Theme.buttonFill, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.border))
    }
}
