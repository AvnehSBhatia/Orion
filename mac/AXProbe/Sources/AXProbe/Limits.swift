// Every tunable number in one place (spec 5.3: limits must be constants in one file).

enum Limits {
    // Walk limits from spec 5.3.
    static let maxDepth = 30
    static let maxNodes = 2_000
    static let maxWalkMs = 50.0
    static let maxChars = 8_000

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
    static let baselineSeconds = 10.0 // app CPU and memory with no reading at all
    static let settleSeconds = 1.5 // after turning a Chromium or Electron tree on
    static let captureSeconds = 10.0 // app CPU and memory while reading
    static let walkEverySeconds = 2.0 // one walk per this many seconds while reading

    static var totalSeconds: Double { baselineSeconds + settleSeconds + captureSeconds }
}
