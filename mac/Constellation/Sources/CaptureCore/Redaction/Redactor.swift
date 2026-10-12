import CryptoKit
import Foundation

// Redaction runs on the device before anything is stored or sent (spec 2.4, 8).
// Matches become typed tokens: [EMAIL], [PHONE], [CARD], [SSN], [ADDRESS], [SECRET], [IP].

public struct RedactionOptions: Sendable, Equatable {
    /// Replace people's names with stable tokens ([Person 1], [Person 2]). Off by default (spec 8).
    public var maskNames: Bool
    /// Replace private network addresses (10.x, 172.16-31.x, 192.168.x). Off by default.
    public var redactPrivateIPs: Bool

    public init(maskNames: Bool = false, redactPrivateIPs: Bool = false) {
        self.maskNames = maskNames
        self.redactPrivateIPs = redactPrivateIPs
    }
}

public struct Redacted: Sendable, Equatable {
    public var text: String
    public var counts: [RedactionKind: Int]
    public var total: Int { counts.values.reduce(0, +) }
}

public enum Redactor {
    public static func redact(_ text: String, options: RedactionOptions = RedactionOptions()) -> Redacted {
        var patterns = [Patterns.email] + Patterns.secrets + [Patterns.card, Patterns.ssn] + Patterns.phones
        if options.redactPrivateIPs { patterns.append(Patterns.privateIP) }
        patterns.append(Patterns.randomToken)

        let source = text as NSString
        let whole = NSRange(location: 0, length: source.length)
        var found: [(range: NSRange, pattern: Pattern)] = []
        for pattern in patterns {
            for match in pattern.regex.matches(in: text, range: whole) {
                let range = match.range(at: pattern.group)
                guard range.location != NSNotFound, pattern.accept(source.substring(with: range)) else { continue }
                found.append((range, pattern))
            }
        }

        // Street addresses, found by Apple's on-device data detector (the one Mail
        // and Messages use), which handles real formats far better than a regex.
        for match in addressDetector.matches(in: text, range: whole) {
            found.append((match.range, Patterns.address))
        }

        // Where matches overlap, keep the higher priority one, then the longer one.
        found.sort {
            $0.pattern.priority != $1.pattern.priority
                ? $0.pattern.priority < $1.pattern.priority
                : $0.range.length > $1.range.length
        }
        var kept: [(range: NSRange, kind: RedactionKind)] = []
        for candidate in found where !kept.contains(where: { NSIntersectionRange($0.range, candidate.range).length > 0 }) {
            kept.append((candidate.range, candidate.pattern.kind))
        }

        let output = NSMutableString(string: text)
        var counts: [RedactionKind: Int] = [:]
        for (range, kind) in kept.sorted(by: { $0.range.location > $1.range.location }) {
            output.replaceCharacters(in: range, with: kind.token)
            counts[kind, default: 0] += 1
        }
        return Redacted(text: output as String, counts: counts)
    }

    // NSDataDetector, like NSRegularExpression, is safe to share between threads.
    private static let addressDetector = try! NSDataDetector(
        types: NSTextCheckingResult.CheckingType.address.rawValue
    )

    private static let tokenRegex = try! NSRegularExpression(
        pattern: #"\[(?:EMAIL|PHONE|CARD|SSN|ADDRESS|SECRET|IP|Person \d+)\]"#
    )

    private static let personRegex = try! NSRegularExpression(pattern: #"\[Person \d+\]"#)

    static func countPersonTokens(in text: String) -> Int {
        personRegex.numberOfMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }

    /// Delete all (spec 16): forget remembered line results too.
    public static func clearCache() { LineCache.shared.clear() }

    /// How many redaction tokens a text holds, for a record's redactionCount.
    public static func countTokens(in text: String?) -> Int {
        guard let text else { return 0 }
        return tokenRegex.numberOfMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }

    /// Redact everything a snapshot carries: title, browser domain and path, and text.
    /// Runs on the capture queue, before the snapshot reaches the segmenter.
    public static func redact(_ snapshot: inout Snapshot, options: RedactionOptions, names: NameMasker?) {
        var total = 0
        func clean(_ text: String) -> String {
            let result = LineCache.shared.redacted(text, options: options)
            total += result.total
            return result.text
        }
        // Paths can carry document ids and tokens; they are not checked for names.
        snapshot.domainPath = snapshot.domainPath.map(clean)
        // Title is masked together with the text, so one model pass covers both.
        var texts = [clean(snapshot.windowTitle)] + snapshot.lines.map(clean)
        if options.maskNames, let names {
            let masked = names.mask(lines: texts)
            texts = masked.lines
            total += masked.count
        }
        snapshot.windowTitle = texts[0]
        snapshot.lines = Array(texts.dropFirst())
        snapshot.chars = snapshot.lines.reduce(0) { $0 + $1.count }
        snapshot.redactionCount = total
    }
}

/// A window is read again and again with mostly the same lines, so each line's
/// redaction is remembered. Keyed by a SHA-256 of the unredacted line, so no
/// unredacted text is held here. Memory only.
final class LineCache: @unchecked Sendable { // guarded by `lock`
    static let shared = LineCache()
    private static let limit = 5_000

    private let lock = NSLock()
    private var entries: [Data: Redacted] = [:]

    func redacted(_ text: String, options: RedactionOptions) -> Redacted {
        var hasher = SHA256()
        hasher.update(data: Data([options.redactPrivateIPs ? 1 : 0]))
        hasher.update(data: Data(text.utf8))
        let key = Data(hasher.finalize())

        lock.lock()
        let cached = entries[key]
        lock.unlock()
        if let cached { return cached }

        let result = Redactor.redact(text, options: options)
        lock.lock()
        if entries.count >= Self.limit { entries.removeAll(keepingCapacity: true) }
        entries[key] = result
        lock.unlock()
        return result
    }

    func clear() {
        lock.lock()
        entries.removeAll()
        lock.unlock()
    }
}
