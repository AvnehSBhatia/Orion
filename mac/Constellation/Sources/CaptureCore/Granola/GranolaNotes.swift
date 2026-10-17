import CryptoKit
import Foundation

// Finished Granola meeting notes, never the recording or the transcript.
// Granola encrypted its on-disk cache in 2026, so the plain cache (cache-v3.json,
// cache-v4.json) is only a fallback. The current path is Granola's notes API.
// Both shapes are parsed here. A transcript field is never copied into the note.

public struct GranolaNote: Equatable, Sendable {
    public var id: String
    public var title: String
    /// Changes when the note changes, so a later edit is imported again.
    public var updatedAt: String
    public var startedAt: Date?
    public var endedAt: Date?
    /// Summary and the person's own notes. No transcript, no email addresses.
    public var text: String

    public init(id: String, title: String, updatedAt: String, startedAt: Date?, endedAt: Date?, text: String) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.text = text
    }
}

public enum GranolaRead: Equatable, Sendable {
    case notes([GranolaNote])
    case missing
    case unreadable
}

public enum GranolaNotes {
    public static let bundleId = "com.granola.app"
    public static let appName = "Granola"

    /// The newest plain `cache-vN.json` in a directory listing. Encrypted files are skipped.
    public static func cacheFile(among names: [String]) -> String? {
        names
            .filter { $0.hasPrefix("cache-v") && $0.hasSuffix(".json") && !$0.contains(".enc") }
            .max { version($0) < version($1) }
    }

