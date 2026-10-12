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
        static let maskNames = "maskNames"
        static let redactPrivateIPs = "redactPrivateIPs"
        static let onboardingDone = "onboardingDone"
        static let outboxMode = "outboxMode"
        static let autoApprove = "autoApprove"
        static let backendURL = "backendURL"
        static let installId = "installId"
    }

    private let defaults = UserDefaults(suiteName: "com.traxrobotics.constellation") ?? .standard

    /// Off until the user turns it on.
    @Published var captureOn: Bool { didSet { defaults.set(captureOn, forKey: Key.captureOn) } }
    @Published var pausedUntil: Date? { didSet { defaults.set(pausedUntil, forKey: Key.pausedUntil) } }
    /// Apps the user turned on. New apps start off (spec 2.2).
    @Published var allowed: Set<String> { didSet { defaults.set(allowed.sorted(), forKey: Key.allowed) } }
    @Published var skipDomains: [String] { didSet { defaults.set(skipDomains, forKey: Key.skipDomains) } }
    @Published var skipWords: [String] { didSet { defaults.set(skipWords, forKey: Key.skipWords) } }
    /// Replace people's names with [Person 1], [Person 2]. Off by default (spec 8).
    @Published var maskNames: Bool { didSet { defaults.set(maskNames, forKey: Key.maskNames) } }
    @Published var redactPrivateIPs: Bool { didSet { defaults.set(redactPrivateIPs, forKey: Key.redactPrivateIPs) } }
    /// The welcome screens have been seen (M4).
    @Published var onboardingDone: Bool { didSet { defaults.set(onboardingDone, forKey: Key.onboardingDone) } }
    /// Outbox (spec 9): Review first by default.
    @Published var outboxMode: OutboxMode { didSet { defaults.set(outboxMode.rawValue, forKey: Key.outboxMode) } }
    /// Review first only: approve automatically after Limits.autoApproveMinutes. On by default.
    @Published var autoApprove: Bool { didSet { defaults.set(autoApprove, forKey: Key.autoApprove) } }
    /// Where approved items are sent. The local mock backend until the real one exists.
    @Published var backendURL: String { didSet { defaults.set(backendURL, forKey: Key.backendURL) } }
    /// A random id for this install, sent at registration instead of the computer or user name.
    let installId: String

    init() {
        captureOn = defaults.bool(forKey: Key.captureOn)
        pausedUntil = defaults.object(forKey: Key.pausedUntil) as? Date
        allowed = Set(defaults.stringArray(forKey: Key.allowed) ?? [])
        skipDomains = defaults.stringArray(forKey: Key.skipDomains) ?? ExclusionRules.defaultSkipDomains
        skipWords = defaults.stringArray(forKey: Key.skipWords) ?? []
        maskNames = defaults.bool(forKey: Key.maskNames)
        redactPrivateIPs = defaults.bool(forKey: Key.redactPrivateIPs)
        onboardingDone = defaults.bool(forKey: Key.onboardingDone)
        outboxMode = defaults.string(forKey: Key.outboxMode).flatMap(OutboxMode.init(rawValue:)) ?? .reviewFirst
        autoApprove = defaults.object(forKey: Key.autoApprove) as? Bool ?? true
        backendURL = defaults.string(forKey: Key.backendURL) ?? "http://localhost:8787"
        if let existing = defaults.string(forKey: Key.installId) {
            installId = existing
        } else {
            installId = UUID().uuidString
            defaults.set(installId, forKey: Key.installId)
        }
    }

    var rules: ExclusionRules { ExclusionRules(skipDomains: skipDomains, skipWords: skipWords) }

    var redaction: RedactionOptions { RedactionOptions(maskNames: maskNames, redactPrivateIPs: redactPrivateIPs) }

    var isPaused: Bool {
        guard let pausedUntil else { return false }
        return pausedUntil > Date()
    }

    var state: CaptureState {
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
