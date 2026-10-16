import SwiftUI

/// Per-app capture counts and read times. Counts only: captured text, window
/// titles, and URLs are never shown here. Kept low key and monospaced.
struct DebugView: View {
    @ObservedObject var stats: DebugStats
    @ObservedObject var engine: CaptureEngine
    var embedded = false

    var body: some View {
        if embedded {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                pills
                table
            }
        } else {
            SpaceScreen(maxWidth: 1000) {
                WindowHeader(title: "Debug", detail: "Counts only") {
                    InfoButton(text: "Captured text is redacted, then saved encrypted on this Mac. It is never shown here, logged, or sent from this view.")
                }
                pills
            } content: {
                table
            }
        }
    }

    private var pills: some View {
        HStack(spacing: Theme.Space.s) {
            StatusPill(icon: "circle.fill", text: statusText, color: statusColor)
            StatusPill(icon: "lock.fill",
                       text: "\(stats.recordCount) \(stats.storeAvailable ? "records saved" : "records in memory (store unavailable)")")
            StatusPill(icon: "textformat", text: "\(stats.storedChars) characters saved")
        }
    }

    private var table: some View {
        GlassCard {
                if stats.sortedRows.isEmpty {
                    EmptyState(title: "No captures yet", message: "Switch to an app you turned on.")
                } else {
                    // A plain grid rather than Table: Table's NSTableView warned about
                    // reentrant updates as rows changed under it.
                    ScrollView(.horizontal) {
                        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 7) {
                            GridRow {
                                ForEach(Self.headers, id: \.self) { Text($0) }
                            }
                            .font(Theme.Typo.sectionHeader)
                            .foregroundStyle(Theme.textTertiary)
                            Divider().overlay(Color.white.opacity(0.08))
                            ForEach(stats.sortedRows) { row in
                                GridRow {
                                    Text(row.name).foregroundStyle(Theme.textPrimary)
                                    Text("\(row.captures)")
                                    Text(row.skips == 0 ? "0" : "\(row.skips): \(row.lastSkip)")
                                        .foregroundStyle(row.skips == 0 ? Theme.textSecondary : Theme.warning)
                                    Text("\(row.lastChars) / \(row.avgChars)")
                                    Text("\(row.redactions)")
                                    Text("\(row.lastTitleChars)")
                                    Text(row.urlFound.map { $0 ? "yes" : "no" } ?? "-")
                                    Text("\(ms(row.lastMs)) / \(ms(row.avgMs)) / \(ms(row.maxMs))")
                                    Text("\(ms(row.lastRedactMs)) / \(ms(row.avgRedactMs)) / \(ms(row.maxRedactMs))")
                                    Text(row.lastTrigger)
                                }
                                .font(Theme.Typo.mono)
                                .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .padding(.bottom, Theme.Space.xs)
                    }
                }
        }
    }

    private static let headers = [
        "APP", "CAPTURES", "SKIPS", "CHARS LAST/AVG", "REDACTIONS", "TITLE", "URL", "READ MS L/A/M", "REDACT MS L/A/M", "TRIGGER",
    ]

    private var statusText: String {
        let status = engine.status
        switch status.state {
        case .off: return "Off"
        case .paused(let until): return "Paused until \(until.formatted(date: .omitted, time: .shortened))"
        case .on:
            if !status.trusted { return "Needs permission" }
            return status.systemAvailable ? "On" : "On, waiting (locked or asleep)"
        }
    }

    private var statusColor: Color {
        switch engine.status.state {
        case .off: Theme.danger
        case .paused: Theme.warning
        case .on: engine.status.trusted && engine.status.systemAvailable ? Theme.success : Theme.warning
        }
    }

    private func ms(_ value: Double) -> String { String(format: "%.1f", value) }
}
