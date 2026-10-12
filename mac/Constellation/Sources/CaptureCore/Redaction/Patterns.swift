import Foundation

// What redaction looks for (spec 8). Each pattern says what it replaces and how
// a match is double checked, so false positives can be rejected in code rather
// than with ever longer regexes.

public enum RedactionKind: String, CaseIterable, Sendable {
    case email = "EMAIL"
    case phone = "PHONE"
    case card = "CARD"
    case ssn = "SSN"
    case address = "ADDRESS"
    case secret = "SECRET"
    case ip = "IP"

    public var token: String { "[\(rawValue)]" }
}

struct Pattern: @unchecked Sendable { // NSRegularExpression is immutable and safe to share
    let kind: RedactionKind
    let regex: NSRegularExpression
    /// Capture group to replace; 0 is the whole match. "Bearer abc" keeps "Bearer ".
    let group: Int
    /// Extra check on the matched text. Returning false keeps the text as is.
    let accept: @Sendable (String) -> Bool
    /// Lower wins when two matches overlap.
    let priority: Int

    init(_ kind: RedactionKind, _ pattern: String, group: Int = 0, priority: Int,
         accept: @escaping @Sendable (String) -> Bool = { _ in true }) {
        self.kind = kind
        self.regex = try! NSRegularExpression(pattern: pattern)
        self.group = group
        self.accept = accept
        self.priority = priority
    }
}

enum Patterns {
    static let email = Pattern(
        .email,
        #"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])"#,
        priority: 1
    )

    // API keys and tokens with a known shape.
    static let secrets: [Pattern] = [
        Pattern(.secret, #"(?i)\bBearer\s+([A-Za-z0-9._~+/=-]{16,})"#, group: 1, priority: 2),
        Pattern(.secret, #"\bsk-[A-Za-z0-9_-]{16,}"#, priority: 2), // OpenAI, Anthropic
        Pattern(.secret, #"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"#, priority: 2), // GitHub
        Pattern(.secret, #"\bgithub_pat_[A-Za-z0-9_]{20,}"#, priority: 2),
        Pattern(.secret, #"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"#, priority: 2), // AWS access key id
        Pattern(.secret, #"\bxox[abprs]-[A-Za-z0-9-]{10,}"#, priority: 2), // Slack
        Pattern(.secret, #"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"#, priority: 2), // JWT
    ]

    // 13 to 19 digits, plain or in the usual groupings, that pass Luhn.
    static let card = Pattern(
        .card,
        #"(?<![\d-])(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]?\d{1,3})?|\d{4}[ -]\d{6}[ -]\d{5}|\d{13,19})(?![\d-])"#,
        priority: 3,
        accept: { Checks.luhn($0) }
    )

    // 123-45-6789, skipping numbers the SSA never issues.
    static let ssn = Pattern(
        .ssn, #"(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])"#, priority: 4
    )

    static let phones: [Pattern] = [
        // North American: (415) 555-0132, 415-555-0132, 415.555.0132, +1 415 555 0132.
        // Not inside dotted numbers such as version strings ("1.415.555.0132"), so a
        // bare "1." is not taken as the country code; "+1", "1 " and "1-" are.
        Pattern(.phone, #"(?<![\w.+-])(?:\+1[ .-]?|1[ -])?(?:\(\d{3}\)[ ]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\d)(?![.-]\d)"#, priority: 5),
        // International with a leading +: +44 20 7946 0958.
        Pattern(.phone, #"(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?!\d)"#, priority: 5,
                accept: { (8...15).contains($0.filter(\.isNumber).count) }),
    ]

    // Street addresses come from NSDataDetector in Redactor; this entry only carries
    // the kind and priority. Below secrets and cards, so a key or card inside an address wins.
    static let address = Pattern(.address, #"(?!)"#, priority: 4)

    // Optional: private network addresses.
    static let privateIP = Pattern(
        .ip,
        #"(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.]*\d)"#,
        priority: 6
    )

    // Long random strings: at least 24 characters with letters and digits mixed in
    // and high entropy. Slashes are not part of a token, so file paths don't match,
    // and "=" only as base64 padding at the end, so "session=<token>" keeps "session=".
    static let randomToken = Pattern(
        .secret, #"(?<![A-Za-z0-9_+-])[A-Za-z0-9_+-]{24,}={0,2}(?![A-Za-z0-9_+=-])"#, priority: 7,
        accept: { Checks.looksRandom($0) }
    )
}

enum Checks {
    static func luhn(_ text: String) -> Bool {
        let digits = text.compactMap(\.wholeNumberValue)
        guard (13...19).contains(digits.count) else { return false }
        var sum = 0
        for (index, digit) in digits.reversed().enumerated() {
            if index % 2 == 1 {
                let doubled = digit * 2
                sum += doubled > 9 ? doubled - 9 : doubled
            } else {
                sum += digit
            }
        }
        return sum % 10 == 0
    }

    /// Mixed letters and digits with high character entropy. Keeps out long
    /// words, camelCase identifiers with a stray digit, and slugs.
    static func looksRandom(_ text: String) -> Bool {
        let core = text.filter { $0 != "-" && $0 != "_" }
        guard core.count >= 24 else { return false }
        let letters = core.filter(\.isLetter).count
        let digits = core.filter(\.isNumber).count
        guard letters >= 3, digits >= 3 else { return false }
        return entropy(core) >= 3.5
    }

    /// Shannon entropy in bits per character.
    static func entropy(_ text: String) -> Double {
        var counts: [Character: Int] = [:]
        for character in text { counts[character, default: 0] += 1 }
        let length = Double(text.count)
        return counts.values.reduce(0) { total, count in
            let p = Double(count) / length
            return total - p * log2(p)
        }
    }
}
