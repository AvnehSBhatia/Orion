import Foundation
import Testing
@testable import CaptureCore

// Timing of the work done on every capture and every Outbox refresh, without
// Instruments: client matching, segmenting, and reading the Outbox from the store.
// Prints numbers (counts and milliseconds only) and checks loose upper bounds.

@Suite("Pipeline speed", .serialized)
struct PipelinePerformanceTests {
    static func time(_ body: () throws -> Void) rethrows -> Double {
        let start = DispatchTime.now()
        try body()
        return Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6
    }

    static let clients: [Client] = (0..<25).map { index in
        Client(id: "c_\(index)", name: "Client Number \(index)", aliases: ["CN\(index) Group"],
               domains: ["client\(index).com"], projectCodes: ["C\(index)-"])
    }

    static func record(_ index: Int, text: String) -> ActivityRecord {
        let end = Date().addingTimeInterval(-Double(index) * 60)
        return ActivityRecord(
            id: UUID(), startedAt: end.addingTimeInterval(-50), endedAt: end, appBundleId: "com.apple.mail", appName: "Mail",
            windowTitle: "Re: plan \(index) for Client Number \(index % 25)", domainPath: nil, text: text,
            textHash: Segmenter.hash(text), redactionCount: 0, status: .local, snapshotCount: 1
        )
    }

    static let body = (0..<40).map { "Line \($0): notes on the rollout, see C3-\($0) and client7.com for details." }
        .joined(separator: "\n")

    @Test("Matching 500 items against 25 clients")
    func matching() {
        let matcher = ClientMatcher(clients: Self.clients)
        let records = (0..<500).map { Self.record($0, text: Self.body) }
        var matched = 0
        let ms = Self.time {
            for record in records where matcher.match(title: record.windowTitle, domainPath: record.domainPath, text: record.text) != nil {
                matched += 1
            }
        }
        print("pipeline: matched \(matched) of 500 items against 25 clients in \(String(format: "%.1f", ms)) ms")
        #expect(matched > 0)
        #expect(ms < 5_000)
    }

    @Test("Segmenting 300 reads of a growing window")
    func segmenting() {
        var segmenter = Segmenter()
        let start = Date()
        let ms = Self.time {
            for index in 0..<300 {
                var snapshot = Snapshot(appBundleId: "com.apple.mail", appName: "Mail")
                snapshot.foundWindow = true
                snapshot.windowTitle = "Plan"
                snapshot.lines = (0...(index / 3)).map { "Paragraph \($0) of the plan, with enough words to be a real line." }
                snapshot.capturedAt = start.addingTimeInterval(Double(index))
                segmenter.ingest(snapshot)
            }
        }
        print("pipeline: 300 reads segmented in \(String(format: "%.1f", ms)) ms, \(segmenter.records.count) record(s)")
        #expect(ms < 5_000)
    }

    @Test("Reading a 500 item Outbox from the encrypted store")
    func outboxLoad() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("constellation-perf-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let store = try RecordStore(url: folder.appendingPathComponent("store.sqlite"), keys: MemoryStoreKey())
        for index in 0..<500 { try store.saveNow(Self.record(index, text: Self.body)) }
        store.closeOpen(except: nil, endedBefore: nil, approve: false)
        var count = 0
        let ms = try Self.time { count = try store.outbox([.queued, .approved]).count }
        print("pipeline: Outbox of \(count) items read and decrypted in \(String(format: "%.1f", ms)) ms")
        #expect(count == 500)
    }
}
