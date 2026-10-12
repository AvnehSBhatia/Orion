import AppKit
import ApplicationServices
import Foundation
import Testing
@testable import CaptureCore

// Chrome incognito windows are only recognised by the "Incognito" label on the
// toolbar's profile button (the title doesn't say so). This test fails if Chrome
// stops labelling it that way. It needs a real Chrome, so it only runs on demand:
//
//   1. Open a Chrome incognito window (Shift+Cmd+N) with any page, and leave it as
//      Chrome's front window.
//   2. From Terminal (which has Accessibility permission):
//      CONSTELLATION_LIVE_CHROME=1 swift test --filter ChromeLiveTests

@Suite("Live Chrome check", .enabled(if: ProcessInfo.processInfo.environment["CONSTELLATION_LIVE_CHROME"] == "1"))
struct ChromeLiveTests {
    @Test("Chrome still labels incognito windows so they are skipped")
    func incognitoLabel() throws {
        #expect(AXIsProcessTrusted(), "Run from a terminal that has Accessibility permission")
        let chrome = try #require(
            NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").first,
            "Chrome is not running"
        )
        let app = AXUIElementCreateApplication(chrome.processIdentifier)
        let window = try #require(AXReader.focusedWindow(of: app), "Chrome has no front window")
        #expect(
            BrowserPrivacy.hasPrivateMarker(in: window, start: .now()),
            "Chrome's front window is incognito but has no Incognito label: Chrome changed it, update BrowserPrivacy"
        )
    }
}
