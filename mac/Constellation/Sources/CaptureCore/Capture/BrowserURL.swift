import ApplicationServices
import Foundation

// Browsers are captured as title plus URL only, never page text. The URL is cut
// down to domain and path: query strings and fragments are dropped because they
// can carry tokens (reset links, session ids, OAuth codes).

public enum BrowserURL {
    /// "domain/path" for a raw URL or address bar text, or nil if it is not a web URL.
    public static func domainAndPath(_ raw: String?) -> String? {
        guard var text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, !text.contains(" ")
        else { return nil }
        if !text.contains("://") { text = "https://" + text } // address bars often hide the scheme
        guard let components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host?.lowercased(), host.contains(".") || host == "localhost"
        else { return nil }
        // URLComponents keeps query, fragment, user, password, and port apart; only host and path are used.
        // Trailing slashes dropped so ".../0/" and ".../0" are the same page.
        var path = components.percentEncodedPath
        while path.hasSuffix("/") { path.removeLast() }
        return host + path
    }

    /// The window's current page URL, as raw text. Tries the window's AXDocument,
    /// then a web area's AXURL, then the address bar (all seen working in M0).
    public static func find(in window: AXUIElement) -> String? {
        if let document = AXReader.copy(window, kAXDocumentAttribute) as? String, domainAndPath(document) != nil {
            return document
        }
        return search(window)
    }

    /// Breadth first, since the address bar and web area are near the top.
    /// Secure fields are skipped without reading their value.
    private static func search(_ window: AXUIElement) -> String? {
        let start = DispatchTime.now()
        var queue: [(AXUIElement, Int)] = [(window, 0)]
        var visited = 0
        var addressBar: String?

        while !queue.isEmpty, visited < Limits.urlSearchMaxNodes, AXReader.elapsedMs(since: start) < Limits.maxWalkMs {
            let (node, depth) = queue.removeFirst()
            visited += 1
            let shape = AXReader.copyMultiple(node, AXReader.shapeAttributes)
            let role = shape[0] as? String ?? ""
            let subrole = shape[1] as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { continue }

            if role == "AXWebArea", let url = AXReader.copy(node, kAXURLAttribute) {
                if let url = (url as? URL)?.absoluteString ?? (url as? String) { return url }
            }
            if addressBar == nil, role == "AXTextField" || role == "AXComboBox",
               let value = AXReader.copy(node, kAXValueAttribute) as? String, domainAndPath(value) != nil {
                addressBar = value // keep looking briefly for the web area's exact URL
            }
            if depth < Limits.urlSearchMaxDepth, let children = shape[2] as? [AnyObject] {
                for child in children { if let child = AXReader.element(child) { queue.append((child, depth + 1)) } }
            }
        }
        return addressBar
    }
}
