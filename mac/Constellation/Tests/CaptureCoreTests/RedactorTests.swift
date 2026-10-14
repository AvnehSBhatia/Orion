import Foundation
import Testing
@testable import CaptureCore

@Suite("Redaction: what gets replaced")
struct RedactionTruePositives {
    @Test("Emails", arguments: [
        ("Mail priya.shah+work@acme.co.uk today", "Mail [EMAIL] today"),
        ("From: ops@example.com", "From: [EMAIL]"),
        ("Inbox (3) - veer@gmail.com - Gmail", "Inbox (3) - [EMAIL] - Gmail"),
    ])
    func emails(input: String, expected: String) {
        #expect(Redactor.redact(input).text == expected)
    }

    @Test("Phone numbers", arguments: [
        ("Call (415) 555-0132 now", "Call [PHONE] now"),
        ("cell 415-555-0132", "cell [PHONE]"),
        ("cell 415.555.0132.", "cell [PHONE]."),
        ("US +1 415 555 0132", "US [PHONE]"),
        ("London +44 20 7946 0958", "London [PHONE]"),
    ])
    func phones(input: String, expected: String) {
        #expect(Redactor.redact(input).text == expected)
    }

    @Test("Card numbers that pass Luhn", arguments: [
        ("Visa 4111 1111 1111 1111 exp", "Visa [CARD] exp"),
        ("card=4111111111111111", "card=[CARD]"),
        ("Mastercard 5555-5555-5555-4444", "Mastercard [CARD]"),
        ("Amex 3782 822463 10005", "Amex [CARD]"),
    ])
    func cards(input: String, expected: String) {
        #expect(Redactor.redact(input).text == expected)
    }

    @Test("SSN style numbers")
    func ssn() {
        #expect(Redactor.redact("SSN 123-45-6789 on file").text == "SSN [SSN] on file")
    }

    @Test("API keys and tokens", arguments: [
        ("key sk-ant-api03-AbCdEf123456GhIjKl789", "key [SECRET]"),
        ("OPENAI_API_KEY=sk-proj-1a2B3c4D5e6F7g8H9i0J", "OPENAI_API_KEY=[SECRET]"),
        ("token ghp_1234567890abcdefghijABCDEFGHIJ", "token [SECRET]"),
        ("github_pat_11ABCDEFG0123456789_abcdefghij", "[SECRET]"),
        ("aws AKIAIOSFODNN7EXAMPLE id", "aws [SECRET] id"),
        ("slack xoxb-123456789012-abcdefABCDEF", "slack [SECRET]"),
        ("Authorization: Bearer abcDEF123456ghiJKL789", "Authorization: Bearer [SECRET]"),
        ("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "jwt [SECRET]"),
        ("session=9f8Kq2LmZx7Vb3Np6Rt1Wy4Hc5Jd", "session=[SECRET]"),
    ])
    func secrets(input: String, expected: String) {
        #expect(Redactor.redact(input).text == expected)
    }

    @Test("Document ids in a browser path")
    func documentIds() {
        let path = "docs.google.com/document/d/1X0L4IKV2kX63xvoIYkr14PPCpguJohYhS6nWr_CyVfY/edit"
        #expect(Redactor.redact(path).text == "docs.google.com/document/d/[SECRET]/edit")
    }

    @Test("Private IPs only when turned on")
    func privateIPs() {
        let text = "db at 192.168.1.20 and 10.0.4.7, dns 8.8.8.8"
        #expect(Redactor.redact(text).text == text)
        let on = Redactor.redact(text, options: RedactionOptions(redactPrivateIPs: true))
        #expect(on.text == "db at [IP] and [IP], dns 8.8.8.8")
    }

    @Test("Counts by kind")
    func counts() {
        let result = Redactor.redact("a@b.co, c@d.co, 415-555-0132, 4111 1111 1111 1111")
        #expect(result.counts[.email] == 2)
        #expect(result.counts[.phone] == 1)
        #expect(result.counts[.card] == 1)
        #expect(result.total == 4)
        #expect(Redactor.countTokens(in: result.text) == 4)
    }
}

@Suite("Redaction: look-alikes that must stay")
struct RedactionFalsePositives {
    @Test("Left unchanged", arguments: [
        "Version 1.415.555.0132 is out",            // phone-like number inside a version string
        "Updated 2026-10-12 10:15:30",              // a date
        "Due 12/10/2026, invoice 2026-10-12",       // dates
        "Order 4111 1111 1111 1112 shipped",        // card-shaped but fails Luhn
        "Order id 1234567890123456",                // 16 digits that fail Luhn
        "Server 192.168.100.200",                   // IP, with private IPs off
        "macOS 15.7.7 (24G720)",                    // build number
        "Revenue $1,234,567.89",                    // money
        "ISBN 978-0-306-40615-7",                   // ISBN
        "000-12-3456 is not a valid SSN",           // never issued
        "internationalization",                     // long word
        "/Users/veersharma/Documents/constellation-mac", // file path
        "getUserProfileByIdentifier2",              // camelCase identifier
        "user@localhost and @mentions",             // not a full email
        "task-sk-list and risk-assessment",         // "sk-" inside a word
    ])
    func unchanged(text: String) {
        #expect(Redactor.redact(text).text == text)
    }
}

@Suite("Name masking")
struct NameMaskingTests {
    @Test("Off by default: names stay")
    func offByDefault() {
        var snapshot = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        snapshot.lines = ["Meeting with Priya Shah about the Acme renewal"]
        Redactor.redact(&snapshot, options: RedactionOptions(), names: NameMasker())
        #expect(snapshot.lines[0].contains("Priya"))
    }

