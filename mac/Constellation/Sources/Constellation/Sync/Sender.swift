import CaptureCore
import Foundation

/// Sends approved Outbox items to the backend (POST /v1/work-blocks). Only
/// approved items are ever sent. Connecting registers this Mac once
/// (POST /v1/devices/register); the device token lives in the Keychain.
@MainActor final class Sender: ObservableObject {
    enum State: Equatable {
        case notConnected
        case connecting
        case connected
        case sending
        case failed(String)
    }

    @Published private(set) var state: State
    @Published private(set) var lastSentAt: Date?
    @Published private(set) var lastSentCount = 0
    @Published private(set) var destination: String?

    var outbox: OutboxModel?

    private let settings: Settings
    private let store: RecordStore?
    private var credentials: DeviceCredentials?
    private var timer: Timer?
    private var inFlight = false
    private var failures = 0
    private var nextAttempt = Date.distantPast

    static let checkSeconds: TimeInterval = 60
    static let maxBackoffSeconds: TimeInterval = 900

    init(settings: Settings, store: RecordStore?) {
        self.settings = settings
        self.store = store
        credentials = DeviceCredentials.load()
        state = credentials == nil ? .notConnected : .connected
        destination = credentials == nil ? nil : client?.destination
    }

    var isConnected: Bool { credentials != nil }

    private var client: BackendClient? {
        (try? BackendClient.validatedURL(settings.backendURL)).map { BackendClient(baseURL: $0) }
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkSeconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        tick()
    }

    /// Register this Mac with the backend at `urlText`.
    func connect(urlText: String, enrollmentCode: String) async {
        let url: URL
        do {
            url = try BackendClient.validatedURL(urlText)
        } catch {
            state = .failed(error.localizedDescription)
            return
        }
        state = .connecting
        let client = BackendClient(baseURL: url)
        let registration = DeviceRegistration(
            installId: settings.installId, platform: "macOS",
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString, appVersion: Self.appVersion,
            enrollmentCode: enrollmentCode.isEmpty ? nil : enrollmentCode
        )
        do {
            let credentials = try await client.register(registration)
            try credentials.save()
            settings.backendURL = url.absoluteString
            self.credentials = credentials
            destination = client.destination
            state = .connected
            sendNow()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Forget the device token. Approved items stay and wait.
    func disconnect() {
        try? DeviceCredentials.forget()
        credentials = nil
        destination = nil
        state = .notConnected
    }

    /// Send right away, skipping any wait after a failure.
    func sendNow() {
        failures = 0
        nextAttempt = .distantPast
        Task { await sendApproved() }
    }

    private func tick() {
        guard Date() >= nextAttempt else { return }
        Task { await sendApproved() }
    }

    private func sendApproved() async {
        guard !inFlight, let credentials, let client, let store else { return }
        let items = (try? store.outbox([.approved], limit: BackendClient.batchLimit, oldestFirst: true)) ?? []
        guard !items.isEmpty else { return }

        inFlight = true
        state = .sending
        defer { inFlight = false }
        do {
            let response = try await client.postWorkBlocks(items.map(\.payload), credentials: credentials)
            let accepted = Set(response.accepted)
            let sent = items.filter { accepted.contains($0.id.uuidString) }.map(\.id)
            try store.markSent(sent, destination: client.destination)
            lastSentAt = Date()
            lastSentCount = sent.count
            failures = 0
            nextAttempt = .distantPast
            state = .connected
            outbox?.refresh()
            // A full batch means more may be waiting.
            if items.count == BackendClient.batchLimit, !sent.isEmpty { Task { await sendApproved() } }
        } catch BackendError.unauthorized {
            disconnect()
            state = .failed(BackendError.unauthorized.localizedDescription)
        } catch {
            // Wait longer after each failure: 30 s, 1 min, 2 min, ... up to 15 min.
            failures += 1
            let wait = min(30 * pow(2, Double(failures - 1)), Self.maxBackoffSeconds)
            nextAttempt = Date().addingTimeInterval(wait)
            state = .failed("\(error.localizedDescription) Trying again in \(Int(wait / 60) > 0 ? "\(Int(wait / 60)) min" : "\(Int(wait)) s").")
        }
    }

    static let appVersion = "0.6.0-dev"
}
