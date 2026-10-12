import Testing
@testable import CaptureCore

@Suite("Exclusions")
struct ExclusionTests {
    @Test("Private and incognito windows", arguments: [
        "Private Browsing", "Apple - Private Browsing", "New Incognito Tab", "Gmail - Google Chrome (Incognito)",
    ])
    func privateTitles(title: String) {
        #expect(ExclusionRules.isPrivate(title: title))
    }

    @Test("Normal titles are not private")
    func normalTitles() {
        #expect(!ExclusionRules.isPrivate(title: "Quarterly plan - Google Docs"))
        #expect(!ExclusionRules.isPrivate(title: nil))
    }

    @Test("Password managers and system settings are blocked")
    func blockedApps() {
        #expect(ExclusionRules.isBlocked(bundleId: "com.1password.1password"))
        #expect(ExclusionRules.isBlocked(bundleId: "com.apple.keychainaccess"))
        #expect(ExclusionRules.isBlocked(bundleId: "com.apple.systempreferences"))
        #expect(!ExclusionRules.isBlocked(bundleId: "com.apple.mail"))
    }

    @Test("Banking domains are skipped, subdomains included")
    func bankingDomains() {
        let rules = ExclusionRules()
        #expect(rules.skipsDomain("secure.chase.com/web/auth"))
        #expect(rules.skipsDomain("chase.com"))
        #expect(rules.skipsDomain("www.mybank.example/login")) // "bank" with no dot matches anywhere
        #expect(!rules.skipsDomain("purchase.example.com/cart")) // "chase.com" needs a dot boundary
        #expect(!rules.skipsDomain("github.com/apple"))
        #expect(!rules.skipsDomain(nil))
    }

    @Test("User skip words match the title or text, ignoring case")
    func skipWords() {
        let rules = ExclusionRules(skipDomains: [], skipWords: ["Payroll", " ", ""])
        #expect(rules.containsSkipWord(title: "PAYROLL March", lines: []))
        #expect(rules.containsSkipWord(title: "Inbox", lines: ["see the payroll sheet"]))
        #expect(!rules.containsSkipWord(title: "Inbox", lines: ["nothing here"]))
        #expect(!ExclusionRules(skipDomains: [], skipWords: []).containsSkipWord(title: "x", lines: ["y"]))
    }

    @Test("Nothing is captured while paused, off, locked, or for apps not turned on")
    func gate() {
        func check(on: Bool = true, paused: Bool = false, available: Bool = true, trusted: Bool = true,
                   id: String = "com.apple.mail", allowed: Set<String> = ["com.apple.mail"]) -> SkipReason? {
            CaptureGate.check(captureOn: on, paused: paused, systemAvailable: available, trusted: trusted, bundleId: id, allowed: allowed)
        }
        #expect(check() == nil)
        #expect(check(on: false) == .off)
        #expect(check(paused: true) == .paused)
        #expect(check(available: false) == .systemUnavailable)
        #expect(check(trusted: false) == .noPermission)
        #expect(check(allowed: []) == .notAllowed)
        #expect(check(id: "com.bitwarden.desktop", allowed: ["com.bitwarden.desktop"]) == .blockedApp)
    }
}
