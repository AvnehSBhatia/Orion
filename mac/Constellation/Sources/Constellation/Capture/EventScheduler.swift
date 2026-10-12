import Foundation

/// Delays and throttles for capture triggers, keyed by purpose (spec 5.2).
@MainActor final class EventScheduler {
    private var tasks: [String: Task<Void, Never>] = [:]
    private var lastRun: [String: Date] = [:]

    /// Run once after `delay`, replacing anything already waiting under this key.
    func schedule(_ key: String, after delay: TimeInterval, _ action: @escaping @MainActor () -> Void) {
        tasks[key]?.cancel()
        tasks[key] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.tasks[key] = nil
            action()
        }
    }

    /// At most once per `interval` per key. Events inside the window fold into
    /// one run at its end, so the latest content is still captured.
    func throttle(_ key: String, every interval: TimeInterval, _ action: @escaping @MainActor () -> Void) {
        guard tasks[key] == nil else { return }
        let since = lastRun[key].map { Date().timeIntervalSince($0) } ?? .infinity
        let delay = max(0, interval - since)
        tasks[key] = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
            }
            self?.tasks[key] = nil
            self?.lastRun[key] = Date()
            action()
        }
    }

    /// Another trigger captured this key's window, so the throttle window restarts.
    func noteRan(_ key: String) { lastRun[key] = Date() }

    func cancelAll() {
        tasks.values.forEach { $0.cancel() }
        tasks = [:]
    }
}
