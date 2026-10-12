import ApplicationServices
import Foundation

/// Accessibility notifications from the front app (spec 5.2). Only created for
/// apps the user turned on, and only while they are in front. The callback just
/// reports the kind of event; reading happens elsewhere, off the main thread.
@MainActor final class AppObserver {
    enum Event {
        case focusedWindowChanged
        case titleChanged
        case contentChanged
    }

    private static let notifications: [(String, Event)] = [
        (kAXFocusedWindowChangedNotification, .focusedWindowChanged),
        (kAXMainWindowChangedNotification, .focusedWindowChanged),
        (kAXTitleChangedNotification, .titleChanged),
        (kAXValueChangedNotification, .contentChanged),
        (kAXSelectedTextChangedNotification, .contentChanged),
        (kAXLayoutChangedNotification, .contentChanged),
    ]

    let pid: pid_t
    private let app: AXUIElement
    private let onEvent: (Event) -> Void
    private var observer: AXObserver?

    init(pid: pid_t, onEvent: @escaping (Event) -> Void) {
        self.pid = pid
        self.app = AXUIElementCreateApplication(pid)
        self.onEvent = onEvent
        AXUIElementSetMessagingTimeout(app, 0.25)
    }

    func start() {
        var created: AXObserver?
        guard AXObserverCreate(pid, appObserverCallback, &created) == .success, let created else { return }
        observer = created
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for (name, _) in Self.notifications {
            AXObserverAddNotification(created, app, name as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .defaultMode)
    }

    func stop() {
        guard let observer else { return }
        for (name, _) in Self.notifications {
            AXObserverRemoveNotification(observer, app, name as CFString)
        }
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        self.observer = nil
    }

    fileprivate func handle(_ notification: String) {
        guard let event = Self.notifications.first(where: { $0.0 == notification })?.1 else { return }
        onEvent(event)
    }
}

/// Runs on the main run loop, where the observer's source was added.
private func appObserverCallback(
    _ observer: AXObserver, _ element: AXUIElement, _ notification: CFString, _ refcon: UnsafeMutableRawPointer?
) {
    guard let refcon else { return }
    let name = notification as String
    let appObserver = Unmanaged<AppObserver>.fromOpaque(refcon).takeUnretainedValue()
    MainActor.assumeIsolated { appObserver.handle(name) }
}
