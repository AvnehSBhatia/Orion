// swift-tools-version:6.0
import PackageDescription

// Constellation for Mac. M1: event driven capture and segmentation (spec section 5)
// with exclusions (section 7). Separate from mac/AXProbe, the M0 measurement tool.
let package = Package(
    name: "Constellation",
    platforms: [.macOS(.v14)],
    targets: [
        // Capture logic with no UI: reading, browser URLs, exclusions, segmentation.
        .target(name: "CaptureCore", path: "Sources/CaptureCore"),
        // The menu bar app.
        .executableTarget(name: "Constellation", dependencies: ["CaptureCore"], path: "Sources/Constellation"),
        // Swift Testing: the Command Line Tools ship it, but not XCTest (that needs Xcode).
        .testTarget(name: "CaptureCoreTests", dependencies: ["CaptureCore"], path: "Tests/CaptureCoreTests"),
    ]
)
