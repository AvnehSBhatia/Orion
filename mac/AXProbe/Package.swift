// swift-tools-version:6.0
import PackageDescription

// M0 capture probe for Constellation for Mac (spec section 12).
// A command line tool, so it builds with the Command Line Tools alone; no Xcode project needed.
let package = Package(
    name: "AXProbe",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "ax-probe", path: "Sources/AXProbe"),
    ],
    // The probe talks to C APIs (Accessibility, libproc) with global constants that
    // Swift 6 strict concurrency flags. Swift 5 mode keeps this throwaway tool simple.
    swiftLanguageModes: [.v5]
)
