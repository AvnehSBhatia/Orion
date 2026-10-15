import CaptureCore
import Foundation

/// The usual timesheet for the past week, one day at a time: which clients, how many
/// minutes. Saved days are remembered on this Mac so the window shows what was sent.
@MainActor final class BaselineModel: ObservableObject {
    struct Row: Identifiable, Equatable {
        let id = UUID()
        var clientId: String?
        var minutes: Int
    }

    let days: [Date]
    @Published var selected: Int
    @Published var rows: [Row] = []
    @Published private(set) var saving = false
    @Published private(set) var savedDays: Set<String> = []
    @Published var error: String?

    private let sender: Sender
    private let defaults: UserDefaults
    private static let key = "baseline.saved"

    init(sender: Sender, defaults: UserDefaults = .standard, today: Date = Date()) {
        self.sender = sender
        self.defaults = defaults
        days = Baseline.week(endingBefore: today)
        selected = days.count - 1
        savedDays = Set(saved.keys)
        loadRows()
    }

    var day: String { Baseline.dayString(days[selected]) }
    var isSaved: Bool { savedDays.contains(day) }
    var totalMinutes: Int { rows.reduce(0) { $0 + $1.minutes } }

    /// What gets sent.
    var payload: Baseline { Self.payload(day: day, rows: rows) }

    /// Rows with a client and time, one entry per client (minutes added).
    static func payload(day: String, rows: [Row]) -> Baseline {
        var order: [String] = []
        var minutes: [String: Int] = [:]
        for row in rows {
            guard let client = row.clientId, row.minutes > 0 else { continue }
            if minutes[client] == nil { order.append(client) }
            minutes[client, default: 0] += row.minutes
        }
        let entries = order.map { Baseline.Entry(clientId: $0, minutes: min(minutes[$0] ?? 0, DraftReview.minuteRange.upperBound)) }
        return Baseline(day: day, entries: entries)
    }

    func select(_ index: Int) {
        selected = index
        loadRows()
        error = nil
    }

    func addRow() { rows.append(Row(clientId: nil, minutes: 60)) }
    func removeRow(_ id: UUID) { rows.removeAll { $0.id == id } }

    func save() async {
        let baseline = payload
        saving = true
        defer { saving = false }
        do {
            let reply = try await sender.saveBaseline(baseline)
            remember(reply.day == baseline.day ? reply : baseline)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    #if DEBUG
    func loadSample() {
        rows = [Row(clientId: "c_acme", minutes: 240), Row(clientId: "c_globex", minutes: 150), Row(clientId: nil, minutes: 60)]
        savedDays = [Baseline.dayString(days[days.count - 2])]
    }
    #endif

    // MARK: Remembered days (client ids and minutes only)

    private var saved: [String: [Baseline.Entry]] {
        get { (defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([String: [Baseline.Entry]].self, from: $0) }) ?? [:] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: Self.key) }
    }

    private func remember(_ baseline: Baseline) {
        var all = saved
        all[baseline.day] = baseline.entries
        saved = all
        savedDays.insert(baseline.day)
    }

    private func loadRows() {
        rows = (saved[day] ?? []).map { Row(clientId: $0.clientId, minutes: $0.minutes) }
        if rows.isEmpty { rows = [Row(clientId: nil, minutes: 60)] }
    }
}
