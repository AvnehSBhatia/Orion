import CaptureCore
import Foundation

enum CaptureState: Equatable {
    case on
    case paused(until: Date)
    case off
}

/// User choices, kept in UserDefaults. Holds bundle ids and rules only, never captured text.
@MainActor final class Settings: ObservableObject {
    private enum Key {
        static let captureOn = "captureOn"
        static let pausedUntil = "pausedUntil"
        static let allowed = "allowedBundleIds"
        static let skipDomains = "skipDomains"
        static let skipWords = "skipWords"
        static let redactEmails = "redactEmails"
        static let keepEmailDomain = "keepEmailDomain"
        static let redactPhones = "redactPhones"
        static let redactAddresses = "redactAddresses"
        static let maskNames = "maskNames"
        static let redactPrivateIPs = "redactPrivateIPs"
        static let onboardingDone = "onboardingDone"
        static let guideDismissed = "guideDismissed"
        static let outboxMode = "outboxMode"
        static let autoApprove = "autoApprove"
        static let backendURL = "backendURL"
        static let installId = "installId"
        static let consentVersion = "consentVersion"
        static let browserPageText = "browserPageText"
        static let granolaNotes = "granolaNotes"
        static let policy = "orgPolicy"
    }

    private let defaults = UserDefaults(suiteName: "com.traxrobotics.constellation") ?? .standard

    /// Off until the user turns it on.
    @Published var captureOn: Bool { didSet { defaults.set(captureOn, forKey: Key.captureOn) } }
    @Published var pausedUntil: Date? { didSet { defaults.set(pausedUntil, forKey: Key.pausedUntil) } }
    /// Apps the user turned on. New apps start off (spec 2.2).
    @Published var allowed: Set<String> { didSet { defaults.set(allowed.sorted(), forKey: Key.allowed) } }
    @Published var skipDomains: [String] { didSet { defaults.set(skipDomains, forKey: Key.skipDomains) } }
    @Published var skipWords: [String] { didSet { defaults.set(skipWords, forKey: Key.skipWords) } }
    // Redaction choices: the person's own, with no company override.
    @Published var redactEmails: Bool { didSet { defaults.set(redactEmails, forKey: Key.redactEmails) } }
    @Published var keepEmailDomain: Bool { didSet { defaults.set(keepEmailDomain, forKey: Key.keepEmailDomain) } }
    @Published var redactPhones: Bool { didSet { defaults.set(redactPhones, forKey: Key.redactPhones) } }
    @Published var redactAddresses: Bool { didSet { defaults.set(redactAddresses, forKey: Key.redactAddresses) } }
    /// Replace people's names with [Person 1], [Person 2]. Off by default (spec 8).
    @Published var maskNames: Bool { didSet { defaults.set(maskNames, forKey: Key.maskNames) } }
    @Published var redactPrivateIPs: Bool { didSet { defaults.set(redactPrivateIPs, forKey: Key.redactPrivateIPs) } }
    /// The welcome screens have been seen (M4).
    @Published var onboardingDone: Bool { didSet { defaults.set(onboardingDone, forKey: Key.onboardingDone) } }
    /// The in-window setup path was hidden. Missing means it still shows.
    @Published var guideDismissed: Bool { didSet { defaults.set(guideDismissed, forKey: Key.guideDismissed) } }
    /// Outbox (spec 9): Review first by default.
    @Published var outboxMode: OutboxMode { didSet { defaults.set(outboxMode.rawValue, forKey: Key.outboxMode) } }
    /// Review first only: approve automatically after Limits.autoApproveMinutes. On by default.
    @Published var autoApprove: Bool { didSet { defaults.set(autoApprove, forKey: Key.autoApprove) } }
    /// Where approved items are sent. The local mock backend until the real one exists.
    @Published var backendURL: String { didSet { defaults.set(backendURL, forKey: Key.backendURL) } }
    /// The notice version this person accepted (nil: none yet).
    @Published var consentVersion: Int? { didSet { defaults.set(consentVersion, forKey: Key.consentVersion) } }
    /// Personal switch for reading page text in browsers. Off by default, and does nothing
    /// unless the company's policy allows it too.
    @Published var browserPageText: Bool { didSet { defaults.set(browserPageText, forKey: Key.browserPageText) } }
    /// Import finished Granola notes (never the recording or transcript). Off until the person turns it on.
    @Published var granolaNotes: Bool { didSet { defaults.set(granolaNotes, forKey: Key.granolaNotes) } }
    /// The company's last policy. Kept, so an outage never lifts its exclusions or its pause.
    @Published var policy: OrgPolicy {
        didSet { defaults.set(try? JSONEncoder().encode(policy), forKey: Key.policy) }
    }
    /// A random id for this install, sent at registration instead of the computer or user name.
    let installId: String

