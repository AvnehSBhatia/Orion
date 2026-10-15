import Foundation
import Testing
@testable import CaptureCore

@Suite("Daily draft")
struct DraftTests {
    @Test("Reads entries: wire statuses, evidence, optional fields")
    func decode() throws {
        let json = """
        {"draft_id":"d1","day":"2026-10-13","entries":[
          {"id":"e1","client_id":"c_acme","narrative":"Acme renewal emails","minutes":45,
           "started_at":"2026-10-13T16:02:11.482Z","ended_at":"2026-10-13T16:47:00Z",
           "evidence":[{"work_block_id":"b1","quote":"Re: renewal"},{"work_block_id":"b2","quote":"Pricing"},{"work_block_id":"b1","quote":"Again"}],
           "unmatched":false,"status":"edited"},
          {"id":"e2","client_id":null,"narrative":"Inbox","minutes":10,"unmatched":true,"status":"proposed"},
          {"id":"e3","client_id":"c","narrative":"x","minutes":6,"status":"rejected"}
        ]}
        """
        let draft = try BackendClient.decoder.decode(Draft.self, from: Data(json.utf8))
        #expect(draft.draftId == "d1" && draft.day == "2026-10-13")
        #expect(draft.entries.count == 3)
        #expect(draft.entries[0].startedAt != nil && draft.entries[0].endedAt != nil)
        #expect(draft.entries[0].status == .accepted && draft.entries[0].edited)
        #expect(draft.entries[0].evidence.count == 3)
        #expect(draft.entries[0].blockIds == ["b1", "b2"])
        #expect(draft.entries[1].clientId == nil && draft.entries[1].unmatched)
        #expect(draft.entries[1].status == .pending && !draft.entries[1].edited)
        #expect(draft.entries[2].status == .rejected)
        #expect(draft.totalMinutes == 55)
    }

    @Test("Status mapping: proposed pending, edited accepted+edited, unknown pending")
    func statusMapping() {
        #expect(DraftEntry.status(from: "proposed") == (.pending, false))
        #expect(DraftEntry.status(from: "accepted") == (.accepted, false))
        #expect(DraftEntry.status(from: "edited") == (.accepted, true))
        #expect(DraftEntry.status(from: "rejected") == (.rejected, false))
        #expect(DraftEntry.status(from: "weird") == (.pending, false))
        #expect(DraftEntry.status(from: nil) == (.pending, false))
    }

    @Test("Rejected entries don't count toward the total")
    func total() {
        let draft = Draft(draftId: "d", day: "d", entries: [
            DraftEntry(id: "a", clientId: nil, narrative: "", minutes: 30),
            DraftEntry(id: "b", clientId: nil, narrative: "", minutes: 20, status: .rejected),
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
        let other = try json(DraftReview(action: .accept, narrative: "Fixed", minutes: 30, clientId: "c_globex", changeClient: true))
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

        StubProtocol.answer(host: host, status: 200, json: #"{"draft_id":"d1","day":"2026-10-13","entries":[]}"#)
        _ = try await client.fetchDraft(timeZone: TimeZone(identifier: "America/Los_Angeles")!, credentials: credentials)
        let get = try #require(StubProtocol.requests(host: host).last)
        #expect(get.url?.path == "/v1/drafts/today")
        #expect(URLComponents(url: get.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "America/Los_Angeles")

        StubProtocol.answer(host: host, status: 200, json: #"{"entry":{"id":"d_2026-10-13_c acme","narrative":"x","minutes":5,"status":"accepted"}}"#)
        let updated = try await client.review(entry: "d_2026-10-13_c acme", DraftReview(action: .accept), credentials: credentials)
        #expect(updated.status == .accepted)
        let post = try #require(StubProtocol.requests(host: host).last)
        #expect(post.httpMethod == "POST")
        #expect(post.url?.absoluteString.hasSuffix("/v1/drafts/entries/d_2026-10-13_c%20acme/review") == true)
        #expect(post.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }

    @Test("Finalize, export and baseline requests")
    func finalizeExportBaseline() async throws {
        let host = "test-\(UUID().uuidString.lowercased()).example"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let client = BackendClient(baseURL: URL(string: "https://\(host)")!, session: URLSession(configuration: config))
        let credentials = DeviceCredentials(deviceId: "d", token: "tok")

        StubProtocol.answer(host: host, status: 200, json: #"{"exported":4}"#)
        let done = try await client.finalize(draft: "d1", credentials: credentials)
        #expect(done.exported == 4)
        let post = try #require(StubProtocol.requests(host: host).last)
        #expect(post.httpMethod == "POST" && post.url?.path == "/v1/drafts/d1/finalize")

        StubProtocol.answer(host: host, status: 200, json: "date,client,minutes,narrative,status\n")
        let csv = try await client.exportCSV(draft: "d1", credentials: credentials)
        #expect(String(decoding: csv, as: UTF8.self).hasPrefix("date,client"))
        let get = try #require(StubProtocol.requests(host: host).last)
        #expect(get.httpMethod == "GET" && get.url?.path == "/v1/drafts/d1/export")
        #expect(get.value(forHTTPHeaderField: "Accept") == "text/csv")

        StubProtocol.answer(host: host, status: 409, json: "{}")
        await #expect(throws: BackendError.server(status: 409)) { _ = try await client.exportCSV(draft: "d1", credentials: credentials) }

        StubProtocol.answer(host: host, status: 200, json: #"{"day":"2026-10-13","entries":[{"client_id":"c_acme","minutes":120}]}"#)
        let sent = Baseline(day: "2026-10-13", entries: [.init(clientId: "c_acme", minutes: 120)])
        let saved = try await client.saveBaseline(sent, credentials: credentials)
        #expect(saved == sent)
        let baselinePost = try #require(StubProtocol.requests(host: host).last)
        #expect(baselinePost.url?.path == "/v1/baseline")
        let body = try #require(baselinePost.httpBody)
        let object = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(object["day"] as? String == "2026-10-13")
        #expect((object["entries"] as? [[String: Any]])?.first?["client_id"] as? String == "c_acme")
    }

    @Test("The baseline week is the seven days ending yesterday")
    func week() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let today = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 9)))
        let days = Baseline.week(endingBefore: today, calendar: calendar).map { Baseline.dayString($0, calendar: calendar) }
        #expect(days.first == "2026-10-07" && days.last == "2026-10-13" && days.count == 7)
    }
}
