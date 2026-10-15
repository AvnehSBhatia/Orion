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
    /// Inactive clients stay in the list but are never matched.
    public var active: Bool
    public var updatedAt: String?
    /// Older backends removed clients with `deleted: true`; treated like inactive.
    public var deleted: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, aliases, domains, active, deleted
        case projectCodes = "project_codes"
        case updatedAt = "updated_at"
    }

    public init(id: String, name: String, aliases: [String] = [], domains: [String] = [], projectCodes: [String] = [],
                active: Bool = true, updatedAt: String? = nil, deleted: Bool = false) {
        self.id = id
        self.name = name
        self.aliases = aliases
        self.domains = domains
        self.projectCodes = projectCodes
        self.active = active
        self.updatedAt = updatedAt
        self.deleted = deleted
    }

    /// Every field but id and name is optional, so lists saved by older versions still load.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases) ?? []
        domains = try c.decodeIfPresent([String].self, forKey: .domains) ?? []
        projectCodes = try c.decodeIfPresent([String].self, forKey: .projectCodes) ?? []
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? true
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    }

    /// Name and aliases: what masking must leave readable.
    public var names: [String] { [name] + aliases }

    /// Can be matched to work blocks.
    public var matchable: Bool { active && !deleted }
}

/// A pattern that means one client, from the org or from the person's own draft
/// corrections. A strong signal: a page domain equal to the pattern, or a title containing it.
public struct AliasRule: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var pattern: String
    public var clientId: String

    enum CodingKeys: String, CodingKey {
        case id, pattern
        case clientId = "client_id"
    }

    public init(id: String, pattern: String, clientId: String) {
        self.id = id
        self.pattern = pattern
        self.clientId = clientId
    }
}

/// GET /v1/clients?since=<etag> response.
public struct ClientsResponse: Codable, Sendable, Equatable {
    public var clients: [Client]
    public var rules: [AliasRule]?
    /// Sent back as `since` next time (decision A).
    public var etag: String?

    public init(clients: [Client], rules: [AliasRule]? = nil, etag: String? = nil) {
        self.clients = clients
        self.rules = rules
        self.etag = etag
    }
}

/// The device's copy of the client list, saved encrypted in the store.
public struct ClientList: Codable, Sendable, Equatable {
    public var clients: [Client] = []
    public var rules: [AliasRule] = []
    /// The last `etag`; nil until the first sync.
    public var etag: String?
    public var syncedAt: Date?

    enum CodingKeys: String, CodingKey {
        case clients, rules, etag, syncedAt
        case legacySince = "since" // what older versions saved; ignored, so the next sync is a full one
    }

