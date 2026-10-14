import Foundation
import SQLite3
import Testing
@testable import CaptureCore

@Suite("Outbox")
struct OutboxTests {
    let store: RecordStore

    init() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-outbox-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        store = try RecordStore(url: folder.appendingPathComponent("store.sqlite"), keys: MemoryStoreKey())
    }

    func record(_ text: String = "Draft of the Acme proposal", minutesAgo: Double = 5, domainPath: String? = nil) -> ActivityRecord {
        let ended = Date().addingTimeInterval(-minutesAgo * 60)
        return ActivityRecord(
            id: UUID(), startedAt: ended.addingTimeInterval(-120), endedAt: ended, appBundleId: "com.apple.mail",
            appName: "Mail", windowTitle: "Acme proposal", domainPath: domainPath, text: text, textHash: Segmenter.hash(text),
            redactionCount: 0, status: .local, snapshotCount: 1
        )
    }

    @Test("Closed records wait for review; the open one stays out")
    func closeToReview() throws {
        let finished = record(), open = record(minutesAgo: 0)
        try store.saveNow(finished)
        try store.saveNow(open)
        store.closeOpen(except: open.id, endedBefore: nil, approve: false)
        let items = try store.outbox()
        #expect(items.map(\.id) == [finished.id])
        #expect(items.first?.record.status == .queued)
        #expect(items.first?.queuedAt != nil)
        #expect(store.outboxCounts() == (1, 0))
    }

    @Test("Log only approves as soon as records close")
    func logOnly() throws {
        let finished = record()
        try store.saveNow(finished)
        store.closeOpen(except: nil, endedBefore: nil, approve: true)
        #expect(try store.outbox().first?.record.status == .approved)
        #expect(store.outboxCounts() == (0, 1))
    }

    @Test("Only records idle past the cutoff are closed")
    func closeStale() throws {
        let idle = record(minutesAgo: 5), recent = record(minutesAgo: 0.5)
        try store.saveNow(idle)
        try store.saveNow(recent)
        store.closeOpen(except: nil, endedBefore: Date().addingTimeInterval(-Limits.idleGapSeconds), approve: false)
        #expect(try store.outbox().map(\.id) == [idle.id])
    }

    @Test("Saving again never overwrites a record after it has closed")
    func noOverwriteAfterClose() throws {
        var item = record("original")
        try store.saveNow(item)
        store.closeOpen(except: nil, endedBefore: nil, approve: false)
        item.text = "late write"
        try store.saveNow(item)
        #expect(try store.outbox().first?.record.text == "original")
        #expect(try store.outbox().first?.record.status == .queued)
    }

    @Test("Approve, and auto approve only after waiting")
    func approve() throws {
        let a = record(), b = record()
        try store.saveNow(a)
        try store.saveNow(b)
        store.closeOpen(except: nil, endedBefore: nil, approve: false)
        try store.approve([a.id])
        #expect(store.outboxCounts() == (1, 1))

        // Just queued: not old enough to auto approve.
        #expect(try store.autoApprove(queuedBefore: Date().addingTimeInterval(-Double(Limits.autoApproveMinutes) * 60)) == 0)
        // Pretend the wait has passed.
        #expect(try store.autoApprove(queuedBefore: Date().addingTimeInterval(1)) == 1)
        #expect(store.outboxCounts() == (0, 2))
    }

    @Test("Edits replace the text and are marked; delete is permanent")
    func editAndDelete() throws {
        let a = record("before"), b = record("other")
        try store.saveNow(a)
        try store.saveNow(b)
        store.closeOpen(except: nil, endedBefore: nil, approve: false)

        try store.updateText(a.id, text: "after [EMAIL]", redactionCount: 1)
        let edited = try #require(try store.outbox().first { $0.id == a.id })
        #expect(edited.record.text == "after [EMAIL]")
        #expect(edited.record.redactionCount == 1)
        #expect(edited.edited)

        try store.delete([b.id])
        #expect(try store.outbox().map(\.id) == [a.id])
        #expect(try store.load().map(\.id) == [a.id]) // gone from the store, not just hidden
    }

    @Test("A batch is one stretch of capturing, from the first capture to the last; newest first")
    func batches() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        func item(from: Double, to: Double) -> OutboxItem {
            var r = record()
            r.startedAt = base.addingTimeInterval(from * 60)
            r.endedAt = base.addingTimeInterval(to * 60)
            return OutboxItem(record: r)
        }
        // 0–3 and 4–9 run together (1 minute apart); 20–22 comes after an 11 minute gap.
        let groups = OutboxBatch.group([item(from: 20, to: 22), item(from: 0, to: 3), item(from: 4, to: 9)])
        #expect(groups.map(\.items.count) == [1, 2])
        #expect(groups.last?.start == base)
        #expect(groups.last?.end == base.addingTimeInterval(9 * 60)) // the real end, not a 30 minute slot
        #expect(groups.first?.start == base.addingTimeInterval(20 * 60))
        // Exactly the gap limit still counts as the same stretch.
        let gap = Limits.batchGapSeconds / 60
        #expect(OutboxBatch.group([item(from: 0, to: 1), item(from: 1 + gap, to: 2 + gap)]).count == 1)
        #expect(OutboxBatch.group([]).isEmpty)
    }

    @Test("The payload holds exactly these fields")
    func payloadFields() throws {
        let r = record("hello", domainPath: "github.com/acme/app")
        let data = try WorkBlockPayload.encoder().encode(WorkBlockPayload(r, clientId: "client-1"))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(object.keys) == [
            "id", "started_at", "ended_at", "app_bundle_id", "app_name", "window_title", "domain_path", "text",
            "redaction_count", "client_id",
        ])
        #expect(object["text"] as? String == "hello")
        #expect(object["client_id"] as? String == "client-1")
    }
}

@Suite("Store upgrade")
struct StoreMigrationTests {
    @Test("A database from M3 (version 1) upgrades to the Outbox format")
    func upgradesFromVersion1() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-migrate-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("store.sqlite")

        // The M3 schema, written by hand.
        var db: OpaquePointer?
        #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
        let v1 = """
        CREATE TABLE records (id TEXT PRIMARY KEY, started_at REAL NOT NULL, ended_at REAL NOT NULL,
            app_bundle_id TEXT NOT NULL, app_name TEXT NOT NULL, sealed BLOB NOT NULL, redaction_count INTEGER NOT NULL,
            status TEXT NOT NULL, snapshot_count INTEGER NOT NULL, text_chars INTEGER NOT NULL,
            text_purged INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version = 1;
        """
        #expect(sqlite3_exec(db, v1, nil, nil, nil) == SQLITE_OK)
        sqlite3_close(db)

        let store = try RecordStore(url: url, keys: MemoryStoreKey())
        let text = "after upgrade"
        let record = ActivityRecord(
            id: UUID(), startedAt: Date().addingTimeInterval(-60), endedAt: Date(), appBundleId: "com.apple.mail",
            appName: "Mail", windowTitle: "t", domainPath: nil, text: text, textHash: Segmenter.hash(text),
            redactionCount: 0, status: .local, snapshotCount: 1
        )
        try store.saveNow(record)
        store.closeOpen(except: nil, endedBefore: nil, approve: false)
        #expect(try store.outbox().first?.record.text == text)
    }
}
