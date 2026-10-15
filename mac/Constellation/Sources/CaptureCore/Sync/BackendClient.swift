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
        case .network(let message): "Couldn't reach the backend: \(message)"
        case .badResponse: "The backend sent an answer this app doesn't understand."
        }
    }
}

/// Sent once, to get a device token. No computer name or user name is sent.
public struct DeviceRegistration: Codable, Sendable, Equatable {
    public var installId: String
    public var platform: String
    public var osVersion: String
    public var appVersion: String
    /// Optional code from the company, if the backend needs one to know who this is.
    public var enrollmentCode: String?

    enum CodingKeys: String, CodingKey {
        case installId = "install_id"
        case platform
        case osVersion = "os_version"
        case appVersion = "app_version"
        case enrollmentCode = "enrollment_code"
    }

    public init(installId: String, platform: String, osVersion: String, appVersion: String, enrollmentCode: String?) {
        self.installId = installId
        self.platform = platform
        self.osVersion = osVersion
        self.appVersion = appVersion
        self.enrollmentCode = enrollmentCode
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
    public var deviceId: String
    public var blocks: [WorkBlockPayload]

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case blocks
    }
}

public struct WorkBlocksResponse: Codable, Sendable, Equatable {
    public struct Rejected: Codable, Sendable, Equatable {
        public var id: String
        public var reason: String
    }

    /// Ids the backend stored. Sending the same id again is safe: the backend keeps one copy.
    public var accepted: [String]
    public var rejected: [Rejected]?
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
        try await send("POST", "/v1/devices/register", body: registration, token: nil)
    }

    /// POST /v1/work-blocks
    public func postWorkBlocks(_ blocks: [WorkBlockPayload], credentials: DeviceCredentials) async throws -> WorkBlocksResponse {
        try await send("POST", "/v1/work-blocks", body: WorkBlocksRequest(deviceId: credentials.deviceId, blocks: blocks),
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
        let _: Empty = try await send("DELETE", "/v1/me/data", body: Empty?.none, token: credentials.token)
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

    func send<Body: Encodable, Response: Decodable>(
        _ method: String, _ path: String, body: Body?, token: String?
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
        if http.statusCode == 401 || http.statusCode == 403 { throw BackendError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw BackendError.server(status: http.statusCode) }
        if Response.self == Empty.self, data.isEmpty { return Empty() as! Response }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw BackendError.badResponse
        }
    }
}
