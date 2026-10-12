import Foundation
import Testing
@testable import CaptureCore

@Suite("Client matching")
struct ClientMatcherTests {
    static let acme = Client(id: "c_acme", name: "Acme Corp", aliases: ["Acme"], domains: ["acme.com", "acme.atlassian.net"], projectCodes: ["ACM-"])
    static let globex = Client(id: "c_globex", name: "Globex", aliases: ["Globex Corporation"], domains: ["globex.com"], projectCodes: ["GLX-", "P-1042"])
    let matcher = ClientMatcher(clients: [acme, globex])

    func match(title: String = "", domainPath: String? = nil, text: String = "") -> ClientMatch? {
        matcher.match(title: title, domainPath: domainPath, text: text)
    }

    @Test("The browser page's domain, subdomains included")
    func pageDomain() {
        #expect(match(title: "Dashboard", domainPath: "app.acme.com/reports")?.client.id == "c_acme")
        #expect(match(title: "Board", domainPath: "acme.atlassian.net/jira/software/projects")?.reason == "domain acme.atlassian.net")
    }

    @Test("A project code in the title, as a prefix or exact")
    func projectCodes() {
        #expect(match(title: "ACM-214 Fix login timeout")?.client.id == "c_acme")
        #expect(match(title: "Budget for P-1042 - Mail")?.client.id == "c_globex")
        #expect(match(title: "P-10421 is a different code") == nil) // exact codes don't match longer ones
    }

    @Test("A name or alias in the title, as whole words")
    func names() {
        #expect(match(title: "Re: Acme renewal - Mail")?.client.id == "c_acme")
        #expect(match(title: "Notes on globex corporation pricing")?.reason == "name Globex") // first name that matches
        #expect(match(title: "Acmeville town meeting") == nil) // not a whole word
    }

    @Test("Weak signals alone don't match")
    func weak() {
        #expect(match(text: "We compared ourselves with Acme last year.") == nil) // a name once in body text
    }

    @Test("Signals in different places add up")
    func addsUp() {
        // Name in body text (30) plus a project code in body text counts once per place: code wins there (50).
        // With the title naming the client too, it clears the bar.
        #expect(match(title: "Weekly notes", text: "Acme follow-up on ACM-7") == nil) // 50 < 60
        #expect(match(title: "Acme weekly", text: "follow-up on ACM-7")?.score == 120)
    }

    @Test("Too close to call sends no client")
    func ambiguous() {
        #expect(match(title: "Acme and Globex joint planning") == nil)
        // A clear winner still wins.
        #expect(match(title: "Acme and Globex joint planning", domainPath: "acme.com/plan")?.client.id == "c_acme")
    }

    @Test("Deleted clients are never matched")
    func deleted() {
        var gone = Self.acme
        gone.deleted = true
        #expect(ClientMatcher(clients: [gone]).match(title: "Acme renewal", domainPath: nil, text: "") == nil)
    }
}

@Suite("Client list")
struct ClientListTests {
    @Test("Sync replaces changed clients, removes deleted ones, and keeps the cursor")
    func merge() {
        var list = ClientList()
        list.merge(ClientsResponse(clients: [ClientMatcherTests.acme, ClientMatcherTests.globex], nextSince: "t1"))
        #expect(list.clients.map(\.id) == ["c_acme", "c_globex"])
        #expect(list.since == "t1")

        var renamed = ClientMatcherTests.acme
        renamed.name = "Acme Corporation"
        var removed = ClientMatcherTests.globex
        removed.deleted = true
        list.merge(ClientsResponse(clients: [renamed, removed], nextSince: "t2"))
        #expect(list.clients.map(\.name) == ["Acme Corporation"])
        #expect(list.since == "t2")
        #expect(list.syncedAt != nil)
    }

    @Test("Missing optional fields decode as empty")
    func decodesMinimal() throws {
        let json = #"{"clients":[{"id":"c1","name":"Solo"}],"next_since":null}"#
        let response = try JSONDecoder().decode(ClientsResponse.self, from: Data(json.utf8))
        #expect(response.clients == [Client(id: "c1", name: "Solo")])
    }

    @Test("Client names stay readable when names are masked")
    func exemptFromMasking() {
        let masker = NameMasker()
        masker.setExempt(["Priya Shah Consulting"])
        let text = masker.mask("Invoice for Priya Shah Consulting, reviewed with Tom Baker").text
        #expect(text.contains("Priya Shah"))
        #expect(!text.contains("Tom Baker"))
    }

    @Test("Saved encrypted, and loads back")
    func storeRoundTrip() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-clients-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("store.sqlite")
        let keys = MemoryStoreKey()
        let list = ClientList(clients: [ClientMatcherTests.globex], since: "t9", syncedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try RecordStore(url: url, keys: keys).saveClientList(list)
        #expect(try RecordStore(url: url, keys: keys).loadClientList() == list)
        #expect(try Data(contentsOf: url).range(of: Data("Globex".utf8)) == nil)
    }
}

@Suite("Fetching clients")
struct FetchClientsTests {
    @Test("Sends since and the token, and decodes the list")
    func fetch() async throws {
        let host = "test-\(UUID().uuidString.lowercased()).example"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let client = BackendClient(baseURL: URL(string: "https://\(host)")!, session: URLSession(configuration: config))
        StubProtocol.answer(host: host, status: 200, json: #"{"clients":[{"id":"c_acme","name":"Acme Corp","domains":["acme.com"]}],"next_since":"t2"}"#)

        let response = try await client.fetchClients(since: "2026-10-12T18:00:00Z", credentials: DeviceCredentials(deviceId: "d", token: "tok"))
        #expect(response.clients.first?.domains == ["acme.com"])
        #expect(response.nextSince == "t2")

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/clients")
        #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "2026-10-12T18:00:00Z")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }
}
