import Foundation
import Testing
@testable import CaptureCore

@Suite("Daily draft")
struct DraftTests {
    @Test("Reads entries, with or without fractional seconds and optional fields")
    func decode() throws {
        let json = """
        {"date":"2026-10-13","entries":[
          {"id":"e1","client_id":"c_acme","description":"Acme renewal emails","minutes":45,
           "started_at":"2026-10-13T16:02:11.482Z","ended_at":"2026-10-13T16:47:00Z","block_ids":["b1","b2"],"status":"accepted","edited":true},
          {"id":"e2","client_id":null,"description":"Inbox","minutes":10}
        ]}
        """
        let draft = try BackendClient.decoder.decode(Draft.self, from: Data(json.utf8))
        #expect(draft.entries.count == 2)
        #expect(draft.entries[0].startedAt != nil && draft.entries[0].endedAt != nil)
        #expect(draft.entries[0].blockIds == ["b1", "b2"])
        #expect(draft.entries[1].clientId == nil)
        #expect(draft.entries[1].status == .pending)
        #expect(draft.totalMinutes == 55)
    }

    @Test("Rejected entries don't count toward the total")
    func total() {
        let draft = Draft(date: "d", entries: [
            DraftEntry(id: "a", clientId: nil, description: "", minutes: 30),
            DraftEntry(id: "b", clientId: nil, description: "", minutes: 20, status: .rejected),
        ])
        #expect(draft.totalMinutes == 30)
    }

    func json(_ review: DraftReview) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(review)) as? [String: Any])
    }

    @Test("A plain accept sends only the action")
    func plainAccept() throws {
        #expect(Set(try json(DraftReview(action: .accept)).keys) == ["action"])
    }

    @Test("Moving to no client sends an explicit null; keeping the client leaves the key out")
    func clientChange() throws {
        let none = try json(DraftReview(action: .edit, clientId: nil, changeClient: true))
        #expect(none.keys.contains("client_id"))
        #expect(none["client_id"] is NSNull)
        let other = try json(DraftReview(action: .accept, description: "Fixed", minutes: 30, clientId: "c_globex", changeClient: true))
        #expect(other["client_id"] as? String == "c_globex")
        #expect(other["minutes"] as? Int == 30)
        #expect(!(try json(DraftReview(action: .accept, minutes: 30))).keys.contains("client_id"))
    }

    @Test("Durations read naturally", arguments: [(45, "45 min"), (60, "1 h"), (65, "1 h 05 min"), (135, "2 h 15 min")])
    func durations(minutes: Int, text: String) {
        #expect(minutes.asDuration == text)
    }

    @Test("Draft requests: time zone, entry path, token")
    func requests() async throws {
        let host = "test-\(UUID().uuidString.lowercased()).example"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let client = BackendClient(baseURL: URL(string: "https://\(host)")!, session: URLSession(configuration: config))
        let credentials = DeviceCredentials(deviceId: "d", token: "tok")

        StubProtocol.answer(host: host, status: 200, json: #"{"date":"2026-10-13","entries":[]}"#)
        _ = try await client.fetchDraft(timeZone: TimeZone(identifier: "America/Los_Angeles")!, credentials: credentials)
        let get = try #require(StubProtocol.requests(host: host).last)
        #expect(get.url?.path == "/v1/drafts/today")
        #expect(URLComponents(url: get.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "America/Los_Angeles")

        StubProtocol.answer(host: host, status: 200, json: #"{"id":"d_2026-10-13_c acme","description":"x","minutes":5,"status":"accepted"}"#)
        let updated = try await client.review(entry: "d_2026-10-13_c acme", DraftReview(action: .accept), credentials: credentials)
        #expect(updated.status == .accepted)
        let post = try #require(StubProtocol.requests(host: host).last)
        #expect(post.httpMethod == "POST")
        #expect(post.url?.absoluteString.hasSuffix("/v1/drafts/entries/d_2026-10-13_c%20acme/review") == true)
        #expect(post.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }
}
