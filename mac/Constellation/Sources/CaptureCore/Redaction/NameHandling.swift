import Foundation
import NaturalLanguage

// People's names (spec 8, open decision). v1 keeps names by default because the
// draft needs them; the Outbox will highlight them (M5). With "mask names" on,
// each name becomes a stable token, so the same person is [Person 1] everywhere.

public enum NameDetector {
    /// Ranges of personal names, found on the device with Apple's NaturalLanguage framework.
    public static func ranges(in text: String) -> [Range<String.Index>] {
        let tagger = NLTagger(tagSchemes: [.nameType])
        tagger.string = text
        var ranges: [Range<String.Index>] = []
        tagger.enumerateTags(
            in: text.startIndex..<text.endIndex, unit: .word, scheme: .nameType,
            options: [.omitPunctuation, .omitWhitespace, .joinNames]
        ) { tag, range in
            if tag == .personalName { ranges.append(range) }
            return true
        }
        return ranges
    }
}

/// Hands out [Person N] tokens that stay the same for a name across records.
/// Shared between capture reads, so it locks. Lives in memory only.
public final class NameMasker: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String: Int] = [:]

    public init() {}

    public func mask(_ text: String) -> (text: String, count: Int) {
        let ranges = NameDetector.ranges(in: text)
        guard !ranges.isEmpty else { return (text, 0) }
        // Number names in reading order, so the first person mentioned is Person 1.
        let numbered = ranges.map { ($0, token(for: String(text[$0]))) }
        let output = NSMutableString(string: text)
        for (range, number) in numbered.reversed() { // replace from the end, so earlier offsets stay valid
            output.replaceCharacters(in: NSRange(range, in: text), with: "[Person \(number)]")
        }
        return (output as String, ranges.count)
    }

    public func reset() {
        lock.lock()
        defer { lock.unlock() }
        tokens = [:]
    }

    private func token(for name: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let key = name.lowercased()
        if let existing = tokens[key] { return existing }
        let next = tokens.count + 1
        tokens[key] = next
        return next
    }
}
