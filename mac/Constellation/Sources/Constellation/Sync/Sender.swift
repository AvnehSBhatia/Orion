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

    @Published private(set) var policyError: String?
    @Published private(set) var consentBusy = false
    /// Set after a failed or skipped remote delete, for the person to read.
    @Published var deleteNotice: String?

    var outbox: OutboxModel?
    let directory: ClientDirectory

    private let settings: Settings
    private let store: RecordStore?
    private var credentials: DeviceCredentials?
    private var timer: Timer?
    private var inFlight = false
    private var failures = 0
    private var nextAttempt = Date.distantPast
    private var summarizeTask: Task<Void, Never>?
    private var summarizing = false

    private var policyFetchedAt = Date.distantPast
    static let policySeconds: TimeInterval = 5 * 60
    static let checkSeconds: TimeInterval = 60
    static let maxBackoffSeconds: TimeInterval = 900

    /// `useKeychain: false` (the smoke test) never touches the Keychain: a rebuilt
    /// binary makes macOS ask first, and nobody is there to answer.
    init(settings: Settings, store: RecordStore?, directory: ClientDirectory, useKeychain: Bool = true) {
        self.settings = settings
        self.store = store
        self.directory = directory
        credentials = useKeychain ? DeviceCredentials.load() : nil
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
    func connect(urlText: String, authCode: String) async {
        let code = authCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            state = .failed("Enter the auth code from the Orion web app (Settings, Connect your Mac).")
            return
        }
        let url: URL
        do {
            url = try BackendClient.validatedURL(urlText)
        } catch {
            state = .failed(error.localizedDescription)
            return
        }
        state = .connecting
        let client = BackendClient(baseURL: url)
        let registration = DeviceRegistration(name: DeviceName.current(), authCode: code)
        do {
            let credentials = try await client.register(registration)
            try credentials.save()
            settings.backendURL = url.absoluteString
            self.credentials = credentials
            destination = client.destination
            state = .connected
            await refreshPolicy()
            await syncClients() // match against the client list before the first send
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
        Task {
            if Date().timeIntervalSince(policyFetchedAt) >= Self.policySeconds { await refreshPolicy() }
            if directory.isDue { await syncClients() }
            await sendApproved()
            await summarizePending()
        }
    }

    // MARK: Summaries

    /// Summarize shortly after the Outbox changes, once a burst of changes settles.
    func summarizeSoon() {
        summarizeTask?.cancel()
        summarizeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            await self?.summarizePending()
        }
    }

    /// POST /v1/summaries for each batch that has none for its current contents.
    /// Failures are tried again after a minute.
    func summarizePending() async {
        guard !summarizing, isConnected, let outbox else { return }
        summarizing = true
        defer { summarizing = false }
        for batch in outbox.summarizable {
            let signature = batch.signature
            if let existing = outbox.summaries[batch.id], existing.signature == signature {
                guard case .failed = existing.state, Date().timeIntervalSince(existing.at) > 60 else { continue }
            }
            let previous = outbox.summaries[batch.id]?.text
            outbox.summaries[batch.id] = .init(signature: signature, state: .loading, text: previous)
            let blocks = batch.items.map(directory.payload(for:)) // exactly what sending would post
            do {
                let response = try await withBackend { client, credentials in try await client.summarize(blocks, credentials: credentials) }
                outbox.summaries[batch.id] = .init(signature: signature, state: .ready, text: response.summary)
            } catch {
                outbox.summaries[batch.id] = .init(signature: signature, state: .failed(error.localizedDescription), text: previous)
                if case BackendError.unauthorized = error { return }
            }
        }
    }

    // MARK: Daily draft

    func fetchDraft() async throws -> Draft {
        try await withBackend { client, credentials in try await client.fetchDraft(credentials: credentials) }
    }

    func review(entry id: String, _ review: DraftReview) async throws -> DraftEntry {
        try await withBackend { client, credentials in try await client.review(entry: id, review, credentials: credentials) }
    }

    /// Runs a call with the current connection; a rejected token disconnects, as for sending.
    private func withBackend<T: Sendable>(_ call: (BackendClient, DeviceCredentials) async throws -> T) async throws -> T {
        guard let credentials, let client else { throw BackendError.notConnected }
        do {
            return try await call(client, credentials)
        } catch BackendError.unauthorized {
            disconnect()
            state = .failed(BackendError.unauthorized.localizedDescription)
            throw BackendError.unauthorized
        }
    }

    // MARK: Policy and consent

    /// GET /v1/policy. A failure keeps the last good policy.
    func refreshPolicy() async {
        guard let credentials, let client else { return }
        policyFetchedAt = Date()
        do {
            settings.policy = try await client.fetchPolicy(credentials: credentials)
            policyError = nil
            if !settings.consentPending { sendNow() }
        } catch BackendError.unauthorized {
            disconnect()
            state = .failed(BackendError.unauthorized.localizedDescription)
        } catch {
            policyError = error.localizedDescription
        }
    }

    /// POST /v1/consent for the notice shown. Work blocks wait until this succeeds.
    func acceptConsent() async {
        let version = settings.policy.consent.version
        consentBusy = true
        defer { consentBusy = false }
        do {
            _ = try await withBackend { client, credentials in try await client.acceptConsent(version: version, credentials: credentials) }
            settings.consentVersion = version
            policyError = nil
            sendNow()
        } catch BackendError.server(status: 409) {
            await refreshPolicy() // the notice changed; show the new one
        } catch {
            policyError = error.localizedDescription
        }
    }

    // MARK: Delete

    /// DELETE /v1/me/data before the local wipe. Always returns so the local wipe goes on;
    /// the text says what happened to the server copy.
    func deleteRemote() async -> String? {
        guard isConnected else { return nil }
        do {
            try await withBackend { client, credentials in try await client.deleteMyData(credentials: credentials) }
            return nil
        } catch {
            return "Your data on this Mac was deleted, but the request to delete it from Orion didn't go through (\(error.localizedDescription)) Ask your admin, or delete it from the Orion web app."
        }
    }

    /// GET /v1/clients: only what changed since the last sync; everything when the list is empty.
    func syncClients() async {
        guard let credentials, let client else { return }
        let cursor = directory.cursor
        do {
            directory.apply(try await client.fetchClients(since: cursor, credentials: credentials), full: cursor == nil)
        } catch BackendError.unauthorized {
            disconnect()
            state = .failed(BackendError.unauthorized.localizedDescription)
        } catch {
            directory.failed(error.localizedDescription)
        }
    }

    private func sendApproved() async {
        // No work blocks before the person accepts the company's notice, and none while paused.
        guard !inFlight, let credentials, let client, let store, !settings.consentPending, settings.policy.captureEnabled else { return }
        let items = (try? store.outbox([.approved], limit: BackendClient.batchLimit, oldestFirst: true, sendable: true)) ?? []
        guard !items.isEmpty else { return }

        inFlight = true
        state = .sending
        defer { inFlight = false }
        do {
            // Each block carries the client matched on this Mac, if any.
            let response = try await client.postWorkBlocks(items.map(directory.payload(for:)), credentials: credentials)
            let accepted = Set(response.acceptedIds)
            let sent = items.filter { accepted.contains($0.id.uuidString) }.map(\.id)
            try store.markSent(sent, destination: client.destination)
            let byId = Dictionary(uniqueKeysWithValues: items.map { ($0.id.uuidString, $0.id) })
            try store.markRejected(response.rejected.compactMap { r in byId[r.localId].map { ($0, r.reason) } })
            lastSentAt = Date()
            lastSentCount = sent.count
            failures = 0
            nextAttempt = .distantPast
            state = .connected
            outbox?.refresh()
            // A full batch means more may be waiting.
            if items.count == BackendClient.batchLimit, !sent.isEmpty || !response.rejected.isEmpty { Task { await sendApproved() } }
        } catch BackendError.unauthorized {
            disconnect()
            state = .failed(BackendError.unauthorized.localizedDescription)
        } catch BackendError.consentRequired {
            settings.consentVersion = nil // the server says no consent on record: ask again
            await refreshPolicy()
            state = .connected
        } catch BackendError.capturePaused {
            await refreshPolicy()
            state = .connected
        } catch {
            // Wait longer after each failure: 30 s, 1 min, 2 min, ... up to 15 min,
            // and never less than the server's Retry-After.
            failures += 1
            var retryAfter: TimeInterval?
            if case BackendError.throttled(_, let seconds) = error { retryAfter = seconds }
            let wait = Self.backoff(failures: failures, retryAfter: retryAfter)
            nextAttempt = Date().addingTimeInterval(wait)
            state = .failed("\(error.localizedDescription) Trying again in \(Int(wait / 60) > 0 ? "\(Int(wait / 60)) min" : "\(Int(wait)) s").")
        }
    }

    static func backoff(failures: Int, retryAfter: TimeInterval?) -> TimeInterval {
        BackendClient.minimumWait(failures: failures, retryAfter: retryAfter)
    }

    static let appVersion = "0.6.0-dev"
}
