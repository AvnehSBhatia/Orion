import CaptureCore
import Foundation

/// The device's client list: synced from GET /v1/clients, kept encrypted in the
/// store, and used to match each work block to a client before it is sent.
///
/// Matching costs milliseconds per item, and the Outbox asks again for every item on
/// every render, so results are cached per record id and the list version, and drop
/// out when the record's text changes (an edit) or the list changes.
@MainActor final class ClientDirectory: ObservableObject {
    @Published private(set) var list: ClientList
    @Published private(set) var syncError: String?
    private(set) var matcher: ClientMatcher
    /// Goes up whenever the list or its rules change.
    private(set) var version = 0

    private struct Cached {
        let version: Int
        let endedAt: Date
        let textCount: Int
        let titleCount: Int
        let match: ClientMatch?
    }
    private var cache: [UUID: Cached] = [:]
    private(set) var matchCalls = 0 // for tests and the debug view

    private let store: RecordStore?
    private let names: NameMasker

    /// How often to ask the backend for changes.
    static let syncSeconds: TimeInterval = 15 * 60

    init(store: RecordStore?, names: NameMasker) {
        self.store = store
        self.names = names
        let saved = ((try? store?.loadClientList()) ?? nil) ?? ClientList()
        list = saved
        matcher = ClientMatcher(clients: saved.clients, rules: saved.rules)
        names.setExempt(saved.clients.flatMap(\.names))
    }

    var isDue: Bool {
        guard let syncedAt = list.syncedAt else { return true }
        return Date().timeIntervalSince(syncedAt) >= Self.syncSeconds
    }

    /// What to send as `since`: nil while the list is empty, so the server sends it all.
    var cursor: String? { list.cursor }

    func apply(_ response: ClientsResponse, full: Bool) {
        list.merge(response, full: full)
        rebuild()
        syncError = nil
        try? store?.saveClientList(list)
    }

    private func rebuild() {
        matcher = ClientMatcher(clients: list.clients, rules: list.rules)
        names.setExempt(list.clients.flatMap(\.names)) // client names stay readable
        version += 1
        cache.removeAll()
    }

    func failed(_ message: String) {
        syncError = message
    }

    /// Delete all: the store is wiped, so start the list over; the next sync fetches it again.
    func reset() {
        list = ClientList()
        matcher = ClientMatcher(clients: [])
        names.setExempt([])
        version += 1
        cache.removeAll()
    }

    func match(_ record: ActivityRecord) -> ClientMatch? {
        if let hit = cache[record.id], hit.version == version, hit.endedAt == record.endedAt,
           hit.textCount == record.text.utf8.count, hit.titleCount == record.windowTitle.utf8.count {
            return hit.match
        }
        matchCalls += 1
        let match = matcher.match(title: record.windowTitle, domainPath: record.domainPath, text: record.text)
        cache[record.id] = Cached(version: version, endedAt: record.endedAt, textCount: record.text.utf8.count,
                                  titleCount: record.windowTitle.utf8.count, match: match)
        return match
    }

    /// Exactly what is sent for an item: the payload plus the matched client.
    func payload(for item: OutboxItem) -> WorkBlockPayload {
        WorkBlockPayload(item.record, match: BlockMatch(match(item.record)))
    }
}
