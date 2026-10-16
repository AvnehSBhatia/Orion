import SwiftUI

// Shared building blocks. Every screen is made of these, so the look stays in one place.

// MARK: Screen

/// A window's content: space background, a pinned header (optional), and a
/// centered, scrolling column at most `Theme.contentMaxWidth` wide.
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
                    .padding(.top, embedded ? Theme.Space.l : Theme.titlebarInset + Theme.Space.s)
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
            .frame(maxWidth: maxWidth, alignment: .leading)
            .padding(.horizontal, Theme.windowPadding)
            .frame(maxWidth: .infinity)
    }
}

/// Title, optional small secondary text after it, trailing controls, and a constellation underline.
struct WindowHeader<Trailing: View>: View {
    let title: String
    var detail: String?
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s) {
                Text(title).font(Theme.Typo.windowTitle)
                if let detail { Text(detail).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary) }
                Spacer(minLength: Theme.Space.s)
                trailing
            }
            if let subtitle {
                Text(subtitle).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            ConstellationDivider()
        }
    }
}

extension WindowHeader where Trailing == EmptyView {
    init(title: String, detail: String? = nil, subtitle: String? = nil) {
        self.init(title: title, detail: detail, subtitle: subtitle) { EmptyView() }
    }
}

// MARK: Cards

struct GlassCard<Content: View>: View {
    enum Emphasis { case normal, warning, dashed }

    var emphasis: Emphasis = .normal
    var padding: CGFloat = Theme.cardPadding
    @ViewBuilder var content: Content
    @State private var hovering = false
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(reduceTransparency ? Theme.cardSolid : (hovering ? Theme.cardFillHover : Theme.cardFill)))
            .overlay {
                switch emphasis {
                case .dashed:
                    shape.strokeBorder(Theme.textTertiary.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                case .warning:
                    shape.strokeBorder(Theme.warning.opacity(0.35), lineWidth: 1)
                case .normal:
                    shape.strokeBorder(hovering ? Theme.cardBorderHover : Theme.cardBorder, lineWidth: 1)
                }
            }
            .shadow(color: emphasis == .warning ? Theme.warning.opacity(0.18) : .clear, radius: 14)
            .onHover { hovering = $0 }
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
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.06)))
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
        case .sent: Image(systemName: "sparkle").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.line)
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
        case .sent: Theme.line
        }
    }
}

/// A small dot with a soft glow: green connected or on, amber waiting, red off.
struct GlowDot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(color).frame(width: size, height: size).shadow(color: color.opacity(0.7), radius: size * 0.6)
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
        .background(Color.white.opacity(0.06), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.08)))
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
            .background(Color.white.opacity(0.06), in: Capsule())
    }
}

// MARK: Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var small = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.Typo.caption.weight(.semibold) : Theme.Typo.bodyStrong)
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, small ? 10 : 14)
            .padding(.vertical, small ? 4 : 7)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

struct GhostButtonStyle: ButtonStyle {
    var small = false
    var color: Color = Theme.textPrimary
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? Theme.Typo.caption.weight(.medium) : Theme.Typo.body.weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, small ? 10 : 14)
            .padding(.vertical, small ? 4 : 7)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : (hovering ? 0.08 : 0.04)),
                        in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.14)))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
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
            .background(Circle().fill(Color.white.opacity(configuration.isPressed ? 0.14 : (hovering ? 0.08 : 0))))
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
                .foregroundStyle(Theme.textSecondary)
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
                .preferredColorScheme(.dark)
        }
    }
}

/// A few dots joined by hairlines, under titles and between sections.
struct ConstellationDivider: View {
    var body: some View {
        Canvas { context, size in
            let points = [0.0, 0.06, 0.13, 0.19].enumerated().map { index, x in
                CGPoint(x: x * min(size.width, 600) + 1.5, y: size.height / 2 + (index.isMultiple(of: 2) ? -2 : 2))
            }
            var path = Path()
            path.addLines(points)
            context.stroke(path, with: .color(Theme.line.opacity(0.35)), lineWidth: 0.5)
            for (index, point) in points.enumerated() {
                let r = index == 1 ? 1.6 : 1.1
                context.fill(Path(ellipseIn: CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)),
                             with: .color(Theme.star.opacity(index == 1 ? 0.9 : 0.6)))
            }
            // A hairline continuing faintly to the edge.
            var tail = Path()
            tail.move(to: CGPoint(x: points.last!.x + 6, y: size.height / 2))
            tail.addLine(to: CGPoint(x: size.width, y: size.height / 2))
            context.stroke(tail, with: .color(Color.white.opacity(0.06)), lineWidth: 0.5)
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}

/// The one thing to do next. One sentence, one button, so a screen never ends without a way forward.
struct NextStepBanner: View {
    let message: String
    let button: String
    let action: () -> Void

    var body: some View {
        GlassCard(emphasis: .warning) {
            HStack(alignment: .center, spacing: Theme.Space.m) {
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

/// A small constellation drawing, a title, and one line.
struct EmptyState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: Theme.Space.m) {
            ConstellationMark().frame(width: 90, height: 48)
            Text(title).font(Theme.Typo.bodyStrong)
            Text(message).font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Space.xl)
    }
}

/// Five stars joined by faint lines: empty states and the welcome screen.
struct ConstellationMark: View {
    var body: some View {
            Canvas { context, size in
                let points = [CGPoint(x: 0.1, y: 0.7), CGPoint(x: 0.35, y: 0.3), CGPoint(x: 0.6, y: 0.55), CGPoint(x: 0.9, y: 0.2), CGPoint(x: 0.75, y: 0.85)]
                    .map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                var path = Path()
                path.addLines(Array(points.prefix(4)))
                path.move(to: points[2])
                path.addLine(to: points[4])
                context.stroke(path, with: .color(Theme.line.opacity(0.4)), lineWidth: 0.7)
                for (index, point) in points.enumerated() {
                    let r = index == 1 ? 2.4 : 1.6
                    context.fill(Path(ellipseIn: CGRect(x: point.x - r, y: point.y - r, width: r * 2, height: r * 2)),
                                 with: .color(Theme.star.opacity(0.85)))
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: Fields

extension View {
    /// A text field look that fits the theme: soft fill, hairline border, accent focus ring.
    func spaceField() -> some View {
        textFieldStyle(.plain)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Theme.fieldFill, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Color.white.opacity(0.12)))
    }

    /// A capsule look for dropdown menus (client picker).
    func pillMenu() -> some View {
        menuStyle(.borderlessButton)
            .fixedSize()
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Color.white.opacity(0.07), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.14)))
    }
}
