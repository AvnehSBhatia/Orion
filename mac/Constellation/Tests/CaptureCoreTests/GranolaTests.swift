import Foundation
import Testing
@testable import CaptureCore

@Suite("Granola notes")
struct GranolaTests {
    @Test("A v4 cache keeps the summary and the person's notes, and drops the transcript")
    func cacheV4() throws {
        let json = """
        {"cache":{"state":{"documents":{
          "doc_1":{
            "id":"doc_1","title":"Q4 budget",
            "created_at":"2026-10-16T15:00:00Z","updated_at":"2026-10-16T16:00:00Z",
            "notes_markdown":"Decision: ship the pilot on Friday.",
            "private_notes_markdown":"Ask about the almond milk line.",
            "transcript":[{"text":"the recording said a secret phrase"}],
            "attendees":[{"name":"Ada Lovelace","email":"ada@example.com"},{"email":"grace@example.com"}]
          }
        }}}}
        """
        let read = GranolaNotes.parse(Data(json.utf8))
        guard case .notes(let notes) = read else { Issue.record("expected notes"); return }
        #expect(notes.count == 1)
        let note = try #require(notes.first)
        #expect(note.title == "Q4 budget")
        #expect(note.text.contains("ship the pilot on Friday"))
        #expect(note.text.contains("Your notes"))
        #expect(note.text.contains("almond milk"))
        #expect(note.text.contains("With: Ada Lovelace"))
        #expect(!note.text.contains("secret phrase"))
        #expect(!note.text.contains("ada@example.com"))
        #expect(!note.text.contains("grace@example.com"))
        #expect(note.startedAt != nil)
        #expect(note.endedAt != nil)
    }

    @Test("A v3 cache stores the documents as a JSON string")
    func cacheV3() {
        let inner = #"{"state":{"documents":{"m1":{"id":"m1","title":"Standup","notes_plain":"Mina owns the rollout."}}}}"#
        // Granola v3 stores that JSON as a string under "cache".
        let data = try! JSONSerialization.data(withJSONObject: ["cache": inner])
        let read = GranolaNotes.parse(data)
        guard case .notes(let notes) = read else { Issue.record("expected notes"); return }
        #expect(notes.first?.text == "Mina owns the rollout.")
        #expect(notes.first?.id == "m1")
    }

    @Test("An API note uses the summary and ignores a transcript that was not requested")
    func apiNote() {
        let json = """
        {"id":"not_abc","title":"Pricing review","updated_at":"2026-10-01T12:00:00Z",
         "summary_markdown":"Hold the price.",
         "transcript":[{"text":"verbatim audio"}]}
        """
        guard case .notes(let notes) = GranolaNotes.parse(Data(json.utf8)) else { Issue.record("expected notes"); return }
        #expect(notes.first?.text == "Hold the price.")
        #expect(!notes.first!.text.contains("verbatim"))
    }

    @Test("A list response is a page of notes")
    func list() {
        let json = #"{"notes":[{"id":"not_1","title":"One","summary_text":"First."},{"id":"not_2","title":"Empty"}],"hasMore":false}"#
        guard case .notes(let notes) = GranolaNotes.parse(Data(json.utf8)) else { Issue.record("expected notes"); return }
        #expect(notes.map(\.id) == ["not_1"])
    }

    @Test("Unknown JSON and a missing cache fail closed")
    func failures() throws {
        #expect(GranolaNotes.parse(Data("[]".utf8)) == .unreadable)
        #expect(GranolaNotes.parse(Data(#"{"cache":{"nope":1}}"#.utf8)) == .unreadable)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("granola-missing-\(UUID().uuidString)")
        #expect(GranolaNotes.readCache(in: folder) == .missing)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data(#"{"not":"notes"}"#.utf8).write(to: folder.appendingPathComponent("cache-v6.json"))
        #expect(GranolaNotes.readCache(in: folder) == .unreadable)
        #expect(GranolaNotes.cacheFile(among: ["cache-v3.json", "cache-v6.json.enc", "cache-v4.json"]) == "cache-v4.json")
    }

    @Test("The same note is imported once, and an edit is a new record with emails removed")
    func once() {
        let note = GranolaNote(
            id: "not_1", title: "Budget", updatedAt: "1", startedAt: nil, endedAt: nil,
            text: "Email ada@example.com about the hold."
        )
        let first = GranolaNotes.records(from: [note], seen: [:], options: RedactionOptions())
        #expect(first.records.count == 1)
        #expect(first.records[0].appName == "Granola")
        #expect(first.records[0].text.contains("[EMAIL]"))
        #expect(!first.records[0].text.contains("ada@example.com"))
        let again = GranolaNotes.records(from: [note], seen: first.seen, options: RedactionOptions())
        #expect(again.records.isEmpty)
        var edited = note
        edited.updatedAt = "2"
        edited.text = "Ship it."
        let second = GranolaNotes.records(from: [edited], seen: again.seen, options: RedactionOptions())
        #expect(second.records.count == 1)
        #expect(second.records[0].id != first.records[0].id)
    }
}
