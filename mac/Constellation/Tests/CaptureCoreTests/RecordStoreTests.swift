import Foundation
import Testing
@testable import CaptureCore

// The encrypted store, in a temporary folder with an in-memory key.

@Suite("Encrypted record store")
struct RecordStoreTests {
    let folder: URL
    let url: URL

    init() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent("store.sqlite")
    }

    func record(text: String = "Notes on the Acme renewal", title: String = "Acme renewal - Mail",
                endedDaysAgo: Double = 0) -> ActivityRecord {
        let ended = Date().addingTimeInterval(-endedDaysAgo * 86_400)
        return ActivityRecord(
            id: UUID(), startedAt: ended.addingTimeInterval(-60), endedAt: ended, appBundleId: "com.apple.mail",
            appName: "Mail", windowTitle: title, domainPath: nil, text: text, textHash: Segmenter.hash(text),
            redactionCount: 1, status: .local, snapshotCount: 2
        )
    }

    @Test("Records survive closing and reopening the store")
    func survivesRestart() throws {
        let keys = MemoryStoreKey()
        let saved = record()
        do {
            let store = try RecordStore(url: url, keys: keys)
            try store.saveNow(saved)
        }
        let reopened = try RecordStore(url: url, keys: keys)
        let loaded = try reopened.load()
        #expect(loaded.count == 1)
        #expect(loaded.first?.id == saved.id)
        #expect(loaded.first?.text == saved.text)
        #expect(loaded.first?.windowTitle == saved.windowTitle)
        #expect(loaded.first?.redactionCount == 1)
        #expect(loaded.first?.snapshotCount == 2)
        #expect(reopened.totals() == RecordStore.Totals(records: 1, chars: saved.text.count))
    }

    @Test("Saving the same record again updates it")
    func upsert() throws {
        let store = try RecordStore(url: url, keys: MemoryStoreKey())
        var item = record(text: "first")
        try store.saveNow(item)
        item.text = "first\nsecond"
        item.snapshotCount = 3
        try store.saveNow(item)
        let loaded = try store.load()
        #expect(loaded.count == 1)
        #expect(loaded.first?.text == "first\nsecond")
        #expect(loaded.first?.snapshotCount == 3)
    }

    @Test("Title and text are not readable in the file")
    func encryptedAtRest() throws {
        let store = try RecordStore(url: url, keys: MemoryStoreKey())
        try store.saveNow(record(text: "Quarterly numbers for Globex", title: "Globex board deck"))
        let bytes = try Data(contentsOf: url)
        #expect(bytes.range(of: Data("Globex".utf8)) == nil)
        #expect(bytes.range(of: Data("Quarterly".utf8)) == nil)
    }

    @Test("A different key cannot read the records")
    func wrongKey() throws {
        do {
            let store = try RecordStore(url: url, keys: MemoryStoreKey())
            try store.saveNow(record())
        }
        let other = try RecordStore(url: url, keys: MemoryStoreKey())
        #expect(throws: (any Error).self) { try other.load() }
    }

    @Test("Retention clears text older than the cutoff and keeps the title")
    func retention() throws {
        let store = try RecordStore(url: url, keys: MemoryStoreKey())
        let old = record(text: "old text", endedDaysAgo: Double(Limits.rawTextRetentionDays) + 1)
        let recent = record(text: "recent text", endedDaysAgo: 1)
        try store.saveNow(old)
        try store.saveNow(recent)

        let cutoff = Date().addingTimeInterval(-Double(Limits.rawTextRetentionDays) * 86_400)
        #expect(try store.purgeText(endedBefore: cutoff) == 1)
        #expect(try store.purgeText(endedBefore: cutoff) == 0) // already cleared

        let loaded = Dictionary(uniqueKeysWithValues: try store.load().map { ($0.id, $0) })
        #expect(loaded[old.id]?.text == "")
        #expect(loaded[old.id]?.windowTitle == old.windowTitle)
        #expect(loaded[recent.id]?.text == "recent text")
        #expect(store.totals().chars == "recent text".count)
    }

    @Test("Delete all empties the store and replaces the key")
    func deleteAll() throws {
        let keys = MemoryStoreKey()
        let store = try RecordStore(url: url, keys: keys)
        let keyBefore = try keys.loadOrCreate()
        try store.saveNow(record())
        try store.deleteAll()

        #expect(try store.load().isEmpty)
        #expect(store.totals() == RecordStore.Totals())
        let keyAfter = try keys.loadOrCreate()
        #expect(keyBefore != keyAfter)

        try store.saveNow(record(text: "after delete")) // still usable
        #expect(try store.load().first?.text == "after delete")
    }

    @Test("A finished note lands in the Outbox once")
    func addFinished() throws {
        let store = try RecordStore(url: url, keys: MemoryStoreKey())
        var note = record(text: "Ship the pilot.")
        note.status = .queued
        #expect(try store.addFinished(note, approve: false))
        #expect(try store.addFinished(note, approve: false) == false)
        let waiting = try store.outbox([.queued])
        #expect(waiting.count == 1)
        #expect(waiting.first?.record.text == "Ship the pilot.")
        #expect(waiting.first?.queuedAt != nil)
    }
}
