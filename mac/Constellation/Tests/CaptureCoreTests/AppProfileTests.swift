import Testing
@testable import CaptureCore

@Suite("App profiles")
struct AppProfileTests {
    @Test("Mail skips the mailbox list and the list of emails, and titles by the open email")
    func mail() throws {
        let mail = try #require(AppProfile.forApp("com.apple.mail"))
        #expect(mail.skipIdentifiers == ["MailboxesOutlineView", "Mail.messageList"])
        #expect(mail.title?.list == "Mail.messageList")
        #expect(mail.title?.fields.first == "Mail.messageList.cell.view.subjectLabel")
    }

    @Test("Apps without a profile read the whole window as before")
    func others() {
        #expect(AppProfile.forApp("com.apple.Terminal") == nil)
    }

    @Test("Title is subject, then sender, skipping blanks")
    func title() {
        #expect(AppProfile.composeTitle(["Your Apple ID was used to sign in", "Apple"]) == "Your Apple ID was used to sign in — Apple")
        #expect(AppProfile.composeTitle(["Quarterly plan", nil]) == "Quarterly plan")
        #expect(AppProfile.composeTitle(["  ", ""]) == nil) // nothing usable: fall back to the window title
    }

    @Test("A Mail title with the sender matches that client")
    func matchesSender() {
        let apple = Client(id: "c_apple", name: "Apple", aliases: ["Apple ID"], domains: ["apple.com"])
        let title = AppProfile.composeTitle(["Your recent download with your Apple ID", "Apple"])!
        #expect(ClientMatcher(clients: [apple]).match(title: title, domainPath: nil, text: "")?.client.id == "c_apple")
    }
}
