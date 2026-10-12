import Foundation
import Testing
@testable import CaptureCore

// Redaction runs on every capture, so it has to be cheap. M2 testing showed Mail
// reads taking up to 1.3 s once redaction was added; this measures it.

@Suite("Redaction speed", .serialized) // they share the line cache
struct RedactionPerformanceTests {
    /// About 8,000 characters in 200 lines, like a full Mail window.
    static let lines: [String] = (0..<200).map { index in
        "Line \(index): Hi team, following up on the Acme renewal with Priya Shah. Call 415-555-0132 or mail ops@acme.co."
    }

    static func time(_ body: () -> Void) -> Double {
        let start = DispatchTime.now()
        body()
        return Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6
    }

    @Test("Without name masking")
    func plain() {
        var snapshot = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        snapshot.lines = Self.lines
        Redactor.clearCache()
        let ms = Self.time { Redactor.redact(&snapshot, options: RedactionOptions(), names: nil) }
        var again = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        again.lines = Self.lines
        let againMs = Self.time { Redactor.redact(&again, options: RedactionOptions(), names: nil) }
        print("redaction, names off: first read \(String(format: "%.1f", ms)) ms, repeat read \(String(format: "%.1f", againMs)) ms for \(Self.lines.count) lines")
        #expect(snapshot.redactionCount == 400)
        #expect(again.lines == snapshot.lines)
        #expect(againMs < ms / 2)
    }

    @Test("With name masking, first read and repeat read")
    func masked() {
        let names = NameMasker()
        var first = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        first.lines = Self.lines
        let firstMs = Self.time { Redactor.redact(&first, options: RedactionOptions(maskNames: true), names: names) }

        // The same window read again with one new line, as on a content change.
        var again = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        again.lines = Self.lines + ["New reply from Tom Baker"]
        let againMs = Self.time { Redactor.redact(&again, options: RedactionOptions(maskNames: true), names: names) }

        print("redaction, names on: first read \(String(format: "%.1f", firstMs)) ms, repeat read \(String(format: "%.1f", againMs)) ms")
        #expect(first.lines == Array(again.lines.dropLast())) // cached lines come back identical
        #expect(!again.lines.last!.contains("Baker"))
        #expect(againMs < firstMs / 2) // repeat reads must not pay full price again
    }
}
