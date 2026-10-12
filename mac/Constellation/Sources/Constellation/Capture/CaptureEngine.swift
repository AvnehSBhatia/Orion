import AppKit
import CaptureCore
import Combine

/// What the menu bar shows.
struct CaptureStatus: Equatable {
    var state: CaptureState = .off
    var systemAvailable = true
    var trusted = false
}

/// Event driven capture (spec 5): watches the front app, and when it is one the
/// user turned on, reads its focused window off the main thread on app switches,
/// window and title changes, content changes (throttled), and returns from idle.
/// Snapshots go to the segmenter, which keeps records in memory only in M1.
@MainActor final class CaptureEngine: ObservableObject {
    let settings: Settings
    let stats: DebugStats
    /// Encrypted local store (M3). Nil if it could not be opened; records then stay in memory only.
    let store: RecordStore?
    private let system = SystemState()
    private let scheduler = EventScheduler()
    private(set) var segmenter = Segmenter()
    let names = NameMasker() // stable [Person N] tokens for this session; the Outbox uses it for edits
    /// Refreshed when records move into the Outbox.
    var outbox: OutboxModel?
    var directory: ClientDirectory?
    private var outboxTimer: Timer?
    @Published private(set) var status = CaptureStatus()

    private var front: NSRunningApplication?
    private var observer: AppObserver?
    private var reading = false
    private var pending: Trigger?
    private var lastTitle: [pid_t: String] = [:]
    private var wasIdle = false
    private var timer: Timer?
    private var tokens: [NSObjectProtocol] = []
    private var settingsSink: AnyCancellable?
    private var retentionTimer: Timer?

    init(settings: Settings, stats: DebugStats, store: RecordStore?) {
        self.settings = settings
        self.stats = stats
        self.store = store
    }

