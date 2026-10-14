import ApplicationServices
import Foundation

// Some apps put everything in one window: Mail shows the mailbox list, the list
// of emails (with long previews), and the open email side by side, and its window
// title never changes from "Inbox - 26 messages". A profile says which parts to
// skip and where the real title is, using the developer identifiers the app gives
// its views. Found with `ax-probe layout` (counts only, no text).

public struct AppProfile: Sendable {
    /// Selected row of a list whose labels make the title, e.g. Mail's open email.
    public struct SelectedRowTitle: Sendable {
        public var list: String
        /// Labels inside the row, in title order (subject, then sender).
        public var fields: [String]
    }

    /// Views never read, and nothing inside them.
    public var skipIdentifiers: Set<String>
    public var title: SelectedRowTitle?

    public static func forApp(_ bundleId: String) -> AppProfile? {
        profiles[bundleId]
    }

    static let profiles: [String: AppProfile] = [
        "com.apple.mail": AppProfile(
            skipIdentifiers: ["MailboxesOutlineView", "Mail.messageList"], // sidebar, list of emails
            title: SelectedRowTitle(
                list: "Mail.messageList",
                fields: ["Mail.messageList.cell.view.subjectLabel", "Mail.messageList.cell.view.addressLabel"]
            )
        ),
    ]

    /// "Subject — Sender", skipping empty parts.
    public static func composeTitle(_ parts: [String?]) -> String? {
        let kept = parts.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return kept.isEmpty ? nil : kept.joined(separator: " — ")
    }

    // MARK: Reading the title

    /// The title from the selected row, or nil (no list, nothing selected), in
    /// which case the window title is used.
    func readTitle(in window: AXUIElement, start: DispatchTime) -> String? {
        guard let source = title, let list = Self.find(source.list, in: window, start: start),
              let rows = AXReader.copy(list, kAXSelectedRowsAttribute) as? [AnyObject],
              let row = rows.first.flatMap(AXReader.element)
        else { return nil }
        let values = source.fields.map { field in
            Self.find(field, in: row, start: start).flatMap(Self.label)
        }
        return Self.composeTitle(values)
    }

    /// Breadth first search by developer identifier, within the read's time budget.
    static func find(_ identifier: String, in root: AXUIElement, start: DispatchTime) -> AXUIElement? {
        var queue = [root]
        var visited = 0
        while !queue.isEmpty, visited < 400, AXReader.elapsedMs(since: start) < Limits.maxWalkMs {
            let node = queue.removeFirst()
            visited += 1
            let shape = AXReader.copyMultiple(node, AXReader.shapeAttributes)
            if shape[3] as? String == identifier { return node }
            if let children = shape[2] as? [AnyObject] { queue += children.compactMap(AXReader.element) }
        }
        return nil
    }

    static func label(_ element: AXUIElement) -> String? {
        AXReader.copyMultiple(element, [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute])
            .compactMap { $0 as? String }
            .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
}
