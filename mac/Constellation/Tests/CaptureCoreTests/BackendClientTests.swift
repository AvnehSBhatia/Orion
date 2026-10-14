import Foundation
import Testing
@testable import CaptureCore

// The backend client against a stub network, plus a live check against the
// mock backend when asked for.

/// Answers requests from a table, keyed by host, so parallel tests don't collide.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) private static var answers: [String: (status: Int, body: Data)] = [:]
    nonisolated(unsafe) private static var seen: [String: [URLRequest]] = [:]
    private static let lock = NSLock()

    static func answer(host: String, status: Int, json: String) {
        lock.lock(); defer { lock.unlock() }
        answers[host] = (status, Data(json.utf8))
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
        let answer = Self.answers[host] ?? (500, Data())
        Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: answer.status, httpVersion: nil, headerFields: nil)!
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

    @Test("Register sends no names and returns the token")
    func register() async throws {
        StubProtocol.answer(host: host, status: 200, json: #"{"device_id":"dev_9","token":"abc"}"#)
        let registration = DeviceRegistration(installId: "install-1", platform: "macOS", osVersion: "15", appVersion: "0.6", enrollmentCode: nil)
        let result = try await client.register(registration)
        #expect(result == DeviceCredentials(deviceId: "dev_9", token: "abc"))

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/devices/register")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(Set(body.keys) == ["install_id", "platform", "os_version", "app_version"]) // empty code left out
    }

    @Test("Work blocks carry the token, the device id, and the blocks")
    func workBlocks() async throws {
        let payload = block()
        StubProtocol.answer(host: host, status: 200, json: #"{"accepted":["\#(payload.id)"],"rejected":[]}"#)
        let response = try await client.postWorkBlocks([payload], credentials: credentials)
        #expect(response.accepted == [payload.id])

        let request = try #require(StubProtocol.requests(host: host).last)
        #expect(request.url?.path == "/v1/work-blocks")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body["device_id"] as? String == "dev_1")
        let blocks = try #require(body["blocks"] as? [[String: Any]])
        #expect(blocks.first?["text"] as? String == "call [PHONE]")
        #expect(blocks.first?["started_at"] as? String == "2027-01-15T08:00:00Z")
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
        let credentials = try await client.register(DeviceRegistration(
            installId: UUID().uuidString, platform: "macOS", osVersion: "test", appVersion: "test", enrollmentCode: nil
        ))
        let record = ActivityRecord(
            id: UUID(), startedAt: Date().addingTimeInterval(-600), endedAt: Date(), appBundleId: "com.apple.mail",
            appName: "Mail", windowTitle: "Live test", domainPath: nil, text: "Live test block with [EMAIL]",
            textHash: "", redactionCount: 1, status: .approved, snapshotCount: 1
        )
        let clients = try await client.fetchClients(since: nil, credentials: credentials)
        #expect(!clients.clients.isEmpty)
        let matcher = ClientMatcher(clients: clients.clients)
        let first = try await client.postWorkBlocks(
            [WorkBlockPayload(record, clientId: matcher.match(title: record.windowTitle, domainPath: record.domainPath, text: record.text)?.client.id)],
            credentials: credentials
        )
        #expect(first.accepted == [record.id.uuidString])
        let again = try await client.postWorkBlocks([WorkBlockPayload(record)], credentials: credentials) // resend is safe
        #expect(again.accepted == [record.id.uuidString])
        // Today's draft has an entry made from that block; accept it, moved to no client.
        let draft = try await client.fetchDraft(credentials: credentials)
        let entry = try #require(draft.entries.first { $0.blockIds.contains(record.id.uuidString) })
        let reviewed = try await client.review(
            entry: entry.id, DraftReview(action: .accept, minutes: 15, clientId: nil, changeClient: true), credentials: credentials
        )
        #expect(reviewed.status == .accepted)
        #expect(reviewed.minutes == 15)
        #expect(reviewed.clientId == nil)
        #expect(reviewed.edited)

        try await client.deleteMyData(credentials: credentials)
        await #expect(throws: BackendError.unauthorized) {
            try await client.postWorkBlocks([WorkBlockPayload(record)], credentials: DeviceCredentials(deviceId: "x", token: "wrong"))
        }
    }
}
