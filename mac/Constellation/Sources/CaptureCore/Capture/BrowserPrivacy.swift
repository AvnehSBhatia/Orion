import ApplicationServices
import Foundation

// Private windows that do not say so in their title. M1 testing showed Chrome
// incognito windows keep a normal page title, so the title check (which works
// for Safari) missed them. Chromium browsers label the profile button in the
// toolbar instead: "Incognito", "Guest", or Edge's "InPrivate".

public enum BrowserPrivacy {
    static let buttonRoles: Set<String> = ["AXButton", "AXPopUpButton", "AXMenuButton"]

    /// True if the window's toolbar has a private or guest profile button.
    /// Web content is never searched, so page buttons like "Continue as guest" cannot match.
    public static func hasPrivateMarker(in window: AXUIElement, start: DispatchTime) -> Bool {
        var queue: [(AXUIElement, Int)] = [(window, 0)]
        var visited = 0
        while !queue.isEmpty, visited < Limits.privacySearchMaxNodes,
              AXReader.elapsedMs(since: start) < Limits.maxWalkMs {
            let (node, depth) = queue.removeFirst()
            visited += 1
            let shape = AXReader.copyMultiple(node, AXReader.shapeAttributes)
            let role = shape[0] as? String ?? ""
            let subrole = shape[1] as? String ?? ""
            if role == "AXWebArea" || role == "AXSecureTextField" || subrole == "AXSecureTextField" { continue }

            if buttonRoles.contains(role) {
                let labels = AXReader.copyMultiple(node, [kAXTitleAttribute, kAXDescriptionAttribute])
                if labels.contains(where: { isPrivateLabel($0 as? String) }) { return true }
            }
            if depth < Limits.privacySearchMaxDepth, let children = shape[2] as? [AnyObject] {
                for child in children { if let child = AXReader.element(child) { queue.append((child, depth + 1)) } }
            }
        }
        return false
    }

    /// The profile button's label in a private or guest window, e.g. "Incognito",
    /// "Incognito (2)", "Guest", "InPrivate". Matched at the start of the label only.
    public static func isPrivateLabel(_ label: String?) -> Bool {
        guard let label = label?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !label.isEmpty
        else { return false }
        if label.hasPrefix("incognito") || label.hasPrefix("inprivate") { return true }
        // Exactly "Guest", or "Guest (n)" with a window count; not "Guest list".
        if label == "guest" || label.hasPrefix("guest (") || label.hasPrefix("guest(") { return true }
        return false
    }
}
