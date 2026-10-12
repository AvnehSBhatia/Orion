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
    /// Already redacted line -> masked line. Memory only, cleared with reset().
    private var cache: [String: (text: String, count: Int)] = [:]
    private static let cacheLimit = 5_000

    public init() {}

    /// Mask names across many lines with one pass of the language model. Starting
    /// the model once per line cost over a second for a full Mail window (M2 testing).
    public func mask(lines: [String]) -> (lines: [String], count: Int) {
        guard !lines.isEmpty else { return (lines, 0) }
        // A window is read again and again with mostly the same lines, so lines
        // already masked come from the cache and only new ones go to the model.
        var results = [(text: String, count: Int)?](repeating: nil, count: lines.count)
        var fresh: [Int] = []
        lock.lock()
        for (index, line) in lines.enumerated() {
            if let cached = cache[line] { results[index] = cached } else { fresh.append(index) }
        }
        lock.unlock()

        if !fresh.isEmpty {
            // One model pass for all new lines, joined with a separator the text never
            // contains; the paragraph separator also keeps names from joining across lines.
            let separator = "\u{2029}"
            let masked = mask(fresh.map { lines[$0] }.joined(separator: separator)).text
            var parts = masked.components(separatedBy: separator)
            if parts.count != fresh.count { parts = fresh.map { mask(lines[$0]).text } } // fall back line by line
            lock.lock()
            if cache.count > Self.cacheLimit { cache.removeAll(keepingCapacity: true) }
            for (offset, index) in fresh.enumerated() {
                let entry = (parts[offset], Redactor.countPersonTokens(in: parts[offset]))
                cache[lines[index]] = entry
                results[index] = entry
            }
            lock.unlock()
        }
        let done = results.map { $0! }
        return (done.map(\.text), done.reduce(0) { $0 + $1.count })
    }

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
        cache = [:]
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
