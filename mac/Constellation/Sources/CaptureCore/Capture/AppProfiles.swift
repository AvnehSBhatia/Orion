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

    /// Views never read, and nothing inside them. An entry ending in "." skips every
    /// identifier that starts with it ("Mail.categoryBucket." covers each category tab).
    public var skipIdentifiers: Set<String>
    public var title: SelectedRowTitle?
    /// Leave out container descriptions ("message content", "message headers").
    public var dropAreaLabels = false
    /// Read only inside the first of these views found; when none is there, read the
    /// window as usual. Mail: just the open email's body, not its banners, header, or
    /// buttons. A compose window has no such view, so what's being written is still read.
    public var focusIdentifiers: [String] = []

    public static func forApp(_ bundleId: String) -> AppProfile? {
        profiles[bundleId]
    }

    static let profiles: [String: AppProfile] = [
        "com.apple.mail": AppProfile(
            // Sidebar, list of emails, the All Mail / Primary / Promotions tabs, and the
            // "Downloading messages" status. Found with `ax-probe layout --all`.
            skipIdentifiers: ["MailboxesOutlineView", "Mail.messageList", "Mail.categoryBucket.", "activityView"],
            title: SelectedRowTitle(
                list: "Mail.messageList",
                fields: ["Mail.messageList.cell.view.subjectLabel", "Mail.messageList.cell.view.addressLabel"]
            ),
            dropAreaLabels: true,
            focusIdentifiers: ["_MAIL_MESSAGE_BODY"]
        ),
    ]

    /// Where to read from: the first focus view found in the window, else the window.
    func readRoot(in window: AXUIElement, start: DispatchTime) -> AXUIElement {
        for identifier in focusIdentifiers {
            // Not through the sidebar or the list of emails: the body is in the reading pane.
            if let view = Self.find(identifier, in: window, start: start, skipping: skipIdentifiers) { return view }
        }
        return window
    }

    static func skips(_ identifier: String, _ skip: Set<String>) -> Bool {
        skip.contains(identifier) || skip.contains { $0.hasSuffix(".") && identifier.hasPrefix($0) }
    }

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
    static func find(_ identifier: String, in root: AXUIElement, start: DispatchTime, skipping skip: Set<String> = []) -> AXUIElement? {
        var queue = [root]
        var visited = 0
        while !queue.isEmpty, visited < 400, AXReader.elapsedMs(since: start) < Limits.maxWalkMs {
            let node = queue.removeFirst()
            visited += 1
            let shape = AXReader.copyMultiple(node, AXReader.shapeAttributes)
            let id = shape[3] as? String
            if id == identifier { return node }
            if let id, !skip.isEmpty, skips(id, skip) { continue }
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
