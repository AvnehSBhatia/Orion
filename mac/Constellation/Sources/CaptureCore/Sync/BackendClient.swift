import Foundation

// Talks to the Constellation backend. Request and response shapes are written
// down in mac/BACKEND_CONTRACT.md for the backend team.

public enum BackendError: Error, Equatable {
    case invalidURL
    case notConnected
    /// Only https, except http to this Mac (localhost) for testing.
    case insecureURL
    /// The backend no longer accepts this device's token.
    case unauthorized
    case server(status: Int)
    /// 429, or 5xx with a Retry-After: wait at least this long (seconds) before trying again.
    case throttled(status: Int, retryAfter: TimeInterval?)
    /// 403 consent_required: the person has not accepted the company's notice yet.
    case consentRequired
    /// 403 capture_paused: the company paused capture.
    case capturePaused
    /// Registration: the auth code is invalid, used, or expired.
    case badCode
    case network(String)
    case badResponse
}

extension BackendError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidURL: "That isn't a valid web address."
        case .notConnected: "Connect to the backend in the Outbox first."
        case .insecureURL: "Use an https address (http is only allowed for localhost)."
        case .unauthorized: "The backend no longer accepts this Mac. Connect again."
        case .server(let status): "The backend answered with an error (\(status))."
        case .throttled(let status, _): "The backend is busy (\(status))."
        case .consentRequired: "Accept your company's monitoring notice first."
        case .capturePaused: "Paused by your company."
        case .badCode: "That code didn't work. Make a new one in the Orion web app (Settings, Connect your Mac)."
        case .network(let message): "Couldn't reach the backend: \(message)"
        case .badResponse: "The backend sent an answer this app doesn't understand."
        }
    }
}

/// Sent once, to get a device token: the Mac model (never the computer or user name)
/// and the one-time code made in the Orion web app.
public struct DeviceRegistration: Codable, Sendable, Equatable {
    public var name: String
    public var authCode: String

    enum CodingKeys: String, CodingKey {
        case name
        case authCode = "auth_code"
    }

    public init(name: String, authCode: String) {
        self.name = name
        self.authCode = authCode
    }
}

/// Kept in the Keychain, never in settings.
public struct DeviceCredentials: Codable, Sendable, Equatable {
    public var deviceId: String
    public var token: String

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case token
    }

    public init(deviceId: String, token: String) {
        self.deviceId = deviceId
        self.token = token
    }

    static let keychainAccount = "device-token"

    public static func load() -> DeviceCredentials? {
        (try? Keychain.read(keychainAccount)).flatMap { $0 }.flatMap { try? JSONDecoder().decode(Self.self, from: $0) }
    }

    public func save() throws {
        try Keychain.write(JSONEncoder().encode(self), account: Self.keychainAccount, label: "Constellation device token")
    }

    public static func forget() throws {
        try Keychain.delete(keychainAccount)
    }
}

public struct WorkBlocksRequest: Codable, Sendable {
    /// SHA-256 hex of the sorted local ids joined by newlines.
    public var batchHash: String
    public var blocks: [WorkBlockPayload]

    enum CodingKeys: String, CodingKey {
        case batchHash = "batch_hash"
        case blocks
    }

    public init(blocks: [WorkBlockPayload]) {
        self.blocks = blocks
        batchHash = WorkBlockPayload.batchHash(blocks)
    }
}

public struct WorkBlocksResponse: Codable, Sendable, Equatable {
    public struct Rejected: Codable, Sendable, Equatable {
        public var localId: String
        public var reason: String

        enum CodingKeys: String, CodingKey {
            case localId = "local_id"
            case reason
        }

        public init(localId: String, reason: String) {
            self.localId = localId
            self.reason = reason
        }
    }

    public var accepted: Int?
    public var duplicate: Int?
    /// Every id now stored, new or duplicate. Sending one again is safe.
    public var acceptedIds: [String]
    public var rejected: [Rejected]

    enum CodingKeys: String, CodingKey {
        case accepted, duplicate, rejected
        case acceptedIds = "accepted_ids"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accepted = try? c.decodeIfPresent(Int.self, forKey: .accepted)
        duplicate = try? c.decodeIfPresent(Int.self, forKey: .duplicate)
        acceptedIds = try c.decodeIfPresent([String].self, forKey: .acceptedIds) ?? []
        rejected = (try? c.decodeIfPresent([Rejected].self, forKey: .rejected)) ?? []
    }

    public init(acceptedIds: [String], rejected: [Rejected] = []) {
        self.acceptedIds = acceptedIds
        self.rejected = rejected
    }
}

public struct BackendClient: Sendable {
    public let baseURL: URL
    let session: URLSession

    public static let requestTimeout: TimeInterval = 20
    /// Most blocks per POST /v1/work-blocks.
    public static let batchLimit = 50

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Checks what someone typed: https, or http only to localhost.
    public static func validatedURL(_ text: String) throws -> URL {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              !host.isEmpty else { throw BackendError.invalidURL }
        if scheme == "https" { return url }
        if scheme == "http", ["localhost", "127.0.0.1", "::1"].contains(host) { return url }
        throw scheme == "http" ? BackendError.insecureURL : BackendError.invalidURL
    }

    /// "localhost:8787" or "api.example.com": where things were sent, for the Outbox.
    public var destination: String {
        guard let host = baseURL.host else { return baseURL.absoluteString }
        return baseURL.port.map { "\(host):\($0)" } ?? host
    }

    // MARK: Endpoints

    /// POST /v1/devices/register
    public func register(_ registration: DeviceRegistration) async throws -> DeviceCredentials {
        do {
            return try await send("POST", "/v1/devices/register", body: registration, token: nil)
        } catch BackendError.unauthorized {
            throw BackendError.badCode
        }
    }