    @Test("On: names become stable [Person N] tokens")
    func masked() {
        let masker = NameMasker()
        let first = masker.mask("Meeting with Priya Shah and Tom Baker about the renewal").text
        let second = masker.mask("Follow up with Priya Shah tomorrow").text
        #expect(!first.contains("Priya") && !first.contains("Baker"))
        #expect(first.contains("[Person 1]") && first.contains("[Person 2]"))
        #expect(second.contains("[Person 1]")) // same person, same token
    }

    @Test("Reset starts numbering over")
    func reset() {
        let masker = NameMasker()
        _ = masker.mask("Call Priya Shah")
        masker.reset()
        #expect(masker.mask("Call Tom Baker").text.contains("[Person 1]"))
    }
}

@Suite("Redaction in the capture pipeline")
struct SnapshotRedactionTests {
    @Test("Title, path, and text are all redacted, and counted")
    func snapshot() {
        var snapshot = Snapshot(appBundleId: "com.google.Chrome", appName: "Chrome")
        snapshot.windowTitle = "Inbox - veer@gmail.com - Gmail"
        snapshot.domainPath = "docs.google.com/document/d/1X0L4IKV2kX63xvoIYkr14PPCpguJohYhS6nWr_CyVfY/edit"
        snapshot.lines = ["call 415-555-0132", "key sk-proj-1a2B3c4D5e6F7g8H9i0J"]
        snapshot.foundWindow = true
        Redactor.redact(&snapshot, options: RedactionOptions(), names: nil)
        #expect(snapshot.windowTitle == "Inbox - [EMAIL] - Gmail")
        #expect(snapshot.domainPath == "docs.google.com/document/d/[SECRET]/edit")
        #expect(snapshot.lines == ["call [PHONE]", "key [SECRET]"])
        #expect(snapshot.redactionCount == 4)

        var segmenter = Segmenter()
        segmenter.ingest(snapshot)
        #expect(segmenter.current?.redactionCount == 4)
    }
}

@Suite("Street addresses")
struct AddressRedactionTests {
    @Test("Addresses become [ADDRESS]", arguments: [
        "Ship to 1 Infinite Loop, Cupertino, CA 95014 by Friday",
        "Office: 350 Fifth Avenue, New York, NY 10118",
        "Send it to 123 Main Street, Springfield, IL 62701.",
        "1600 Pennsylvania Ave NW, Washington, DC 20500",
    ])
    func replaced(text: String) {
        let result = Redactor.redact(text)
        #expect(result.text.contains("[ADDRESS]"))
        #expect(result.counts[.address] == 1)
        // The street number and name are gone.
        for part in ["Infinite Loop", "Fifth Avenue", "Main Street", "Pennsylvania"] {
            #expect(!result.text.contains(part))
        }
    }

    @Test("Look-alikes stay", arguments: [
        "We met at 3 pm to discuss the main topic",
        "Meeting room 4B on the second floor",
        "Order 12345 shipped on 2026-10-12",
        "Version 2.4 of the street map app",
    ])
    func unchanged(text: String) {
        #expect(Redactor.redact(text).text == text)
    }

