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
        .tint(Theme.textPrimary)
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
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.m) {
                Text(title).font(Theme.Typo.windowTitle).tracking(-0.3)
                if let detail {
                    Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textTertiary)
                }
                Spacer(minLength: Theme.Space.s)
                if let statusLabel {
                    HStack(spacing: 6) {
                        Circle().fill(statusColor).frame(width: 6, height: 6)
                        Text(statusLabel)
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
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
    var expand = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AppFont.font(small ? 13 : 14, AppFont.semibold))
            .foregroundStyle(Theme.onPrimary)
            .padding(.horizontal, small ? 14 : 16)
            .padding(.vertical, small ? 7 : 9)
            .frame(maxWidth: expand ? .infinity : nil)
            .background(Theme.primaryFill.opacity(configuration.isPressed ? 0.82 : 1), in: Capsule())
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Capsule())
    }
}

struct GhostButtonStyle: ButtonStyle {
    var small = false
    var color: Color = Theme.textPrimary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AppFont.font(small ? 13 : 14, AppFont.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, small ? 14 : 16)
            .padding(.vertical, small ? 7 : 9)
            .background(Theme.buttonFill.opacity(configuration.isPressed ? 0.7 : 1), in: Capsule())
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Capsule())
    }
}

/// Plain text that acts like a link: "Change", "Show all".
struct LinkButtonStyle: ButtonStyle {
    var color: Color = Theme.textPrimary

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
            .fill(Theme.textTertiary.opacity(0.45))
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

/// The sidebar mark. Same geometry as the empty states, drawn small.
struct ConstellationMark: View {
    var body: some View {
        PlanetArt(compact: true)
            .accessibilityLabel("Constellation")
    }
}

/// The empty-state mark, larger than the sidebar.
struct OrbitalIllustration: View {
    var body: some View {
        PlanetArt(compact: false)
            .accessibilityHidden(true)
    }
}

/// The welcome panel. The mark sits on the panel color, with no extra scene.
struct PlanetPortrait: View {
    var body: some View {
        ZStack {
            Theme.welcomePanel
            PlanetArt(compact: false)
                .padding(36)
        }
        .accessibilityLabel("Constellation")
    }
}

/// A geometric C with one point in the counter. One stroke, one dot, no shading.
struct PlanetArt: View {
    var compact = false

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let origin = CGPoint(x: (size.width - side) / 2, y: (size.height - side) / 2)
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: origin.x + side * x / 100, y: origin.y + side * y / 100)
            }

            var letter = Path()
            letter.move(to: point(70, 24))
            letter.addLine(to: point(42, 24))
            letter.addCurve(to: point(24, 42), control1: point(28, 24), control2: point(24, 32))
            letter.addLine(to: point(24, 58))
            letter.addCurve(to: point(42, 76), control1: point(24, 68), control2: point(28, 76))
            letter.addLine(to: point(70, 76))

            context.stroke(
                letter,
                with: .color(Theme.textPrimary),
                style: StrokeStyle(lineWidth: side * 0.12, lineCap: .round, lineJoin: .round)
            )

            let dot = side * (compact ? 0.11 : 0.08)
            let center = point(54, 50)
            context.fill(
                Path(ellipseIn: CGRect(x: center.x - dot, y: center.y - dot, width: dot * 2, height: dot * 2)),
                with: .color(Theme.accent)
            )
        }
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
