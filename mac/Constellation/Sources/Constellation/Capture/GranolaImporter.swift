import CaptureCore
import Foundation

/// Pulls finished Granola notes into the Outbox. The API key stays in the Keychain.
/// A transcript is never requested. Off until the person turns notes on.
@MainActor final class GranolaImporter: ObservableObject {
    static let keyAccount = "granola-api-key"
    private static let seenKey = "granolaSeen"
    private static let api = URL(string: "https://public-api.granola.ai/v1/notes")!

    @Published private(set) var status = "Off"
    @Published private(set) var hasKey = false

    private let defaults = UserDefaults(suiteName: "com.traxrobotics.constellation") ?? .standard
    private var timer: Timer?
    private var busy = false
    private weak var settings: Settings?
    private var store: RecordStore?
    var onImported: (() -> Void)?

    func start(settings: Settings, store: RecordStore?) {
        self.settings = settings
        self.store = store
        refreshKey()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkNow() }
        }
        checkNow()
    }

    func refreshKey() {
        hasKey = ((try? Keychain.read(Self.keyAccount)) ?? nil) != nil
    }

    func saveKey(_ raw: String) {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if key.isEmpty {
                try Keychain.delete(Self.keyAccount)
            } else {
                guard key.count >= 8, key.count <= 200, !key.contains(where: \.isWhitespace) else {
                    status = "That doesn't look like a Granola API key."
                    return
                }
                try Keychain.write(Data(key.utf8), account: Self.keyAccount, label: "Granola API key")
            }
            refreshKey()
            status = hasKey ? "Key saved." : "Key removed."
            checkNow()
        } catch {
            status = "The keychain couldn't store that key."
        }
    }

    func checkNow() {
        guard let settings else { return }
        guard settings.granolaNotes else {
            status = "Off"
            return
        }
        guard settings.policy.captureEnabled else {
            status = "Your company has paused capture."
            return
        }
        guard !settings.consentPending else {
            status = "Accept the notice before notes can be imported."
            return
        }
        guard !settings.isPaused else {
            status = "Paused."
            return
        }
        guard !busy else { return }
        busy = true
        status = "Checking Granola…"
        let options = settings.redaction
        let approve = settings.outboxMode == .logOnly
        let seen = defaults.dictionary(forKey: Self.seenKey) as? [String: String] ?? [:]
        let key = (try? Keychain.read(Self.keyAccount)).flatMap { $0.flatMap { String(data: $0, encoding: .utf8) } }
        Task { [weak self] in
            let outcome = await Self.fetch(key: key)
            self?.finish(outcome, seen: seen, options: options, approve: approve)
        }
    }

    private func finish(_ outcome: Fetch, seen: [String: String], options: RedactionOptions, approve: Bool) {
        busy = false
        guard settings?.granolaNotes == true else { status = "Off"; return }
        switch outcome {
        case .failed(let message):
            status = message
        case .notes(let notes, let cacheProblem):
            guard let store else {
                status = "The encrypted store is unavailable, so notes can't be saved."
                return
            }
            var accepted = seen
            var saved = 0
            for note in notes {
                let slice = GranolaNotes.records(from: [note], seen: accepted, options: options)
                guard let record = slice.records.first else {
                    accepted = slice.seen
                    continue
                }
                do {
                    if try store.addFinished(record, approve: approve) { saved += 1 }
                    accepted = slice.seen
                } catch {
                    // Leave it unseen so the next check tries again.
                }
            }
            defaults.set(accepted, forKey: Self.seenKey)
            if saved > 0 { onImported?() }
            if saved > 0 {
                status = saved == 1 ? "Imported 1 meeting note. It is in the Outbox." : "Imported \(saved) meeting notes. They are in the Outbox."
            } else if let cacheProblem, notes.isEmpty {
                status = cacheProblem
            } else {
                status = "No new Granola notes."
            }
        }
    }

    private enum Fetch {
        case notes([GranolaNote], cacheProblem: String?)
        case failed(String)
    }

    private static func fetch(key: String?) async -> Fetch {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Granola", isDirectory: true)
        let cache = GranolaNotes.readCache(in: folder)
        var notes: [GranolaNote] = []
        var cacheProblem: String?
        switch cache {
        case .notes(let found): notes = found
        case .missing: cacheProblem = "Granola notes not found. Add an API key from Granola, under Settings, Connectors, API keys."
        case .unreadable: cacheProblem = "Couldn't read Granola's notes (format changed). Add an API key from Granola's settings."
        }
        guard let key, !key.isEmpty else {
            if case .notes = cache { return .notes(notes, cacheProblem: nil) }
            return .notes([], cacheProblem: cacheProblem)
        }
        do {
            let remote = try await list(key: key)
            var byId: [String: GranolaNote] = [:]
            for note in notes { byId[note.id] = note }
            for note in remote where !note.text.isEmpty { byId[note.id] = note }
            for id in remote.filter({ $0.text.isEmpty }).map(\.id).prefix(20) {
                if let full = try await detail(id, key: key) { byId[id] = full }
            }
            return .notes(Array(byId.values), cacheProblem: nil)
        } catch let error as GranolaHTTP {
            if !error.blocksCache, !notes.isEmpty { return .notes(notes, cacheProblem: nil) }
            return .failed(error.message)
        } catch {
            if !notes.isEmpty { return .notes(notes, cacheProblem: nil) }
            return .failed("Couldn't reach Granola.")
        }
    }

    private struct GranolaHTTP: Error {
        var message: String
        /// A rejected key should be shown even when a local cache had notes.
        var blocksCache = false
    }

    /// List notes from the last 30 days. Never asks for a transcript.
    private static func list(key: String) async throws -> [GranolaNote] {
        let since = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-30 * 86_400))
        var cursor: String?
        var notes: [GranolaNote] = []
        for _ in 0..<3 {
            var parts = URLComponents(url: api, resolvingAgainstBaseURL: false)!
            parts.queryItems = [
                URLQueryItem(name: "page_size", value: "30"),
                URLQueryItem(name: "updated_after", value: since),
            ]
            if let cursor { parts.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
            let (data, page) = try await get(parts.url!, key: key)
            guard case .notes(let found) = GranolaNotes.parse(data) else {
                throw GranolaHTTP(message: "Couldn't read Granola's notes (format changed).")
            }
            notes += found
            // A list row often has no summary. Keep the id so the note itself can be fetched.
            for row in page["notes"] as? [Any] ?? [] {
                guard let dict = row as? [String: Any], let id = dict["id"] as? String, !id.isEmpty else { continue }
                if notes.contains(where: { $0.id == id }) { continue }
                notes.append(GranolaNote(
                    id: id, title: dict["title"] as? String ?? "Meeting",
                    updatedAt: dict["updated_at"] as? String ?? "", startedAt: nil, endedAt: nil, text: ""
                ))
            }
            let more = (page["hasMore"] as? Bool) == true || (page["has_more"] as? Bool) == true
            cursor = page["cursor"] as? String
            if !more || cursor == nil { break }
        }
        return notes
    }

    private static func detail(_ id: String, key: String) async throws -> GranolaNote? {
        guard id.range(of: #"^[A-Za-z0-9_-]{1,80}$"#, options: .regularExpression) != nil else { return nil }
        let (data, _) = try await get(api.appendingPathComponent(id), key: key)
        guard case .notes(let notes) = GranolaNotes.parse(data) else { return nil }
        return notes.first
    }

    private static func get(_ url: URL, key: String) async throws -> (Data, [String: Any]) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 || status == 403 {
            throw GranolaHTTP(message: "Granola didn't accept that key. It needs the personal notes scope.", blocksCache: true)
        }
        if status == 429 { throw GranolaHTTP(message: "Granola asked us to wait. Try again in a minute.") }
        if !(200..<300).contains(status) { throw GranolaHTTP(message: "Couldn't reach Granola.") }
        let page = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (data, page)
    }
}
