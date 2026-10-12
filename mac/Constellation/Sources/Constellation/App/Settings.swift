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

    init() {
        captureOn = defaults.bool(forKey: Key.captureOn)
        pausedUntil = defaults.object(forKey: Key.pausedUntil) as? Date
        allowed = Set(defaults.stringArray(forKey: Key.allowed) ?? [])
        skipDomains = defaults.stringArray(forKey: Key.skipDomains) ?? ExclusionRules.defaultSkipDomains
        skipWords = defaults.stringArray(forKey: Key.skipWords) ?? []
        maskNames = defaults.bool(forKey: Key.maskNames)
        redactPrivateIPs = defaults.bool(forKey: Key.redactPrivateIPs)
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
