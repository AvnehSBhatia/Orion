import CaptureCore
import Foundation

/// A readable one-liner for an Outbox item: what kind of thing it was, its
/// subject or title, and who or where it came from. Presentation only; what is
/// sent doesn't change.
struct ItemSummary {
    let kind: String // "Email", "Web page", or the app's name
    let symbol: String
    let headline: String
    let detail: String? // "from Apple", "github.com"

    init(_ record: ActivityRecord) {
        let title = record.windowTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if record.appBundleId == "com.apple.mail" {
            // The Mail profile titles blocks "Subject — Sender".
            kind = "Email"
            symbol = "envelope"
            if let split = title.range(of: " — ", options: .backwards) {
                headline = String(title[..<split.lowerBound])
                let sender = String(title[split.upperBound...])
                detail = sender.isEmpty ? nil : "from \(sender)"
            } else {
                headline = title
                detail = nil
            }
        } else if let domainPath = record.domainPath {
            kind = "Web page"
            symbol = "globe"
            headline = title.isEmpty ? domainPath : title
            detail = domainPath.split(separator: "/").first.map(String.init)
        } else {
            kind = record.appName
            symbol = "macwindow"
            headline = title.isEmpty ? record.appName : title
            detail = nil
        }
    }

    /// The first few lines worth reading: sentence-like lines that don't just repeat
    /// the title or sender. A reading aid only; the full text is one click away.
    static func excerpt(_ record: ActivityRecord, lines limit: Int = 4) -> [String] {
        let summary = ItemSummary(record)
        let skip = Set([record.windowTitle, summary.headline, summary.detail ?? ""].map { $0.lowercased() })
        return record.text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { line in
                !line.isEmpty && !skip.contains(line.lowercased())
                    && line.split(whereSeparator: \.isWhitespace).count >= 4 // UI labels are short
            }
            .prefix(limit)
            .map { $0 }
    }
}
