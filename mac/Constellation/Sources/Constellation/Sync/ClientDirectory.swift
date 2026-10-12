import CaptureCore
import Foundation

/// The device's client list: synced from GET /v1/clients, kept encrypted in the
/// store, and used to match each work block to a client before it is sent.
@MainActor final class ClientDirectory: ObservableObject {
    @Published private(set) var list: ClientList
    @Published private(set) var syncError: String?
    private(set) var matcher: ClientMatcher

    private let store: RecordStore?
    private let names: NameMasker

    /// How often to ask the backend for changes.
    static let syncSeconds: TimeInterval = 15 * 60

    init(store: RecordStore?, names: NameMasker) {
        self.store = store
        self.names = names
        let saved = ((try? store?.loadClientList()) ?? nil) ?? ClientList()
        list = saved
        matcher = ClientMatcher(clients: saved.clients)
        names.setExempt(saved.clients.flatMap(\.names))
    }

    var isDue: Bool {
        guard let syncedAt = list.syncedAt else { return true }
        return Date().timeIntervalSince(syncedAt) >= Self.syncSeconds
    }

    func apply(_ response: ClientsResponse) {
        list.merge(response)
        matcher = ClientMatcher(clients: list.clients)
        names.setExempt(list.clients.flatMap(\.names)) // client names stay readable
        syncError = nil
        try? store?.saveClientList(list)
    }

    func failed(_ message: String) {
        syncError = message
    }

    /// Delete all: the store is wiped, so start the list over; the next sync fetches it again.
    func reset() {
        list = ClientList()
        matcher = ClientMatcher(clients: [])
        names.setExempt([])
    }

    func match(_ record: ActivityRecord) -> ClientMatch? {
        matcher.match(title: record.windowTitle, domainPath: record.domainPath, text: record.text)
    }

    /// Exactly what is sent for an item: the payload plus the matched client id.
    func payload(for item: OutboxItem) -> WorkBlockPayload {
        WorkBlockPayload(item.record, clientId: match(item.record)?.client.id)
    }
}
