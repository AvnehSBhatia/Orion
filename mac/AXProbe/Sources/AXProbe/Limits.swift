// Every tunable number in one place (spec 5.3: limits must be constants in one file).

enum Limits {
    // Walk limits from spec 5.3. The time budget was raised from 50 ms to 100 ms
    // after M0 round 1: Safari and Mail hit 50 ms on every walk. Walks run off
    // the main thread, so the longer budget never blocks the UI.
    static let maxDepth = 30
    static let maxNodes = 2_000
    static let maxWalkMs = 100.0
    static let maxChars = 8_000

    // Browser address bar search. It covers toolbars, which the text walk skips.
    static let addressBarMaxDepth = 15
    static let addressBarMaxNodes = 600

    // Per Accessibility call. The system default is 6 seconds, which would let one
    // unresponsive app stall a walk far past the 50 ms budget.
    static let axTimeoutSeconds: Float = 0.25

    // A string with at least this many words counts as content (a sentence, a
    // message, a paragraph) rather than a UI label. Used only for the quality score.
    static let contentMinWords = 5
}

// Timing of one measurement in the coverage matrix.
enum Timing {
    static let switchDelaySeconds = 5.0 // time to switch to the app after pressing Enter
    static let rereadSeconds = 1.5 // re-read this long after the cold first walk (or after turning a tree on)
    static let baselineSeconds = 10.0 // app CPU and memory with no reading at all
    static let captureSeconds = 10.0 // app CPU and memory while reading
    static let walkEverySeconds = 2.0 // one walk per this many seconds while reading

    static var totalSeconds: Double { rereadSeconds + baselineSeconds + rereadSeconds + captureSeconds }
}
