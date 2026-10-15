import Foundation
import Testing
@testable import CaptureCore

@Suite("Rejected blocks")
struct RejectionTests {
    @Test("Rejections count only repeats of the same reason, and sending stops after 3")
    func rejections() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-rej-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let store = try RecordStore(url: folder.appendingPathComponent("store.sqlite"), keys: MemoryStoreKey())
        let record = ActivityRecord(id: UUID(), startedAt: Date().addingTimeInterval(-300), endedAt: Date().addingTimeInterval(-200),
                                    appBundleId: "a", appName: "A", windowTitle: "t", domainPath: nil, text: "x",
                                    textHash: "", redactionCount: 0, status: .local, snapshotCount: 1)
        try store.saveNow(record)
        store.closeOpen(except: nil, endedBefore: nil, approve: true)
        try store.markRejected([(record.id, "card_number")])
        try store.markRejected([(record.id, "invalid")]) // another reason: starts over
        #expect(try store.outbox([.approved]).first?.rejectedCount == 1)
        try store.markRejected([(record.id, "invalid")])
        try store.markRejected([(record.id, "invalid")])
        let item = try #require(try store.outbox([.approved]).first)
        #expect(item.rejectedCount == 3 && item.gaveUp && item.rejectedReason == "invalid")
        #expect(try store.outbox([.approved], sendable: true).isEmpty)
        try store.updateText(record.id, text: "edited", redactionCount: 0) // an edit gives it another chance
        #expect(try store.outbox([.approved], sendable: true).count == 1)
    }
}