    /// Read Granola's plain cache in `folder`. Missing folder or no cache file is `.missing`.
    public static func readCache(in folder: URL, fileManager: FileManager = .default) -> GranolaRead {
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: folder.path, isDirectory: &isDir), isDir.boolValue,
              let names = try? fileManager.contentsOfDirectory(atPath: folder.path),
              let file = cacheFile(among: names),
              let data = try? Data(contentsOf: folder.appendingPathComponent(file))
        else { return .missing }
        return parse(data)
    }

    /// A cache file, a list response, or one note. Unknown JSON is `.unreadable`.
    public static func parse(_ data: Data) -> GranolaRead {
        guard let root = try? JSONSerialization.jsonObject(with: data),
              let rows = documents(in: root)
        else { return .unreadable }
        return .notes(rows.compactMap(note(from:)))
    }

    /// Outbox records for notes that are new or edited since `seen` (id to updatedAt).
    public static func records(
        from notes: [GranolaNote], seen: [String: String], options: RedactionOptions, now: Date = Date()
    ) -> (records: [ActivityRecord], seen: [String: String]) {
        var next = seen
        var records: [ActivityRecord] = []
        for note in notes where !note.text.isEmpty {
            let version = note.updatedAt.isEmpty ? Segmenter.hash(note.text) : note.updatedAt
            if next[note.id] == version { continue }
            records.append(record(note, version: version, options: options, now: now))
            next[note.id] = version
        }
        return (records, next)
    }

    public static func stableId(_ key: String) -> UUID {
        let digest = Array(SHA256.hash(data: Data(key.utf8)))
        return UUID(uuid: (
            digest[0], digest[1], digest[2], digest[3],
            digest[4], digest[5],
            (digest[6] & 0x0F) | 0x40, digest[7],
            (digest[8] & 0x3F) | 0x80, digest[9],
            digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]
        ))
    }

    // MARK: Parsing

    private static func version(_ name: String) -> Int {
        Int(name.dropFirst("cache-v".count).prefix { $0.isNumber }) ?? 0
    }

    private static func documents(in value: Any) -> [[String: Any]]? {
        guard let dict = value as? [String: Any] else { return nil }
        if let notes = dict["notes"] as? [Any] {
            return notes.compactMap { $0 as? [String: Any] }
        }
        if let docs = dict["documents"] as? [String: Any], dict["cache"] == nil {
            return docs.map { key, raw in
                var row = raw as? [String: Any] ?? [:]
                if row["id"] == nil { row["id"] = key }
                return row
            }
        }
        if let state = dict["state"] { return documents(in: state) }
        if let cache = dict["cache"] {
            if let text = cache as? String, let data = text.data(using: .utf8),
               let inner = try? JSONSerialization.jsonObject(with: data) {
                return documents(in: inner)
            }
            return documents(in: cache)
        }
        if dict["id"] != nil { return [dict] }
        return nil
    }

    private static func note(from row: [String: Any]) -> GranolaNote? {
        guard let id = string(row["id"]), !id.isEmpty else { return nil }
        let calendar = row["calendar_event"] as? [String: Any]
        let title = string(row["title"]) ?? string(calendar?["event_title"]) ?? "Meeting"
        let summary = firstText(row, ["notes_markdown", "notes_plain", "summary_markdown", "summary_text", "summary", "notes"])
            ?? panelText(row["documentPanels"])
        let own = firstText(row, ["private_notes_markdown", "private_notes_text"])
        var parts: [String] = []
        let names = attendeeNames(row)
        if !names.isEmpty { parts.append("With: \(names.joined(separator: ", "))") }
        if let summary, !summary.isEmpty { parts.append(summary) }
        if let own, !own.isEmpty, own != summary { parts.append("Your notes\n\(own)") }
        let text = parts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let updated = string(row["updated_at"]) ?? string(row["updatedAt"]) ?? string(row["created_at"]) ?? string(row["createdAt"]) ?? ""
        let start = date(string(calendar?["scheduled_start_time"]) ?? string(row["created_at"]) ?? string(row["createdAt"]))
        let end = date(string(calendar?["scheduled_end_time"]) ?? string(row["updated_at"]) ?? string(row["updatedAt"]))
        return GranolaNote(id: id, title: title, updatedAt: updated, startedAt: start, endedAt: end, text: text)
    }

    /// A string field, or `{ "markdown": "..." }` / `{ "plain": "..." }`. Never a transcript.
    private static func firstText(_ row: [String: Any], _ keys: [String]) -> String? {
        for key in keys {
            if let text = string(row[key]) { return text }
            if let nested = row[key] as? [String: Any] {
                if let text = string(nested["markdown"]) ?? string(nested["plain"]) ?? string(nested["text"]) { return text }
            }
        }
        return nil
    }

    private static func panelText(_ raw: Any?) -> String? {
        let panels: [Any]
        if let list = raw as? [Any] { panels = list }
        else if let dict = raw as? [String: Any] { panels = Array(dict.values) }
        else { return nil }
        let chunks = panels.compactMap { item -> String? in
            guard let panel = item as? [String: Any] else { return string(item) }
            return string(panel["markdown"]) ?? string(panel["content"]) ?? string(panel["text"])
        }
        let joined = chunks.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }

    /// Names only. An email address is not a name.
    private static func attendeeNames(_ row: [String: Any]) -> [String] {
        var names: [String] = []
        for key in ["attendees", "people", "participants"] {
            guard let list = row[key] as? [Any] else { continue }
            for item in list {
                let name: String?
                if let text = item as? String { name = text }
                else if let person = item as? [String: Any] { name = string(person["name"]) }
                else { name = nil }
                guard let name else { continue }
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty || trimmed.contains("@") { continue }
                if !names.contains(trimmed) { names.append(trimmed) }
            }
        }
        return names
    }

    private static func string(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: value) { return date }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: value)
    }

    private static func record(_ note: GranolaNote, version: String, options: RedactionOptions, now: Date) -> ActivityRecord {
        let title = Redactor.redact(note.title, options: options)
        let body = Redactor.redact(String(note.text.prefix(Limits.maxRecordChars)), options: options)
        var start = note.startedAt ?? note.endedAt ?? now
        var end = note.endedAt ?? note.startedAt ?? start
        if end < start { swap(&start, &end) }
        let text = body.text
        return ActivityRecord(
            id: stableId("\(note.id)\n\(version)"),
            startedAt: start, endedAt: end,
            appBundleId: bundleId, appName: appName, windowTitle: title.text,
            domainPath: nil, text: text, textHash: Segmenter.hash(text),
            redactionCount: title.total + body.total, status: .queued, snapshotCount: 1
        )
    }
}
