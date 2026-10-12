import Foundation

// Every tunable number in one place (spec 5.3: limits must be constants in one file).

public enum Limits {
    // Walk limits (spec 5.3). Time raised from 50 ms to 100 ms after M0, where
    // Safari and Mail hit 50 ms on every walk. Walks run off the main thread.
    public static let maxDepth = 30
    public static let maxNodes = 2_000
    public static let maxWalkMs = 100.0
    public static let maxSnapshotChars = 8_000

    // Per Accessibility call. The system default is 6 seconds. Kept at the walk
    // budget so one slow call cannot push a read far past it (M1 saw 234 ms in
    // Safari with 0.25 s).
    public static let axTimeoutSeconds: Float = 0.1

    // Browser URL search: covers toolbars (for the address bar), which the text walk skips.
    public static let urlSearchMaxDepth = 15
    public static let urlSearchMaxNodes = 600

    // Private window search in browser toolbars (the profile button sits near the top).
    public static let privacySearchMaxDepth = 10
    public static let privacySearchMaxNodes = 400

    // Records (spec 5.5).
    public static let maxRecordChars = 4_000
    public static let idleGapSeconds: TimeInterval = 120

    // Triggers (spec 5.2).
    public static let contentDebounceSeconds: TimeInterval = 10 // per window
    public static let titleDebounceSeconds: TimeInterval = 1 // coalesces rapid title changes
    public static let rereadAfterSwitchSeconds: TimeInterval = 1.5 // M0: the first read after a switch is unreliable
    public static let idleThresholdSeconds: TimeInterval = 120
    public static let idleCheckSeconds: TimeInterval = 5

    // The segmenter keeps recent records in memory; every record is also saved to the encrypted store (M3).
    public static let maxRecordsInMemory = 500

    // Retention (spec M3): captured text is cleared from stored records after this many days.
    public static let rawTextRetentionDays = 30
    public static let retentionCheckSeconds: TimeInterval = 3600

    /// Low Power Mode doubles every debounce (spec 13).
    public static func debounce(_ seconds: TimeInterval) -> TimeInterval {
        ProcessInfo.processInfo.isLowPowerModeEnabled ? seconds * 2 : seconds
    }
}
