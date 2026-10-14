import Foundation

// Clients come from GET /v1/clients and are matched to work blocks on the device.
// Matching looks at a block's window title, browser domain and path, and text,
// and sends only the matched client's id. Client names stay readable on the device.

public struct Client: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var aliases: [String]
    /// "acme.com" also matches its subdomains, e.g. "app.acme.com".
    public var domains: [String]
    /// "P-1042" matches that code exactly; "ACM-" (ending in a dash) matches ACM-1, ACM-204, ...
    public var projectCodes: [String]
    public var updatedAt: String?
    public var deleted: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, aliases, domains, deleted
        case projectCodes = "project_codes"
        case updatedAt = "updated_at"
    }

    public init(id: String, name: String, aliases: [String] = [], domains: [String] = [], projectCodes: [String] = [],
                updatedAt: String? = nil, deleted: Bool = false) {
        self.id = id
        self.name = name
        self.aliases = aliases
        self.domains = domains
        self.projectCodes = projectCodes
        self.updatedAt = updatedAt
        self.deleted = deleted
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases) ?? []
        domains = try c.decodeIfPresent([String].self, forKey: .domains) ?? []
        projectCodes = try c.decodeIfPresent([String].self, forKey: .projectCodes) ?? []
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    }

    /// Name and aliases: what masking must leave readable.
    public var names: [String] { [name] + aliases }
}

/// GET /v1/clients?since= response.
public struct ClientsResponse: Codable, Sendable, Equatable {
    public var clients: [Client]
    /// Pass back as `since` next time to get only what changed.
    public var nextSince: String?

    enum CodingKeys: String, CodingKey {
        case clients
        case nextSince = "next_since"
    }

    public init(clients: [Client], nextSince: String?) {
        self.clients = clients
        self.nextSince = nextSince
    }
}

/// The device's copy of the client list.
public struct ClientList: Codable, Sendable, Equatable {
    public var clients: [Client] = []
    public var since: String?
    public var syncedAt: Date?

    public init(clients: [Client] = [], since: String? = nil, syncedAt: Date? = nil) {
        self.clients = clients
        self.since = since
        self.syncedAt = syncedAt
    }

    /// Apply a sync: changed clients replace their old copy, deleted ones are removed.
    public mutating func merge(_ response: ClientsResponse, at date: Date = Date()) {
        var byId = Dictionary(uniqueKeysWithValues: clients.map { ($0.id, $0) })
        for client in response.clients {
            if client.deleted { byId[client.id] = nil } else { byId[client.id] = client }
        }
        clients = byId.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        since = response.nextSince ?? since
        syncedAt = date
    }
}

public struct ClientMatch: Sendable, Equatable {
    public var client: Client
    /// Why it matched, shown in the Outbox: "domain acme.com", "project code ACM-12", "name Acme".
    public var reason: String
    public var score: Int
}

/// Scores each client against a block and picks one only if it clearly wins.
public struct ClientMatcher: Sendable {
    public let clients: [Client]

    // Points per signal and place. Each place (title, browser address, text) counts
    // its strongest signal once, then the places add up.
    static let domainOfPage = 100 // the browser page is on the client's domain
    static let codeInTitle = 80, nameInTitle = 70, domainInTitle = 60
    static let codeInPath = 80, nameInPath = 40
    static let codeInText = 50, domainInText = 50, nameInText = 30
    /// A match needs at least this many points ...
    public static let threshold = 60
    /// ... and this many more than the next client, or it's too close to call.
    public static let margin = 25

    public init(clients: [Client]) {
        self.clients = clients.filter { !$0.deleted }
    }

    public func match(title: String, domainPath: String?, text: String) -> ClientMatch? {
        let host = domainPath?.split(separator: "/").first.map(String.init)
        let path = domainPath.map { String($0.dropFirst(host?.count ?? 0)) } ?? ""
        let titleHosts = Self.hosts(in: title)
        let textHosts = Self.hosts(in: text)

        var scored: [ClientMatch] = []
        for client in clients {
            var total = 0
            var reasons: [(Int, String)] = []
            func best(_ candidates: [(Int, String)?]) {
                guard let top = candidates.compactMap({ $0 }).max(by: { $0.0 < $1.0 }) else { return }
                total += top.0
                reasons.append(top)
            }
            let domain = { (hosts: [String]) in client.domains.first { d in hosts.contains { Self.host($0, matches: d) } } }

            if let host, let d = domain([host]) { best([(Self.domainOfPage, "domain \(d)")]) }
            best([
                Self.code(client, in: title).map { (Self.codeInTitle, "project code \($0)") },
                Self.name(client, in: title).map { (Self.nameInTitle, "name \($0)") },
                domain(titleHosts).map { (Self.domainInTitle, "domain \($0)") },
            ])
            best([
                Self.code(client, in: path).map { (Self.codeInPath, "project code \($0)") },
                Self.name(client, in: path.replacingOccurrences(of: "-", with: " ")).map { (Self.nameInPath, "name \($0)") },
            ])
            best([
                Self.code(client, in: text).map { (Self.codeInText, "project code \($0)") },
                domain(textHosts).map { (Self.domainInText, "domain \($0)") },
                Self.name(client, in: text).map { (Self.nameInText, "name \($0)") },
            ])
            if total > 0, let reason = reasons.max(by: { $0.0 < $1.0 }) {
                scored.append(ClientMatch(client: client, reason: reason.1, score: total))
            }
        }

        let ranked = scored.sorted { $0.score > $1.score }
        guard let top = ranked.first, top.score >= Self.threshold else { return nil }
        if ranked.count > 1, top.score - ranked[1].score < Self.margin { return nil } // too close to call
        return top
    }

    // MARK: Signals

    static func host(_ host: String, matches domain: String) -> Bool {
        let host = host.lowercased(), domain = domain.lowercased()
        return host == domain || host.hasSuffix("." + domain)
    }

    private static let hostRegex = try! NSRegularExpression(pattern: #"(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b"#)

    static func hosts(in text: String) -> [String] {
        let range = NSRange(location: 0, length: (text as NSString).length)
        return hostRegex.matches(in: text, range: range).map { (text as NSString).substring(with: $0.range) }
    }

    /// The first project code found, e.g. "ACM-12" for the prefix "ACM-".
    static func code(_ client: Client, in text: String) -> String? {
        for code in client.projectCodes where !code.isEmpty {
            let escaped = NSRegularExpression.escapedPattern(for: code)
            let pattern = code.hasSuffix("-") ? #"(?<![A-Za-z0-9])"# + escaped + #"\d+\b"# : #"(?<![A-Za-z0-9])"# + escaped + #"(?![A-Za-z0-9])"#
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let found = regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length))
            else { continue }
            return (text as NSString).substring(with: found.range)
        }
        return nil
    }

    /// The name or alias found as whole words, ignoring case. Names under 3 characters are skipped.
    static func name(_ client: Client, in text: String) -> String? {
        for name in client.names where name.count >= 3 {
            let pattern = #"(?<![\p{L}\p{N}])"# + NSRegularExpression.escapedPattern(for: name) + #"(?![\p{L}\p{N}])"#
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            if regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil { return name }
        }
        return nil
    }
}
