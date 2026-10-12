import ApplicationServices
import Foundation

// What the plan for Chrome needs (tab title plus URL), checked without reading
// page text. Like everything else here, only counts and yes/no answers leave
// this file; the title and URL themselves are never printed.

struct BrowserInfo {
    var titleChars = 0 // focused window title, which is the active tab's title in browsers
    var addressBar = "-" // "domain + path", "domain only", "found, no URL", "not found"
    var windowDocument = false // window AXDocument holds a URL
}

enum Browser {
    static func inspect(app: AXUIElement, isBrowser: Bool) -> BrowserInfo {
        AXReader.offMain { collect(app: app, isBrowser: isBrowser) }
    }

    private static func collect(app: AXUIElement, isBrowser: Bool) -> BrowserInfo {
        var info = BrowserInfo()
        guard let window = AXReader.focusedWindow(of: app) else { return info }
        info.titleChars = (AXReader.copy(window, kAXTitleAttribute) as? String)?.count ?? 0
        guard isBrowser else { return info }
        info.windowDocument = urlShape(AXReader.copy(window, kAXDocumentAttribute) as? String) != nil
        info.addressBar = addressBar(in: window)
        return info
    }

    /// Breadth first, because the address bar sits near the top of the window.
    /// Includes toolbars (the text walk skips them) and still skips secure fields.
    private static func addressBar(in window: AXUIElement) -> String {
        let start = DispatchTime.now()
        var queue: [(AXUIElement, Int)] = [(window, 0)]
        var visited = 0
        var labelledButEmpty = false
        let fieldText = [kAXValueAttribute, kAXDescriptionAttribute] as CFArray

        while !queue.isEmpty, visited < Limits.addressBarMaxNodes,
              AXReader.elapsedMs(since: start) < Limits.maxWalkMs {
            let (node, depth) = queue.removeFirst()
            visited += 1
            let shape = AXReader.copyMultiple(node, AXReader.shapeAttributes)
            let role = shape[0] as? String ?? ""
            let subrole = shape[1] as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { continue }

            if role == "AXTextField" || role == "AXComboBox" {
                let text = AXReader.copyMultiple(node, fieldText)
                if let shape = urlShape(text[0] as? String) {
                    return shape.hasPath ? "domain + path" : "domain only"
                }
                if let label = text[1] as? String, label.lowercased().contains("address") { labelledButEmpty = true }
            }
            if depth < Limits.addressBarMaxDepth, let children = shape[2] as? [AnyObject] {
                for child in children { if let child = AXReader.element(child) { queue.append((child, depth + 1)) } }
            }
        }
        return labelledButEmpty ? "found, no URL" : "not found"
    }

    // A URL or a bare domain the way Chrome shows it ("mail.google.com/mail/u/0").
    private static let urlPattern = try! NSRegularExpression(
        pattern: #"^(?:[a-z][a-z0-9+.-]*://)?((?:[a-z0-9-]+\.)+[a-z]{2,}|localhost)(?::\d+)?([/?#].*)?$"#,
        options: [.caseInsensitive]
    )

    static func urlShape(_ text: String?) -> (hasDomain: Bool, hasPath: Bool)? {
        guard let text = text?.trimmingCharacters(in: .whitespaces), !text.isEmpty, !text.contains(" ") else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = urlPattern.firstMatch(in: text, range: range) else { return nil }
        let rest = Range(match.range(at: 2), in: text).map { String(text[$0]) } ?? ""
        return (true, rest.count > 1)
    }
}
