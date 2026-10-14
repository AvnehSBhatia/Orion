import SwiftUI

/// Deep navy gradient, a faint glow top left, a faint violet nebula bottom right,
/// and a still star field. Drawn from a fixed seed, so it is identical on every
/// redraw (no flicker) and costs nothing when idle: there is no animation.
struct SpaceBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            if reduceTransparency {
                Theme.backgroundBottom
            } else {
                LinearGradient(colors: [Theme.backgroundTop, Theme.backgroundBottom], startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [Theme.glow.opacity(0.85), .clear], center: .topLeading, startRadius: 0, endRadius: 460)
                RadialGradient(colors: [Theme.nebula.opacity(0.25), .clear], center: .bottomTrailing, startRadius: 0, endRadius: 520)
            }
            StarField()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// About 70 tiny warm stars and two faint constellations in the corners.
struct StarField: View {
    struct Star {
        var x: Double // 0...1 of the width
        var y: Double // 0...1 of the height
        var radius: Double
        var opacity: Double
        var glows: Bool
    }

    static let stars: [Star] = {
        var rng = SeededRandom(seed: 0xC0FFEE)
        return (0..<70).map { index in
            Star(
                x: rng.next(), y: rng.next(),
                radius: 0.5 + rng.next() * 1.1,
                opacity: 0.2 + rng.next() * 0.7,
                glows: index % 12 == 0
            )
        }
    }()

    /// Two small groups, in unit coordinates: top right and bottom left.
    static let constellations: [[CGPoint]] = [
        [CGPoint(x: 0.80, y: 0.07), CGPoint(x: 0.86, y: 0.12), CGPoint(x: 0.92, y: 0.09), CGPoint(x: 0.95, y: 0.16), CGPoint(x: 0.89, y: 0.20)],
        [CGPoint(x: 0.05, y: 0.82), CGPoint(x: 0.11, y: 0.88), CGPoint(x: 0.17, y: 0.85), CGPoint(x: 0.22, y: 0.92)],
    ]

    var body: some View {
        Canvas { context, size in
            for star in Self.stars {
                let center = CGPoint(x: star.x * size.width, y: star.y * size.height)
                if star.glows {
                    let halo = star.radius * 4
                    context.fill(Path(ellipseIn: CGRect(x: center.x - halo, y: center.y - halo, width: halo * 2, height: halo * 2)),
                                 with: .color(Theme.star.opacity(star.opacity * 0.12)))
                }
                let r = star.radius
                context.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)),
                             with: .color(Theme.star.opacity(star.opacity)))
            }
            for group in Self.constellations {
                let points = group.map { CGPoint(x: $0.x * size.width, y: $0.y * size.height) }
                var path = Path()
                path.addLines(points)
                context.stroke(path, with: .color(Theme.line.opacity(0.12)), lineWidth: 0.5)
                for point in points {
                    context.fill(Path(ellipseIn: CGRect(x: point.x - 1.1, y: point.y - 1.1, width: 2.2, height: 2.2)),
                                 with: .color(Theme.star.opacity(0.55)))
                }
            }
        }
    }
}

/// SplitMix64: a tiny fixed-seed generator, so the stars land in the same place every time.
struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    /// 0..<1
    mutating func next() -> Double {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z ^= z >> 31
        return Double(z >> 11) / Double(1 << 53)
    }
}
