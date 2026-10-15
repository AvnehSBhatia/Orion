import Foundation

// The org's capture policy (GET /v1/policy) and monitoring notice (POST /v1/consent).
// Polled on connect and every 5 minutes. The last good copy is kept, so an outage
// never lifts the org's exclusions or its pause.

public struct OrgPolicy: Codable, Sendable, Equatable {
    public struct Consent: Codable, Sendable, Equatable {
        public var required: Bool
        public var version: Int
        /// Markdown of the org's monitoring notice.
        public var notice: String

        public init(required: Bool = false, version: Int = 0, notice: String = "") {
            self.required = required
            self.version = version
            self.notice = notice
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            required = (try? c.decodeIfPresent(Bool.self, forKey: .required)) == true
            version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 0
            notice = (try? c.decodeIfPresent(String.self, forKey: .notice)) ?? ""
        }
    }

    /// False: the company paused capture for everyone.
    public var captureEnabled: Bool
    /// Added to the person's own skip list (domain and subdomains).
    public var excludedHosts: [String]
    /// The shortest gap between content-change reads of one window, in seconds.
    public var captureIntervalSec: Int
    /// The company allows reading page text in browsers (the person must turn it on too).
    public var browserPageText: Bool
    public var consent: Consent

    public static let intervalRange = 5...3_600

    enum CodingKeys: String, CodingKey {
        case consent
        case captureEnabled = "capture_enabled"
        case excludedHosts = "excluded_hosts"
        case captureIntervalSec = "capture_interval_sec"
        case browserPageText = "browser_page_text"
    }

    public init(captureEnabled: Bool = true, excludedHosts: [String] = [], captureIntervalSec: Int = 5,
                browserPageText: Bool = false, consent: Consent = Consent()) {
        self.captureEnabled = captureEnabled
        self.excludedHosts = excludedHosts
        self.captureIntervalSec = captureIntervalSec
        self.browserPageText = browserPageText
        self.consent = consent
    }

    /// Read defensively: a missing or malformed field falls back to its default,
    /// except that anything but an explicit `true` keeps page text off.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        captureEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .captureEnabled)) != false
        excludedHosts = ((try? c.decodeIfPresent([String].self, forKey: .excludedHosts)) ?? [])
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        let interval = (try? c.decodeIfPresent(Int.self, forKey: .captureIntervalSec)) ?? 5
        captureIntervalSec = min(max(interval, Self.intervalRange.lowerBound), Self.intervalRange.upperBound)
        browserPageText = (try? c.decodeIfPresent(Bool.self, forKey: .browserPageText)) == true
        consent = (try? c.decodeIfPresent(Consent.self, forKey: .consent)) ?? Consent()
    }

    /// Whether the notice still has to be accepted, given the version the person accepted.
    public func needsConsent(accepted: Int?) -> Bool {
        consent.required && (accepted ?? -1) < consent.version
    }
}

/// POST /v1/consent reply.
public struct ConsentResponse: Codable, Sendable, Equatable {
    public var acceptedAt: String?

    enum CodingKeys: String, CodingKey {
        case acceptedAt = "accepted_at"
    }
}

/// DELETE /v1/me/data reply (202).
public struct DeleteResponse: Codable, Sendable, Equatable {
    public var requestId: String?

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
    }
}

/// The name sent at registration: the Mac's model, never the computer or user name.
public enum DeviceName {
    /// "MacBookPro18,3" → "MacBook Pro". Newer models report only "Mac15,3", which says nothing: "Mac".
    public static func friendly(hwModel: String?) -> String {
        guard let model = hwModel?.trimmingCharacters(in: .whitespaces), !model.isEmpty else { return "Mac" }
        let family = model.prefix { !$0.isNumber && $0 != "," }
        return switch family {
        case "MacBookPro": "MacBook Pro"
        case "MacBookAir": "MacBook Air"
        case "MacBook": "MacBook"
        case "Macmini": "Mac mini"
        case "MacPro": "Mac Pro"
        case "iMac": "iMac"
        case "iMacPro": "iMac Pro"
        default: "Mac"
        }
    }

    /// From sysctl hw.model.
    public static func current() -> String {
        var size = 0
        guard sysctlbyname("hw.model", nil, &size, nil, 0) == 0, size > 0 else { return "Mac" }
        var bytes = [CChar](repeating: 0, count: size)
        guard sysctlbyname("hw.model", &bytes, &size, nil, 0) == 0 else { return "Mac" }
        return friendly(hwModel: String(cString: bytes))
    }
}
