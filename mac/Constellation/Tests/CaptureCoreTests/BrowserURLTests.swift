import Testing
@testable import CaptureCore

@Suite("Browser URL: domain and path only")
struct BrowserURLTests {
    @Test("Query strings and fragments are stripped", arguments: [
        ("https://accounts.example.com/reset?token=abc123", "accounts.example.com/reset"),
        ("https://mail.google.com/mail/u/0/#inbox/FMfcgz", "mail.google.com/mail/u/0"),
        ("https://app.example.com/callback?code=xyz&state=1#frag", "app.example.com/callback"),
    ])
    func stripsQueryAndFragment(raw: String, expected: String) {
        #expect(BrowserURL.domainAndPath(raw) == expected)
    }

    @Test("Address bar text without a scheme", arguments: [
        ("mail.google.com/mail/u/0", "mail.google.com/mail/u/0"),
        ("github.com", "github.com"),
        ("docs.google.com/document/d/abc/edit", "docs.google.com/document/d/abc/edit"),
        ("localhost:3000/api?x=1", "localhost/api"),
    ])
    func addressBarFormats(raw: String, expected: String) {
        #expect(BrowserURL.domainAndPath(raw) == expected)
    }

    @Test("User name, password, and port are dropped")
    func dropsCredentials() {
        #expect(BrowserURL.domainAndPath("https://user:secret@example.com:8443/a/b") == "example.com/a/b")
    }

    @Test("Hosts are lowercased and a bare slash path is dropped")
    func normalizes() {
        #expect(BrowserURL.domainAndPath("https://Example.COM/") == "example.com")
    }

    @Test("Not web URLs", arguments: [
        "Search Google or type a URL", "chrome://settings", "file:///Users/me/notes.txt", "about:blank", "", "version 1.2.3",
    ])
    func rejects(raw: String) {
        #expect(BrowserURL.domainAndPath(raw) == nil)
    }
}
