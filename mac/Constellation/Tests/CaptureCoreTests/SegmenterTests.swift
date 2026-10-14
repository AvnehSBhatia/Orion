import Foundation
import Testing
@testable import CaptureCore

@Suite("Segmentation and dedupe")
struct SegmenterTests {
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    func snapshot(
        app: String = "com.apple.mail", title: String = "Inbox", domain: String? = nil,
        lines: [String] = [], at seconds: TimeInterval = 0, skip: SkipReason? = nil
    ) -> Snapshot {
        var snapshot = Snapshot(appBundleId: app, appName: app)
        snapshot.windowTitle = title
        snapshot.domainPath = domain
        snapshot.lines = lines
        snapshot.foundWindow = true
        snapshot.capturedAt = start.addingTimeInterval(seconds)
        snapshot.skip = skip
        return snapshot
    }

    @Test("App switch starts a new record")
    func appSwitch() {
        var segmenter = Segmenter()
        #expect(segmenter.ingest(snapshot(app: "com.apple.mail", lines: ["a"])) == .newRecord)
        #expect(segmenter.ingest(snapshot(app: "com.apple.Terminal", lines: ["b"], at: 5)) == .newRecord)
        #expect(segmenter.records.count == 2)
    }

    @Test("Leaving an app finishes its record; coming back starts a new one")
    func finishOnLeave() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(lines: ["a"]))
        #expect(segmenter.open != nil)
        let finished = segmenter.finishCurrent()
        #expect(finished)
        #expect(segmenter.open == nil)
        let again = segmenter.finishCurrent()
        #expect(!again) // nothing left open
        #expect(segmenter.ingest(snapshot(lines: ["a"], at: 5)) == .newRecord) // same window, but a new visit
        #expect(segmenter.records.count == 2)
        #expect(segmenter.open?.id == segmenter.records.last?.id)
    }

    @Test("Coming back to the window just left continues its record without repeating lines")
    func resumeSameWindow() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(title: "Your Apple ID — Apple", lines: ["Hello", "Body"]))
        segmenter.finishCurrent()
        let back = snapshot(title: "Your Apple ID — Apple", lines: ["Hello", "Body", "More"], at: 200) // past the idle gap, within resume
        #expect(segmenter.resumable(back) != nil)
        segmenter.resume()
        #expect(segmenter.ingest(back) == .appended(chars: 4)) // only "More" is new
        #expect(segmenter.records.count == 1)
        #expect(segmenter.current?.text == "Hello\nBody\nMore")
    }

    @Test("Another window, or coming back too late, starts a new record")
    func noResume() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(title: "A"))
        #expect(segmenter.resumable(snapshot(title: "A", at: 10)) == nil) // not finished: it simply continues
        segmenter.finishCurrent()
        #expect(segmenter.resumable(snapshot(title: "B", at: 10)) == nil)
        #expect(segmenter.resumable(snapshot(title: "A", at: Limits.resumeSeconds + 1)) == nil)
    }

    @Test("Same window appends only new lines")
    func appendsNewLines() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(lines: ["one", "two"]))
        #expect(segmenter.ingest(snapshot(lines: ["two", "three"], at: 10)) == .appended(chars: 5))
        #expect(segmenter.records.count == 1)
        #expect(segmenter.current?.text == "one\ntwo\nthree")
        #expect(segmenter.current?.snapshotCount == 2)
        #expect(segmenter.current?.endedAt == start.addingTimeInterval(10))
    }

    @Test("Same text twice is stored once")
    func dedupe() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(lines: ["hello world"]))
        let hash = segmenter.current?.textHash
        #expect(segmenter.ingest(snapshot(lines: ["hello world"], at: 3)) == .unchanged)
        #expect(segmenter.current?.text == "hello world")
        #expect(segmenter.current?.textHash == hash)
    }

    @Test("An idle gap over 2 minutes starts a new record")
    func idleGap() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(lines: ["a"]))
        #expect(segmenter.ingest(snapshot(lines: ["b"], at: 100)) == .appended(chars: 1))
        #expect(segmenter.ingest(snapshot(lines: ["c"], at: 100 + Limits.idleGapSeconds + 1)) == .newRecord)
        #expect(segmenter.records.count == 2)
    }

    @Test("Rapid title changes each start a record")
    func rapidTitleChanges() {
        var segmenter = Segmenter()
        for (index, title) in ["Doc 1", "Doc 2", "Doc 1", "Doc 3"].enumerated() {
            segmenter.ingest(snapshot(title: title, lines: ["x"], at: Double(index)))
        }
        #expect(segmenter.records.map(\.windowTitle) == ["Doc 1", "Doc 2", "Doc 1", "Doc 3"])
    }

    @Test("A new browser page starts a new record even with the same title")
    func browserPage() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(app: "com.google.Chrome", title: "Dashboard", domain: "a.example.com/x"))
        #expect(segmenter.ingest(snapshot(app: "com.google.Chrome", title: "Dashboard", domain: "a.example.com/y", at: 2)) == .newRecord)
    }

    @Test("Record text is capped")
    func cap() {
        var segmenter = Segmenter()
        let long = String(repeating: "x", count: 3_000)
        segmenter.ingest(snapshot(lines: [long, long + "y"]))
        #expect(segmenter.current?.text.count == Limits.maxRecordChars)
    }

    @Test("Skipped snapshots and missing windows store nothing")
    func skipped() {
        var segmenter = Segmenter()
        #expect(segmenter.ingest(snapshot(lines: ["secret"], skip: .privateWindow)) == .unchanged)
        var noWindow = snapshot(lines: ["x"])
        noWindow.foundWindow = false
        #expect(segmenter.ingest(noWindow) == .unchanged)
        #expect(segmenter.records.isEmpty)
    }

    @Test("Delete all empties everything")
    func clear() {
        var segmenter = Segmenter()
        segmenter.ingest(snapshot(lines: ["a"]))
        segmenter.clear()
        #expect(segmenter.records.isEmpty)
        #expect(segmenter.ingest(snapshot(lines: ["a"], at: 1)) == .newRecord) // dedupe memory cleared too
        #expect(segmenter.current?.text == "a")
    }
}