    func start() {
        let token = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.processIdentifier
            MainActor.assumeIsolated { self?.frontAppChanged(pid.flatMap(NSRunningApplication.init(processIdentifier:))) }
        }
        tokens.append(token)
        system.onChange = { [weak self] in self?.reattach() }
        settingsSink = settings.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in MainActor.assumeIsolated { self?.reattach() } }
        timer = Timer.scheduledTimer(withTimeInterval: Limits.idleCheckSeconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        retentionTimer = Timer.scheduledTimer(withTimeInterval: Limits.retentionCheckSeconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyRetention() }
        }
        applyRetention()
        // Anything still open from the last session is finished: move it to the Outbox.
        store?.closeOpen(except: nil, endedBefore: nil, approve: settings.outboxMode == .logOnly)
        outboxTimer = Timer.scheduledTimer(withTimeInterval: Limits.outboxCheckSeconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkOutbox() }
        }
        checkOutbox()
        stats.updateStore(store?.totals(), storeAvailable: store != nil)
        reattach()
    }

    /// Close records idle past the gap, auto approve what has waited long enough,
    /// and refresh the Outbox window.
    private func checkOutbox() {
        guard let store else { return }
        store.closeOpen(
            except: segmenter.current?.id, endedBefore: Date().addingTimeInterval(-Limits.idleGapSeconds),
            approve: settings.outboxMode == .logOnly
        )
        if settings.outboxMode == .reviewFirst, settings.autoApprove {
            _ = try? store.autoApprove(queuedBefore: Date().addingTimeInterval(-Double(Limits.autoApproveMinutes) * 60))
        }
        outbox?.refresh()
        // The sender checks for approved items on its own timer.
    }

    /// Delete all (spec 2.7): every record in memory and on disk, the store's key, and every counter.
    func deleteAll() {
        segmenter.clear()
        names.reset()
        Redactor.clearCache()
        directory?.reset()
        stats.clear()
        do { try store?.deleteAll() } catch { print("Constellation store: delete all failed (\(error))") }
        stats.updateStore(store?.totals(), storeAvailable: store != nil)
        outbox?.refresh()
    }

    /// Clear captured text from stored records older than the retention period.
    private func applyRetention() {
        guard let store else { return }
        let cutoff = Date().addingTimeInterval(-Double(Limits.rawTextRetentionDays) * 86_400)
        Task.detached { _ = try? store.purgeText(endedBefore: cutoff) }
    }

    // MARK: Front app

    /// Re-evaluate the front app after any change to settings, permission, or system state.
    private func reattach() {
        frontAppChanged(NSWorkspace.shared.frontmostApplication)
    }

    private func frontAppChanged(_ app: NSRunningApplication?) {
        scheduler.cancelAll()
        observer?.stop()
        observer = nil
        front = app
        refreshStatus()
        guard let app, gate(app) == nil else { return }

        let observer = AppObserver(pid: app.processIdentifier) { [weak self] event in self?.handle(event) }
        observer.start()
        self.observer = observer
        capture(.appSwitch)
        scheduleReread()
    }

    private func handle(_ event: AppObserver.Event) {
        guard let pid = front?.processIdentifier else { return }
        switch event {
        case .focusedWindowChanged:
            capture(.windowChange)
            scheduleReread()
        case .titleChanged:
            // Rapid title changes fold into one capture.
            scheduler.schedule("title", after: Limits.debounce(Limits.titleDebounceSeconds)) { [weak self] in
                self?.capture(.titleChange)
            }
        case .contentChanged:
            scheduler.throttle(contentKey(pid), every: Limits.debounce(Limits.contentDebounceSeconds)) { [weak self] in
                self?.capture(.contentChange)
            }
        }
    }

    /// M0 showed the first read after a switch can be partial, so read again shortly after.
    private func scheduleReread() {
        scheduler.schedule("reread", after: Limits.debounce(Limits.rereadAfterSwitchSeconds)) { [weak self] in
            self?.capture(.reread)
        }
    }

    /// Content changes are throttled per window; the window is known by its last title.
    private func contentKey(_ pid: pid_t) -> String {
        "content|\(pid)|\(lastTitle[pid] ?? "")"
    }

    // MARK: Capture

    private func gate(_ app: NSRunningApplication) -> SkipReason? {
        CaptureGate.check(
            captureOn: settings.captureOn, paused: settings.isPaused, systemAvailable: system.isAvailable,
            trusted: AXIsProcessTrusted(), bundleId: app.bundleIdentifier ?? "", allowed: settings.allowed
        )
    }

    private func capture(_ trigger: Trigger) {
        guard let app = front, let bundleId = app.bundleIdentifier, gate(app) == nil else { return }
        if reading {
            pending = trigger // one read at a time; the latest trigger runs next
            return
        }
        reading = true
        let request = CaptureRequest(
            pid: app.processIdentifier, bundleId: bundleId, appName: app.localizedName ?? bundleId,
            isBrowser: AppInfo.isBrowser(bundleId),
            turnOnElectronTree: AppInfo.kind(bundleId: bundleId, bundleURL: app.bundleURL) == .electron,
            rules: settings.rules,
            redaction: settings.redaction,
            names: names
        )
        Task { [weak self] in
            let snapshot = await WindowCapture.read(request) // off the main thread
            self?.finish(snapshot, trigger: trigger, pid: request.pid)
        }
    }

    private func finish(_ snapshot: Snapshot, trigger: Trigger, pid: pid_t) {
        reading = false
        // Throw it away if capture stopped or the app changed while reading.
        if let app = front, app.processIdentifier == pid, gate(app) == nil {
            stats.record(snapshot, trigger: trigger)
            if snapshot.skip == nil, snapshot.foundWindow {
                lastTitle[pid] = snapshot.windowTitle
                scheduler.noteRan(contentKey(pid))
                let outcome = segmenter.ingest(snapshot)
                if let record = segmenter.current {
                    store?.save(record) // encrypted, in the background
                }
                if outcome == .newRecord {
                    // The previous record is finished: it moves to the Outbox.
                    store?.closeOpen(except: segmenter.current?.id, endedBefore: nil, approve: settings.outboxMode == .logOnly)
                    outbox?.refresh()
                }
                stats.updateStore(store?.totals(), storeAvailable: store != nil, inMemory: segmenter)
            }
        }
        if let next = pending {
            pending = nil
            capture(next)
        }
    }

    // MARK: Timer: idle, pause expiry, permission

    private func tick() {
        if let pausedUntil = settings.pausedUntil, pausedUntil <= Date() {
            settings.resume() // triggers reattach through the settings sink
        }
        if AXIsProcessTrusted() != status.trusted { reattach() }

        // Idle is read as a single number (seconds since any input), not by watching input.
        let anyInput = CGEventType(rawValue: ~0)!
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        if idle >= Limits.idleThresholdSeconds {
            wasIdle = true
        } else if wasIdle {
            wasIdle = false
            capture(.idleReturn)
        }
    }

    private func refreshStatus() {
        status = CaptureStatus(state: settings.state, systemAvailable: system.isAvailable, trusted: AXIsProcessTrusted())
    }
}