    public init(clients: [Client] = [], rules: [AliasRule] = [], etag: String? = nil, syncedAt: Date? = nil) {
        self.clients = clients
        self.rules = rules
        self.etag = etag
        self.syncedAt = syncedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clients = try c.decodeIfPresent([Client].self, forKey: .clients) ?? []
        rules = try c.decodeIfPresent([AliasRule].self, forKey: .rules) ?? []
        etag = try c.decodeIfPresent(String.self, forKey: .etag)
        syncedAt = try c.decodeIfPresent(Date.self, forKey: .syncedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(clients, forKey: .clients)
        try c.encode(rules, forKey: .rules)
        try c.encodeIfPresent(etag, forKey: .etag)
        try c.encodeIfPresent(syncedAt, forKey: .syncedAt)
    }

    /// What to send as `since`: nothing while the list is empty, so the server sends it all.
    public var cursor: String? { clients.isEmpty ? nil : etag }

    /// Apply a sync. A full answer (we sent no cursor) replaces everything; otherwise
    /// changed clients and rules replace their old copy by id.
    public mutating func merge(_ response: ClientsResponse, full: Bool, at date: Date = Date()) {
        var byId = full ? [:] : Dictionary(clients.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
        for client in response.clients { byId[client.id] = client }
        clients = byId.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        if let incoming = response.rules {
            var rulesById = full ? [:] : Dictionary(rules.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
            for rule in incoming { rulesById[rule.id] = rule }
            rules = rulesById.values.sorted { $0.id < $1.id }
        } else if full {
            rules = []
        }
        etag = response.etag ?? etag
        syncedAt = date
    }

    /// Clients that can be matched, for pickers.
    public var activeClients: [Client] { clients.filter(\.matchable) }
}

/// How a client was matched, sent as `match_method`.
public enum MatchMethod: String, Codable, Sendable {
    case domain, code, alias, manual, none
}

public struct ClientMatch: Sendable, Equatable {
    public var client: Client
    /// Why it matched, shown in the Outbox: "domain acme.com", "project code ACM-12", "name Acme".
    public var reason: String
    public var score: Int
    /// The strongest signal's kind. Names and client aliases count as `alias`.
    public var method: MatchMethod

    /// Decision B: min(score, 100) / 100.
    public var confidence: Double { Double(min(score, 100)) / 100 }
}

/// Scores each client against a block and picks one only if it clearly wins.
/// Patterns are compiled once per client list, and cheap substring checks run
/// before any regular expression, since every Outbox item is matched on each refresh.
public struct ClientMatcher: Sendable {
    public let clients: [Client]
    private let prepared: [Prepared]

    // Points per signal and place. Each place (title, browser address, text) counts
    // its strongest signal once, then the places add up.
    static let aliasRule = 120 // an org or personal alias rule: the strongest signal
    static let domainOfPage = 100 // the browser page is on the client's domain
    static let codeInTitle = 80, nameInTitle = 70, domainInTitle = 60
    static let codeInPath = 80, nameInPath = 40
    static let codeInText = 50, domainInText = 50, nameInText = 30
    /// A match needs at least this many points ...
    public static let threshold = 60
    /// ... and this many more than the next client, or it's too close to call.
    public static let margin = 25

    private struct Pattern: @unchecked Sendable { // NSRegularExpression is immutable and thread safe
        let literal: String
        let lowered: String // checked with a plain substring search on lowercased text before the regex runs
        let regex: NSRegularExpression
    }

    /// A text searched by many patterns: lowercased once, kept as NSString so the substring checks stay cheap.
    private struct Haystack {
        let text: NSString
        let lowered: NSString
        init(_ s: String) {
            text = s as NSString
            lowered = s.lowercased() as NSString
        }
    }

    private struct Prepared: Sendable {
        let client: Client
        let codes: [Pattern]
        let names: [Pattern]
        let rules: [String] // alias patterns, lowercased
    }

    public init(clients: [Client], rules: [AliasRule] = []) {
        let usable = clients.filter(\.matchable)
        self.clients = usable
        prepared = usable.map { client in
            Prepared(
                client: client,
                codes: client.projectCodes.filter { !$0.isEmpty }.compactMap { code in
                    let escaped = NSRegularExpression.escapedPattern(for: code)
                    let pattern = code.hasSuffix("-") ? #"(?<![A-Za-z0-9])"# + escaped + #"\d+\b"#
                        : #"(?<![A-Za-z0-9])"# + escaped + #"(?![A-Za-z0-9])"#
                    return (try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])).map { Pattern(literal: code, lowered: code.lowercased(), regex: $0) }
                },
                names: client.names.filter { $0.count >= 3 }.compactMap { name in
                    let pattern = #"(?<![\p{L}\p{N}])"# + NSRegularExpression.escapedPattern(for: name) + #"(?![\p{L}\p{N}])"#
                    return (try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])).map { Pattern(literal: name, lowered: name.lowercased(), regex: $0) }
                },
                rules: rules.filter { $0.clientId == client.id }.map { $0.pattern.trimmingCharacters(in: .whitespaces).lowercased() }
                    .filter { $0.count >= 3 }
            )
        }
    }

    public func match(title: String, domainPath: String?, text: String) -> ClientMatch? {
        let host = domainPath?.split(separator: "/").first.map { $0.lowercased() }
        let path = domainPath.map { String($0.dropFirst(host?.count ?? 0)) } ?? ""
        let pathWords = path.replacingOccurrences(of: "-", with: " ")
        let lowerTitle = title.lowercased()
        let titleHosts = Self.hosts(in: title)
        let textHosts = Self.hosts(in: text)
        let titleH = Haystack(title), pathH = Haystack(path), pathWordsH = Haystack(pathWords), textH = Haystack(text)

        var scored: [(ClientMatch)] = []
        for entry in prepared {
            let client = entry.client
            var total = 0
            var reasons: [(Int, String, MatchMethod)] = []
            func best(_ candidates: [(Int, String, MatchMethod)?]) {
                guard let top = candidates.compactMap({ $0 }).max(by: { $0.0 < $1.0 }) else { return }
                total += top.0
                reasons.append(top)
            }
            let domain = { (hosts: [String]) in client.domains.first { d in hosts.contains { Self.host($0, matches: d) } } }

            if let rule = entry.rules.first(where: { $0 == host || lowerTitle.contains($0) }) {
                best([(Self.aliasRule, "alias \(rule)", .alias)])
            }
            if let host, let d = domain([host]) { best([(Self.domainOfPage, "domain \(d)", .domain)]) }
            best([
                Self.first(entry.codes, in: titleH, returnMatch: true).map { (Self.codeInTitle, "project code \($0)", .code) },
                Self.first(entry.names, in: titleH).map { (Self.nameInTitle, "name \($0)", .alias) },
                domain(titleHosts).map { (Self.domainInTitle, "domain \($0)", .domain) },
            ])
            best([
                Self.first(entry.codes, in: pathH, returnMatch: true).map { (Self.codeInPath, "project code \($0)", .code) },
                Self.first(entry.names, in: pathWordsH).map { (Self.nameInPath, "name \($0)", .alias) },
            ])
            best([
                Self.first(entry.codes, in: textH, returnMatch: true).map { (Self.codeInText, "project code \($0)", .code) },
                domain(textHosts).map { (Self.domainInText, "domain \($0)", .domain) },
                Self.first(entry.names, in: textH).map { (Self.nameInText, "name \($0)", .alias) },
            ])
            if total > 0, let reason = reasons.max(by: { $0.0 < $1.0 }) {
                scored.append(ClientMatch(client: client, reason: reason.1, score: total, method: reason.2))
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
        guard text.contains(".") else { return [] }
        let range = NSRange(location: 0, length: (text as NSString).length)
        return hostRegex.matches(in: text, range: range).map { (text as NSString).substring(with: $0.range) }
    }

    /// The first pattern found: the matched text for codes ("ACM-12" for "ACM-"), the name for names.
    private static func first(_ patterns: [Pattern], in text: Haystack, returnMatch: Bool = false) -> String? {
        guard text.text.length > 0 else { return nil }
        for pattern in patterns where text.lowered.range(of: pattern.lowered, options: .literal).location != NSNotFound {
            let range = NSRange(location: 0, length: text.text.length)
            guard let found = pattern.regex.firstMatch(in: text.text as String, range: range) else { continue }
            return returnMatch ? text.text.substring(with: found.range) : pattern.literal
        }
        return nil
    }

    /// The first project code found, e.g. "ACM-12" for the prefix "ACM-". For tests.
    static func code(_ client: Client, in text: String) -> String? {
        ClientMatcher(clients: [client]).prepared.first.flatMap { first($0.codes, in: Haystack(text), returnMatch: true) }
    }

    /// The name or alias found as whole words, ignoring case. For tests.
    static func name(_ client: Client, in text: String) -> String? {
        ClientMatcher(clients: [client]).prepared.first.flatMap { first($0.names, in: Haystack(text)) }
    }
}