    @Test("Counted as a redaction token")
    func counted() {
        #expect(Redactor.countTokens(in: "to [ADDRESS] and [EMAIL]") == 2)
    }
}

@Suite("Links in text")
struct LinkTrimmingTests {
    @Test("Query strings and fragments are dropped from links", arguments: [
        ("Reset here: https://accounts.example.com/reset?token=abc123 now", "Reset here: accounts.example.com/reset now"),
        ("go to Apple ID (https://appleid.apple.com) and change", "go to Apple ID (appleid.apple.com) and change"),
        ("Pricing: www.acme.com/pricing?ref=email#top.", "Pricing: www.acme.com/pricing."),
        ("https://user:pass@site.com:8443/x?y=1", "site.com/x"),
        ("Docs at https://docs.example.com/guide/start#install, then", "Docs at docs.example.com/guide/start, then"),
    ])
    func trimmed(input: String, expected: String) {
        #expect(Redactor.redact(input).text == expected)
    }

    @Test("Text without web links is untouched", arguments: [
        "Version 2.4 is out", "email me at [EMAIL]", "see section 3.2.1", "ftp://files.example.com/a?b=1",
    ])
    func untouched(text: String) {
        #expect(Redactor.redact(text).text == text)
    }

    @Test("Document ids in a link's path still become [SECRET]")
    func pathSecrets() {
        let text = "Open https://docs.google.com/document/d/1X0L4IKV2kX63xvoIYkr14PPCpguJohYhS6nWr_CyVfY/edit?usp=sharing"
        #expect(Redactor.redact(text).text == "Open docs.google.com/document/d/[SECRET]/edit")
    }
}

@Suite("Redaction choices")
struct RedactionChoiceTests {
    let text = "Mail jane.doe@acme.com, call 415-555-0132, visit 1 Infinite Loop, Cupertino, CA 95014. Card 4111 1111 1111 1111, key sk-proj-1a2B3c4D5e6F7g8H9i0J, SSN 123-45-6789."

    @Test("By default emails, phones, and addresses are replaced")
    func defaults() {
        let result = Redactor.redact(text).text
        #expect(result.contains("[EMAIL]") && result.contains("[PHONE]") && result.contains("[ADDRESS]"))
        #expect(!result.contains("acme.com"))
    }

    @Test("Each one can be turned off")
    func turnedOff() {
        let none = RedactionOptions(redactEmails: false, redactPhones: false, redactAddresses: false)
        let result = Redactor.redact(text, options: none).text
        #expect(result.contains("jane.doe@acme.com"))
        #expect(result.contains("415-555-0132"))
        #expect(result.contains("Infinite Loop"))
    }

    @Test("Cards, keys, and SSNs are replaced whatever the choices")
    func alwaysOn() {
        let none = RedactionOptions(redactEmails: false, redactPhones: false, redactAddresses: false)
        let result = Redactor.redact(text, options: none).text
        #expect(result.contains("[CARD]") && result.contains("[SECRET]") && result.contains("[SSN]"))
        #expect(!result.contains("4111") && !result.contains("sk-proj") && !result.contains("123-45-6789"))
    }

    @Test("Keeping the company part of email addresses")
    func keepDomain() {
        let result = Redactor.redact("From Jane.Doe@Acme.COM and ops@globex.com", options: RedactionOptions(keepEmailDomain: true))
        #expect(result.text == "From [EMAIL]@acme.com and [EMAIL]@globex.com")
        #expect(result.counts[.email] == 2)
        #expect(Redactor.countTokens(in: result.text) == 2)
        // The domain then helps client matching.
        let acme = Client(id: "c_acme", name: "Acme Corp", domains: ["acme.com"])
        #expect(ClientMatcher(clients: [acme]).match(title: "Re: renewal from [EMAIL]@acme.com", domainPath: nil, text: "")?.client.id == "c_acme")
    }

    @Test("Remembered lines follow the current choices")
    func cacheRespectsChoices() {
        var on = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        on.lines = ["reach me at jane@acme.com"]
        Redactor.redact(&on, options: RedactionOptions(), names: nil)
        var off = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
        off.lines = ["reach me at jane@acme.com"]
        Redactor.redact(&off, options: RedactionOptions(redactEmails: false), names: nil)
        #expect(on.lines == ["reach me at [EMAIL]"])
        #expect(off.lines == ["reach me at jane@acme.com"])
    }
}