    /// GET /v1/policy
    public func fetchPolicy(credentials: DeviceCredentials) async throws -> OrgPolicy {
        try await send("GET", "/v1/policy", body: Empty?.none, token: credentials.token)
    }

    private struct ConsentRequest: Codable { var version: Int }

    /// POST /v1/consent
    public func acceptConsent(version: Int, credentials: DeviceCredentials) async throws -> ConsentResponse {
        try await send("POST", "/v1/consent", body: ConsentRequest(version: version), token: credentials.token)
    }

    /// POST /v1/work-blocks
    public func postWorkBlocks(_ blocks: [WorkBlockPayload], credentials: DeviceCredentials) async throws -> WorkBlocksResponse {
        try await send("POST", "/v1/work-blocks", body: WorkBlocksRequest(blocks: blocks),
                       token: credentials.token)
    }

    /// POST /v1/summaries  The AI's summary of a waiting batch. The backend keeps nothing.
    public func summarize(_ blocks: [WorkBlockPayload], credentials: DeviceCredentials) async throws -> SummaryResponse {
        try await send("POST", "/v1/summaries", body: SummaryRequest(blocks: blocks),
                       token: credentials.token)
    }

    /// GET /v1/clients?since=  Only changes since the last sync, once a cursor exists.
    public func fetchClients(since: String?, credentials: DeviceCredentials) async throws -> ClientsResponse {
        var components = URLComponents()
        components.path = "/v1/clients"
        if let since { components.queryItems = [URLQueryItem(name: "since", value: since)] }
        return try await send("GET", components.string ?? "/v1/clients", body: Empty?.none, token: credentials.token)
    }

    /// GET /v1/drafts/today?tz=  "Today" is the person's local day, so the time zone goes along.
    public func fetchDraft(timeZone: TimeZone = .current, credentials: DeviceCredentials) async throws -> Draft {
        var components = URLComponents()
        components.path = "/v1/drafts/today"
        components.queryItems = [URLQueryItem(name: "tz", value: timeZone.identifier)]
        return try await send("GET", components.string ?? "/v1/drafts/today", body: Empty?.none, token: credentials.token)
    }

    /// POST /v1/drafts/entries/:id/review. Returns the entry as the backend now has it.
    public func review(entry id: String, _ review: DraftReview, credentials: DeviceCredentials) async throws -> DraftEntry {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
        let reply: DraftReviewResponse = try await send("POST", "/v1/drafts/entries/\(escaped)/review", body: review, token: credentials.token)
        return reply.entry
    }

    /// DELETE /v1/me/data
    public func deleteMyData(credentials: DeviceCredentials) async throws {
        let _: Empty = try await send("DELETE", "/v1/me/data", body: Empty?.none, token: credentials.token, lenient: true)
    }

    /// How long to wait after the n-th failure in a row: 30 s, 1 min, 2 min ... up to 15 min,
    /// and never less than the server's Retry-After.
    public static func minimumWait(failures: Int, retryAfter: TimeInterval?) -> TimeInterval {
        max(min(30 * pow(2, Double(max(failures, 1) - 1)), 900), retryAfter ?? 0)
    }

    // MARK: Plumbing

    struct Empty: Codable {}

    /// ISO 8601 with or without fractional seconds ("2026-10-13T17:02:11Z" or "...11.482Z",
    /// which JavaScript's toISOString produces).
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = plain.date(from: text) ?? fractional.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return decoder
    }()

    /// `{ "error": { "code": ... } }`
    static func errorCode(_ data: Data) -> String? {
        struct Envelope: Decodable { struct Inner: Decodable { var code: String? }; var error: Inner? }
        return (try? JSONDecoder().decode(Envelope.self, from: data))?.error?.code
    }

    /// Retry-After in seconds (or an HTTP date), capped at an hour.
    static func retryAfter(_ response: HTTPURLResponse, now: Date = Date()) -> TimeInterval? {
        guard let value = response.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespaces),
              !value.isEmpty else { return nil }
        if let seconds = TimeInterval(value) { return min(max(seconds, 0), 3_600) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter.date(from: value).map { min(max($0.timeIntervalSince(now), 0), 3_600) }
    }

    func makeRequest<Body: Encodable>(_ method: String, _ path: String, body: Body?, token: String?) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw BackendError.invalidURL }
        var request = URLRequest(url: url, timeoutInterval: Self.requestTimeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try WorkBlockPayload.encoder().encode(body)
        }
        return request
    }

    /// Internal on purpose: extensions in other files (drafts) use it.
    /// `lenient`: a 2xx with an empty or unreadable body is fine (DELETE answers 202).
    func send<Body: Encodable, Response: Decodable>(
        _ method: String, _ path: String, body: Body?, token: String?, lenient: Bool = false
    ) async throws -> Response {
        let request = try makeRequest(method, path, body: body, token: token)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BackendError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw BackendError.badResponse }
        if http.statusCode == 401 { throw BackendError.unauthorized }
        if http.statusCode == 403 {
            switch Self.errorCode(data) {
            case "consent_required": throw BackendError.consentRequired
            case "capture_paused": throw BackendError.capturePaused
            default: throw BackendError.server(status: 403)
            }
        }
        let retryAfter = Self.retryAfter(http)
        if http.statusCode == 429 || (http.statusCode >= 500 && retryAfter != nil) {
            throw BackendError.throttled(status: http.statusCode, retryAfter: retryAfter)
        }
        guard (200..<300).contains(http.statusCode) else { throw BackendError.server(status: http.statusCode) }
        if lenient, let empty = Empty() as? Response { return empty }
        if Response.self == Empty.self, data.isEmpty { return Empty() as! Response }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw BackendError.badResponse
        }
    }
}
