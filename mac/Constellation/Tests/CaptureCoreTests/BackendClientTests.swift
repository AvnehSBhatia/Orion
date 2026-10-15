import Foundation
import Testing
@testable import CaptureCore

// The backend client against a stub network, plus a live check against the
// mock backend when asked for.

/// Answers requests from a table, keyed by host, so parallel tests don't collide.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var answers: [String: (status: Int, body: Data, headers: [String: String])] = [:]
    nonisolated(unsafe) private static var seen: [String: [URLRequest]] = [:]
    private static let lock = NSLock()

    static func answer(host: String, status: Int, json: String, headers: [String: String] = [:]) {
        lock.lock(); defer { lock.unlock() }
        answers[host] = (status, Data(json.utf8), headers)
    }

    static func requests(host: String) -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return seen[host] ?? []
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let host = request.url?.host ?? ""
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream { recorded.httpBody = Self.read(stream) }
        Self.lock.lock()
        Self.seen[host, default: []].append(recorded)
        let answer = Self.answers[host] ?? (500, Data(), [:])
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: nil, headerFields: answer.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open(); defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

@Suite("Backend client")
struct BackendClientTests {
    let host = "test-\(UUID().uuidString.lowercased()).example"
    var client: BackendClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return BackendClient(baseURL: URL(string: "https://\(host)")!, session: URLSession(configuration: config))
    }

    let credentials = DeviceCredentials(deviceId: "dev_1", token: "secret-token")

    func block() -> WorkBlockPayload {
        let record = ActivityRecord(
            id: UUID(), startedAt: Date(timeIntervalSince1970: 1_800_000_000), endedAt: Date(timeIntervalSince1970: 1_800_000_600),
            appBundleId: "com.apple.mail", appName: "Mail", windowTitle: "Re: plan", domainPath: nil, text: "call [PHONE]",
            textHash: "", redactionCount: 1, status: .approved, snapshotCount: 1
        )
        return WorkBlockPayload(record)
    }

    @Test("Only https, or http to localhost", arguments: [
        ("https://api.example.com", true), ("http://localhost:8787", true), ("http://127.0.0.1:8787", true),
        ("http://api.example.com", false), ("ftp://example.com", false), ("not a url", false), ("", false),
    ])
    func urlRules(text: String, allowed: Bool) {
        #expect(((try? BackendClient.validatedURL(text)) != nil) == allowed)
    }

    @Test("Destination shows host and port")
    func destination() {
        #expect(BackendClient(baseURL: URL(string: "http://localhost:8787")!).destination == "localhost:8787")
        #expect(BackendClient(baseURL: URL(string: "https://api.example.com")!).destination == "api.example.com")
    }

    @Test("Register sends the Mac model and the auth code, nothing else")
    func register() async throws {
        StubProtocol.answer(host: host, status: 200, json: #"{"device_id":"dev_9","device_token":"abc"}"#)
        let result = try await client.register(DeviceRegistration(name: "MacBook Pro", authCode: "K7QF-2M9D"))
        #expect(result == DeviceCredentials(deviceId: "dev_9", token: "abc"))

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/devices/register")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body as? [String: String] == ["name": "MacBook Pro", "auth_code": "K7QF-2M9D"])
    }

    @Test("A bad auth code says so")
    func badCode() async {
        StubProtocol.answer(host: host, status: 401, json: #"{"error":{"code":"invalid_code","message":"x"}}"#)
        await #expect(throws: BackendError.badCode) { try await client.register(DeviceRegistration(name: "Mac", authCode: "nope")) }
    }

    @Test("Mac model names")
    func deviceNames() {
        #expect(DeviceName.friendly(hwModel: "MacBookPro18,3") == "MacBook Pro")
        #expect(DeviceName.friendly(hwModel: "MacBookAir10,1") == "MacBook Air")
        #expect(DeviceName.friendly(hwModel: "iMac21,1") == "iMac")
        #expect(DeviceName.friendly(hwModel: "Macmini9,1") == "Mac mini")
        #expect(DeviceName.friendly(hwModel: "Mac15,3") == "Mac")
        #expect(DeviceName.friendly(hwModel: nil) == "Mac")
    }

    @Test("Work blocks carry the token, the batch hash, and the blocks")
    func workBlocks() async throws {
        let payload = block()
        StubProtocol.answer(host: host, status: 200, json: #"{"accepted":1,"duplicate":0,"accepted_ids":["\#(payload.localId)"],"rejected":[{"local_id":"x","reason":"card_number"}]}"#)
        let response = try await client.postWorkBlocks([payload], credentials: credentials)
        #expect(response.acceptedIds == [payload.localId])
        #expect(response.rejected == [.init(localId: "x", reason: "card_number")])

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.url?.path == "/v1/work-blocks")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body["batch_hash"] as? String == Segmenter.hash(payload.localId))
        #expect(body["device_id"] == nil)
        let blocks = try #require(body["blocks"] as? [[String: Any]])
        #expect(blocks.first?["snippet"] as? String == "call [PHONE]")
        #expect(blocks.first?["match_method"] as? String == "none")
        #expect(blocks.first?["match_confidence"] as? Double == 0)
        #expect(blocks.first?["started_at"] as? String == "2027-01-15T08:00:00Z")
    }

    @Test("The batch hash is the sha256 of the sorted ids, in any order")
    func batchHash() {
        let a = block(), b = block()
        let expected = Segmenter.hash([a.localId, b.localId].sorted().joined(separator: "\n"))
        #expect(WorkBlockPayload.batchHash([a, b]) == expected)
        #expect(WorkBlockPayload.batchHash([b, a]) == expected)
    }

    @Test("Snippets are cut at 1500 characters and confidence is capped at 1")
    func snippetAndConfidence() {
        var record = ActivityRecord(
            id: UUID(), startedAt: Date(), endedAt: Date(), appBundleId: "x", appName: "x", windowTitle: "t", domainPath: nil,
            text: String(repeating: "a", count: 3_000), textHash: "", redactionCount: 0, status: .approved, snapshotCount: 1
        )
        let client = Client(id: "c1", name: "Acme")
        let match = ClientMatch(client: client, reason: "domain", score: 220, method: .domain)
        let payload = WorkBlockPayload(record, match: BlockMatch(match))
        #expect(payload.snippet.count == 1_500)
        #expect(payload.matchConfidence == 1)
        #expect(payload.matchedClientId == "c1")
        #expect(payload.matchMethod == .domain)
        record.text = "short"
        #expect(WorkBlockPayload(record, match: BlockMatch(ClientMatch(client: client, reason: "", score: 70, method: .alias))).matchConfidence == 0.7)
    }

    @Test("429 and 5xx with Retry-After carry the wait; consent and pause are told apart")
    func throttling() async {
        StubProtocol.answer(host: host, status: 429, json: "{}", headers: ["Retry-After": "120"])
        await #expect(throws: BackendError.throttled(status: 429, retryAfter: 120)) { try await client.postWorkBlocks([block()], credentials: credentials) }
        StubProtocol.answer(host: host, status: 503, json: "{}", headers: ["Retry-After": "45"])
        await #expect(throws: BackendError.throttled(status: 503, retryAfter: 45)) { try await client.postWorkBlocks([block()], credentials: credentials) }
        StubProtocol.answer(host: host, status: 403, json: #"{"error":{"code":"consent_required"}}"#)
        await #expect(throws: BackendError.consentRequired) { try await client.postWorkBlocks([block()], credentials: credentials) }
        StubProtocol.answer(host: host, status: 403, json: #"{"error":{"code":"capture_paused"}}"#)
        await #expect(throws: BackendError.capturePaused) { try await client.postWorkBlocks([block()], credentials: credentials) }
    }

    @Test("Backoff is exponential and never shorter than Retry-After")
    func backoffMath() {
        #expect(BackendClient.minimumWait(failures: 1, retryAfter: nil) == 30)
        #expect(BackendClient.minimumWait(failures: 3, retryAfter: nil) == 120)
        #expect(BackendClient.minimumWait(failures: 1, retryAfter: 300) == 300)
        #expect(BackendClient.minimumWait(failures: 20, retryAfter: nil) == 900)
    }

    @Test("Policy and consent calls")
    func policyAndConsent() async throws {
        StubProtocol.answer(host: host, status: 200, json: #"{"capture_enabled":false,"excluded_hosts":["Mail.Google.com"],"capture_interval_sec":30,"consent":{"required":true,"version":2,"notice":"Hello"}}"#)
        let policy = try await client.fetchPolicy(credentials: credentials)
        #expect(!policy.captureEnabled)
        #expect(policy.excludedHosts == ["mail.google.com"])
        #expect(policy.captureIntervalSec == 30)
        #expect(!policy.browserPageText)
        #expect(policy.needsConsent(accepted: nil) && policy.needsConsent(accepted: 1) && !policy.needsConsent(accepted: 2))
        #expect(try #require(StubProtocol.requests(host: host).last).url?.path == "/v1/policy")

        StubProtocol.answer(host: host, status: 200, json: #"{"accepted_at":"2027-01-01T00:00:00Z"}"#)
        _ = try await client.acceptConsent(version: 2, credentials: credentials)
        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.url?.path == "/v1/consent")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Int])
        #expect(body == ["version": 2])
    }

    @Test("Delete my data accepts a 202 with a request id")
    func deleteData() async throws {
        StubProtocol.answer(host: host, status: 202, json: #"{"request_id":"r1"}"#)
        try await client.deleteMyData(credentials: credentials)
        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path == "/v1/me/data")
    }

    @Test("Clients: since is the etag, and old saved lists still load")
    func clients() async throws {
        StubProtocol.answer(host: host, status: 200, json: #"{"clients":[{"id":"c1","name":"Acme","active":false}],"rules":[{"id":"r1","pattern":"acme.com","client_id":"c1"}],"etag":"e2"}"#)
        let response = try await client.fetchClients(since: "e1", credentials: credentials)
        #expect(response.etag == "e2" && response.rules?.count == 1 && response.clients[0].active == false)
        #expect(try #require(StubProtocol.requests(host: host).last).url?.query == "since=e1")
        let old = try JSONDecoder().decode(ClientList.self, from: Data(#"{"clients":[{"id":"c1","name":"Acme"}],"since":"old"}"#.utf8))
        #expect(old.clients.count == 1 && old.etag == nil && old.cursor == nil)
        var list = ClientList(clients: [Client(id: "c1", name: "Acme")], etag: "e1")
        #expect(list.cursor == "e1")
        list.merge(response, full: false)
        #expect(list.activeClients.isEmpty && list.rules.count == 1 && list.cursor == "e2")
        #expect(ClientList(etag: "e1").cursor == nil) // empty list: full sync
    }

    @Test("Summaries post the same blocks as sending and return the AI's text")
    func summarize() async throws {
        let payload = block()
        StubProtocol.answer(host: host, status: 200, json: #"{"summary":"Replied about the plan."}"#)
        let response = try await client.summarize([payload], credentials: credentials)
        #expect(response.summary == "Replied about the plan.")

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/summaries")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(Set(body.keys) == ["blocks"])
        #expect((body["blocks"] as? [[String: Any]])?.first?["snippet"] as? String == "call [PHONE]") // redacted, as sent
    }

    @Test("A batch's signature changes when an item is added or edited")
    func signature() {
        func item(_ text: String, id: UUID = UUID()) -> OutboxItem {
            OutboxItem(record: ActivityRecord(
                id: id, startedAt: Date(timeIntervalSince1970: 0), endedAt: Date(timeIntervalSince1970: 60),
                appBundleId: "com.apple.mail", appName: "Mail", windowTitle: "Plan", domainPath: nil, text: text,
                textHash: "", redactionCount: 0, status: .queued, snapshotCount: 1
            ))
        }
        let id = UUID()
        let one = OutboxBatch.group([item("a", id: id)])[0]
        #expect(one.signature == OutboxBatch.group([item("a", id: id)])[0].signature)
        #expect(one.signature != OutboxBatch.group([item("edited", id: id)])[0].signature)
        #expect(one.signature != OutboxBatch.group([item("a", id: id), item("b")])[0].signature)
    }

    @Test("A rejected token and server errors are told apart")
    func errors() async throws {
        StubProtocol.answer(host: host, status: 401, json: "{}")
        await #expect(throws: BackendError.unauthorized) { try await client.postWorkBlocks([block()], credentials: credentials) }
        StubProtocol.answer(host: host, status: 503, json: "{}")
        await #expect(throws: BackendError.server(status: 503)) { try await client.postWorkBlocks([block()], credentials: credentials) }
        StubProtocol.answer(host: host, status: 200, json: "not json")
        await #expect(throws: BackendError.badResponse) { try await client.postWorkBlocks([block()], credentials: credentials) }
    }
}

@Suite("Sent records")
struct SentRecordTests {
    @Test("Marking sent records the time and destination; only approved items are sent")
    func markSent() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-sent-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let store = try RecordStore(url: folder.appendingPathComponent("store.sqlite"), keys: MemoryStoreKey())
        func record() -> ActivityRecord {
            ActivityRecord(id: UUID(), startedAt: Date().addingTimeInterval(-300), endedAt: Date().addingTimeInterval(-200),
                           appBundleId: "com.apple.mail", appName: "Mail", windowTitle: "t", domainPath: nil, text: "x",
                           textHash: "", redactionCount: 0, status: .local, snapshotCount: 1)
        }
        let approved = record(), waiting = record()
        try store.saveNow(approved)
        try store.saveNow(waiting)
        store.closeOpen(except: nil, endedBefore: nil, approve: false)
        try store.approve([approved.id])

        try store.markSent([approved.id, waiting.id], destination: "localhost:8787") // waiting isn't approved: ignored
        let sent = try store.outbox([.sent])
        #expect(sent.map(\.id) == [approved.id])
        #expect(sent.first?.sentTo == "localhost:8787")
        #expect(sent.first?.sentAt != nil)
        #expect(try store.outbox([.queued]).map(\.id) == [waiting.id])
        #expect(try store.outbox([.approved]).isEmpty)
    }
}

// Run against the mock backend:
//   node mac/mock-backend/server.mjs &
//   CONSTELLATION_LIVE_BACKEND=http://localhost:8787 swift test --filter LiveBackendTests
@Suite("Live mock backend", .enabled(if: ProcessInfo.processInfo.environment["CONSTELLATION_LIVE_BACKEND"] != nil))
struct LiveBackendTests {
    @Test("Register, send a block, send it again, and delete")
    func roundTrip() async throws {
        let url = try BackendClient.validatedURL(ProcessInfo.processInfo.environment["CONSTELLATION_LIVE_BACKEND"] ?? "")
        let client = BackendClient(baseURL: url)
        let credentials = try await client.register(DeviceRegistration(name: "Mac", authCode: ProcessInfo.processInfo.environment["CONSTELLATION_LIVE_CODE"] ?? "K7QF-2M9D"))
        let record = ActivityRecord(
            id: UUID(), startedAt: Date().addingTimeInterval(-600), endedAt: Date(), appBundleId: "com.apple.mail",
            appName: "Mail", windowTitle: "Live test", domainPath: nil, text: "Live test block with [EMAIL]",
            textHash: "", redactionCount: 1, status: .approved, snapshotCount: 1
        )
        let clients = try await client.fetchClients(since: nil, credentials: credentials) // may be empty on a new org
        #expect(clients.etag != nil)
        let policy = try await client.fetchPolicy(credentials: credentials)
        if policy.consent.required { _ = try await client.acceptConsent(version: policy.consent.version, credentials: credentials) }
        let matcher = ClientMatcher(clients: clients.clients, rules: clients.rules ?? [])
        let payload = WorkBlockPayload(record, match: BlockMatch(matcher.match(title: record.windowTitle, domainPath: record.domainPath, text: record.text)))
        let first = try await client.postWorkBlocks([payload], credentials: credentials)
        #expect(first.acceptedIds == [record.id.uuidString])
        let again = try await client.postWorkBlocks([payload], credentials: credentials) // resend is safe
        #expect(again.acceptedIds == [record.id.uuidString])

        try await client.deleteMyData(credentials: credentials)
        await #expect(throws: BackendError.unauthorized) {
            try await client.postWorkBlocks([WorkBlockPayload(record)], credentials: DeviceCredentials(deviceId: "x", token: "wrong"))
        }
    }
}
