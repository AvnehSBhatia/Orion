import AppKit

/// Never capture while the screen is locked, the screensaver runs, or the display
/// or Mac is asleep (spec 5.2).
@MainActor final class SystemState {
    private(set) var locked = false
    private(set) var screensaver = false
    private(set) var displayAsleep = false
    private(set) var systemAsleep = false
    var onChange: (() -> Void)?
    private var tokens: [(NotificationCenter, NSObjectProtocol)] = []

    var isAvailable: Bool { !(locked || screensaver || displayAsleep || systemAsleep) }

    init() {
        locked = Self.sessionLocked()
        let distributed = DistributedNotificationCenter.default()
        let workspace = NSWorkspace.shared.notificationCenter
        observe(distributed, "com.apple.screenIsLocked") { $0.locked = true }
        observe(distributed, "com.apple.screenIsUnlocked") { $0.locked = false }
        observe(distributed, "com.apple.screensaver.didstart") { $0.screensaver = true }
        observe(distributed, "com.apple.screensaver.didstop") { $0.screensaver = false }
        observe(workspace, NSWorkspace.screensDidSleepNotification.rawValue) { $0.displayAsleep = true }
        observe(workspace, NSWorkspace.screensDidWakeNotification.rawValue) { $0.displayAsleep = false }
        observe(workspace, NSWorkspace.willSleepNotification.rawValue) { $0.systemAsleep = true }
        observe(workspace, NSWorkspace.didWakeNotification.rawValue) { $0.systemAsleep = false }
    }

    private func observe(_ center: NotificationCenter, _ name: String, _ update: @escaping @Sendable @MainActor (SystemState) -> Void) {
        let token = center.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                update(self)
                self.onChange?()
            }
        }
        tokens.append((center, token))
    }

    private static func sessionLocked() -> Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return session["CGSSessionScreenIsLocked"] as? Bool ?? false
    }
}
