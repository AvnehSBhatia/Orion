import SwiftUI

/// Flat canvas. The window is one color, so the sidebar and cards are what separate the regions.
struct SpaceBackground: View {
    var body: some View {
        Theme.canvas
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