    init() {
        captureOn = defaults.bool(forKey: Key.captureOn)
        pausedUntil = defaults.object(forKey: Key.pausedUntil) as? Date
        allowed = Set(defaults.stringArray(forKey: Key.allowed) ?? [])
        skipDomains = defaults.stringArray(forKey: Key.skipDomains) ?? ExclusionRules.defaultSkipDomains
        skipWords = defaults.stringArray(forKey: Key.skipWords) ?? []
        redactEmails = defaults.object(forKey: Key.redactEmails) as? Bool ?? true
        keepEmailDomain = defaults.bool(forKey: Key.keepEmailDomain)
        redactPhones = defaults.object(forKey: Key.redactPhones) as? Bool ?? true
        redactAddresses = defaults.object(forKey: Key.redactAddresses) as? Bool ?? true
        maskNames = defaults.bool(forKey: Key.maskNames)
        redactPrivateIPs = defaults.bool(forKey: Key.redactPrivateIPs)
        onboardingDone = defaults.bool(forKey: Key.onboardingDone)
        guideDismissed = defaults.bool(forKey: Key.guideDismissed)
        outboxMode = defaults.string(forKey: Key.outboxMode).flatMap(OutboxMode.init(rawValue:)) ?? .reviewFirst
        autoApprove = defaults.object(forKey: Key.autoApprove) as? Bool ?? true
        backendURL = defaults.string(forKey: Key.backendURL) ?? "http://localhost:8787"
        consentVersion = defaults.object(forKey: Key.consentVersion) as? Int
        browserPageText = defaults.bool(forKey: Key.browserPageText)
        granolaNotes = defaults.bool(forKey: Key.granolaNotes)
        policy = defaults.data(forKey: Key.policy).flatMap { try? JSONDecoder().decode(OrgPolicy.self, from: $0) } ?? OrgPolicy()
        if let existing = defaults.string(forKey: Key.installId) {
            installId = existing
        } else {
            installId = UUID().uuidString
            defaults.set(installId, forKey: Key.installId)
        }
    }

    /// The person's own skip list plus the company's excluded hosts.
    var rules: ExclusionRules {
        ExclusionRules(skipDomains: skipDomains + policy.excludedHosts.filter { !skipDomains.contains($0) }, skipWords: skipWords)
    }

    /// Browser page text is read only when the company allows it and the person turned it on.
    var readsBrowserPageText: Bool { policy.browserPageText && browserPageText }

    /// Work blocks wait for the person to accept the company's notice.
    var consentPending: Bool { policy.needsConsent(accepted: consentVersion) }

    var redaction: RedactionOptions {
        RedactionOptions(
            redactEmails: redactEmails, keepEmailDomain: keepEmailDomain, redactPhones: redactPhones,
            redactAddresses: redactAddresses, maskNames: maskNames, redactPrivateIPs: redactPrivateIPs
        )
    }

    var isPaused: Bool {
        guard let pausedUntil else { return false }
        return pausedUntil > Date()
    }

    var state: CaptureState {
        if !policy.captureEnabled { return .off }
        if !captureOn { return .off }
        if let pausedUntil, isPaused { return .paused(until: pausedUntil) }
        return .on
    }

    func pause(for seconds: TimeInterval) { pausedUntil = Date().addingTimeInterval(seconds) }

    func pauseUntilTomorrow() {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date()))
        pausedUntil = tomorrow.flatMap { calendar.date(bySettingHour: 8, minute: 0, second: 0, of: $0) }
    }

    func resume() { pausedUntil = nil }

    func setAllowed(_ bundleId: String, _ on: Bool) {
        guard !ExclusionRules.isBlocked(bundleId: bundleId) else { return }
        if on { allowed.insert(bundleId) } else { allowed.remove(bundleId) }
    }
}
