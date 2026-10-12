import SwiftUI

/// Per-app capture counts and read times. Counts only: captured text, window
/// titles, and URLs are never shown here.
struct DebugView: View {
    @ObservedObject var stats: DebugStats
    @ObservedObject var engine: CaptureEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Capture debug").font(.title2.bold())
            Text("Counts only. Captured text stays in memory for this session and is never shown, logged, or saved.")
                .foregroundStyle(.secondary)

            HStack(spacing: 24) {
                Summary(label: "Status", value: statusText)
                Summary(label: "Records in memory", value: "\(stats.recordCount)")
                Summary(label: "Characters stored", value: "\(stats.storedChars)")
            }

            Table(stats.sortedRows) {
                TableColumn("App", value: \.name)
                TableColumn("Captures") { Text("\($0.captures)") }.width(64)
                TableColumn("Chars last / avg") { Text("\($0.lastChars) / \($0.avgChars)") }.width(110)
                TableColumn("Title chars") { Text("\($0.lastTitleChars)") }.width(72)
                TableColumn("URL") { Text($0.urlFound.map { $0 ? "yes" : "no" } ?? "-") }.width(40)
                TableColumn("Read ms last / avg / max") { Text("\(ms($0.lastMs)) / \(ms($0.avgMs)) / \(ms($0.maxMs))") }.width(160)
                TableColumn("Last trigger", value: \.lastTrigger)
                TableColumn("Skips") { row in Text(row.skips == 0 ? "0" : "\(row.skips) (\(row.lastSkip))") }
            }
            .frame(minHeight: 260)
        }
        .padding(20)
        .frame(minWidth: 900, minHeight: 420)
    }

    private var statusText: String {
        let status = engine.status
        switch status.state {
        case .off: return "Off"
        case .paused(let until): return "Paused until \(until.formatted(date: .omitted, time: .shortened))"
        case .on:
            if !status.trusted { return "Needs Accessibility permission" }
            return status.systemAvailable ? "On" : "On, waiting (locked or asleep)"
        }
    }

    private func ms(_ value: Double) -> String { String(format: "%.1f", value) }
}

private struct Summary: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.monospacedDigit())
        }
    }
}
