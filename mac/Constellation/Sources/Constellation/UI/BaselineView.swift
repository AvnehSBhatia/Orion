import CaptureCore
import SwiftUI

/// What the week looked like before Constellation: per day, which clients and how long.
struct BaselineView: View {
    @ObservedObject var model: BaselineModel
    @ObservedObject var directory: ClientDirectory

    var body: some View {
        SpaceScreen {
            WindowHeader(
                title: "Baseline",
                detail: "Last 7 days",
                subtitle: "Fill in your usual timesheet, a day at a time, so we can compare it with the drafts."
            ) {}
            dayPicker
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
            }
        } content: {
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    ForEach($model.rows) { $row in
                        HStack(spacing: Theme.Space.m) {
                            Menu {
                                ForEach(directory.list.clients.filter(\.matchable)) { client in
                                    Button(client.name) { row.clientId = client.id }
                                }
                            } label: {
                                Text(name(row.clientId)).font(Theme.Typo.bodyStrong)
                                    .foregroundStyle(row.clientId == nil ? Theme.textSecondary : Theme.textPrimary)
                            }
                            .pillMenu()
                            Spacer(minLength: Theme.Space.s)
                            HStack(spacing: 2) {
                                IconButton(symbol: "minus", help: "15 minutes less") { row.minutes = max(0, row.minutes - 15) }
                                Text(row.minutes.asDuration).font(Theme.Typo.bodyStrong).monospacedDigit().frame(minWidth: 72)
                                IconButton(symbol: "plus", help: "15 minutes more") { row.minutes = min(1_440, row.minutes + 15) }
                            }
                            IconButton(symbol: "xmark", help: "Remove") { model.removeRow(row.id) }
                        }
                    }
                    HStack {
                        Button("Add Client") { model.addRow() }.buttonStyle(LinkButtonStyle())
                        Spacer()
                        Text("Total \(model.totalMinutes.asDuration)").font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            HStack(spacing: Theme.Space.m) {
                if model.isSaved {
                    StatusPill(icon: "checkmark", text: "Saved", color: Theme.textPrimary)
                }
                Spacer()
                Button(model.isSaved ? "Save Changes" : "Save Day") { Task { await model.save() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.saving)
            }
        }
    }

    private var dayPicker: some View {
        HStack(spacing: 6) {
            ForEach(Array(model.days.enumerated()), id: \.offset) { index, date in
                Button {
                    model.select(index)
                } label: {
                    VStack(spacing: 2) {
                        Text(date.formatted(.dateTime.weekday(.abbreviated))).font(Theme.Typo.caption)
                        Text(date.formatted(.dateTime.day())).font(Theme.Typo.bodyStrong)
                        Circle().fill(model.savedDays.contains(Baseline.dayString(date)) ? Theme.textPrimary : .clear).frame(width: 4, height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(index == model.selected ? Theme.selectedNav : Theme.buttonFill, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(date.formatted(.dateTime.weekday(.wide).month().day()))
            }
        }
    }

    private func name(_ id: String?) -> String {
        guard let id else { return "Pick a client" }
        return directory.list.clients.first { $0.id == id }?.name ?? "Unknown client"
    }
}
