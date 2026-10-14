import Testing
@testable import CaptureCore

@Suite("Text cleanup")
struct TextCleanupTests {
    @Test("Browser name and profile come off the title")
    func browserTitle() {
        #expect(TextCleanup.browserTitle("garrytan/gstack: Use it - Google Chrome - Veer", appName: "Google Chrome") == "garrytan/gstack: Use it")
        #expect(TextCleanup.browserTitle("Pricing — Google Chrome — Work", appName: "Google Chrome") == "Pricing")
        #expect(TextCleanup.browserTitle("Inbox - Microsoft Edge", appName: "Microsoft Edge") == "Inbox")
        #expect(TextCleanup.browserTitle("Pricing – Initech", appName: "Safari") == "Pricing – Initech") // a dash in the page title stays
        #expect(TextCleanup.browserTitle("Google Chrome", appName: "Google Chrome") == "Google Chrome") // nothing else left: keep it
    }

    @Test("Lines that repeat the title or one of its parts are dropped")
    func titleLines() {
        let lines = ["Your Apple ID was used to sign in", "Apple", "To:", "If this was you, ignore this message."]
        #expect(TextCleanup.dropTitleLines(lines, title: "Your Apple ID was used to sign in — Apple")
            == ["To:", "If this was you, ignore this message."])
        #expect(TextCleanup.dropTitleLines(["A", "B"], title: "") == ["A", "B"])
    }

    @Test("A sentence broken around a link is joined again")
    func fragments() {
        #expect(TextCleanup.joinFragments(["Your Apple ID (", ") was used to sign in to iCloud."])
            == ["Your Apple ID was used to sign in to iCloud."])
        #expect(TextCleanup.joinFragments(["Thanks for the numbers", ", see you Monday."]) == ["Thanks for the numbers, see you Monday."])
        #expect(TextCleanup.joinFragments(["One line.", "Another line."]) == ["One line.", "Another line."])
        #expect(TextCleanup.joinFragments(["", "  ", "Kept"]) == ["Kept"])
    }
}
