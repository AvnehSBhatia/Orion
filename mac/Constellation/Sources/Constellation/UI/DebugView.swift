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

            // A plain grid rather than Table: Table's NSTableView warned about
            // reentrant updates as rows changed under it.
            ScrollView {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 8) {
                    GridRow {
                        ForEach(Self.headers, id: \.self) { Text($0) }
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    Divider()
                    ForEach(stats.sortedRows) { row in
                        GridRow {
                            Text(row.name)
                            Text("\(row.captures)")
                            Text(row.skips == 0 ? "0" : "\(row.skips): \(row.lastSkip)")
                                .foregroundStyle(row.skips == 0 ? .primary : Color.orange)
                            Text("\(row.lastChars) / \(row.avgChars)")
                            Text("\(row.redactions)")
                            Text("\(row.lastTitleChars)")
                            Text(row.urlFound.map { $0 ? "yes" : "no" } ?? "-")
                            Text("\(ms(row.lastMs)) / \(ms(row.avgMs)) / \(ms(row.maxMs))")
                            Text("\(ms(row.lastRedactMs)) / \(ms(row.avgRedactMs)) / \(ms(row.maxRedactMs))")
                            Text(row.lastTrigger)
                        }
                        .monospacedDigit()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(minHeight: 220)
        }
        .padding(20)
        .frame(minWidth: 1120, minHeight: 400)
    }

    private static let headers = [
        "App", "Captures", "Skips", "Chars last / avg", "Redactions", "Title chars", "URL", "Read ms last / avg / max", "Redact ms last / avg / max", "Last trigger",
    ]

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
