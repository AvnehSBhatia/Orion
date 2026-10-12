import Foundation

// What is never captured (spec 2 and 7).

public struct ExclusionRules: Sendable {
    /// Apps the user cannot turn on.
    public static let blockedBundleIds: Set<String> = [
        "com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx",
        "com.bitwarden.desktop", "com.lastpass.LastPass",
        "com.apple.keychainaccess", "com.apple.Passwords",
        "com.apple.systempreferences", "com.apple.SystemSettings",
    ]

    /// Window titles that mean a private window. Checked before any text is read.
    public static let privateTitleMarkers = ["private browsing", "incognito"]

    /// Banking style domains, editable by the user. A pattern with a dot matches
    /// that domain and its subdomains; one without a dot matches anywhere in the domain.
    public static let defaultSkipDomains = [
        "bank", "chase.com", "wellsfargo.com", "citi.com", "capitalone.com", "schwab.com", "fidelity.com",
        "vanguard.com", "paypal.com", "venmo.com", "americanexpress.com", "discover.com",
    ]

    public var skipDomains: [String]
    public var skipWords: [String]

    public init(skipDomains: [String] = ExclusionRules.defaultSkipDomains, skipWords: [String] = []) {
        self.skipDomains = skipDomains
        self.skipWords = skipWords
    }

    public static func isBlocked(bundleId: String) -> Bool {
        blockedBundleIds.contains(bundleId)
    }

    public static func isPrivate(title: String?) -> Bool {
        guard let title = title?.lowercased() else { return false }
        return privateTitleMarkers.contains { title.contains($0) }
    }

    /// `domainPath` is "domain/path" as produced by BrowserURL.
    public func skipsDomain(_ domainPath: String?) -> Bool {
        guard let domain = domainPath?.split(separator: "/").first.map({ $0.lowercased() }) else { return false }
        return skipDomains.contains { raw in
            let pattern = raw.trimmingCharacters(in: .whitespaces).lowercased()
            guard !pattern.isEmpty else { return false }
            if pattern.contains(".") { return domain == pattern || domain.hasSuffix("." + pattern) }
            return domain.contains(pattern)
        }
    }

    public func containsSkipWord(title: String?, lines: [String]) -> Bool {
        let words = skipWords.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        guard !words.isEmpty else { return false }
        let haystacks = [title ?? ""] + lines
        return haystacks.contains { text in
            let lower = text.lowercased()
            return words.contains { lower.contains($0) }
        }
    }
}

/// Whether a capture may start at all. Pure, so the rules are testable.
public enum CaptureGate {
    public static func check(
        captureOn: Bool, paused: Bool, systemAvailable: Bool, trusted: Bool, bundleId: String, allowed: Set<String>
    ) -> SkipReason? {
        if !captureOn { return .off }
        if paused { return .paused }
        if !systemAvailable { return .systemUnavailable }
        if !trusted { return .noPermission }
        if ExclusionRules.isBlocked(bundleId: bundleId) { return .blockedApp }
        if !allowed.contains(bundleId) { return .notAllowed }
        return nil
    }
}
