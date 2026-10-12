import ApplicationServices
import Foundation

// Walks the focused window's Accessibility tree for its text (spec 5.3).
// Carried over from the M0 probe, which measured it across apps.

public struct TextWalk: Sendable {
    public var lines: [String] = [] // distinct, trimmed, in reading order
    public var chars = 0
    public var nodes = 0
    public var stoppedBy: String? // "depth", "nodes", "time", "chars", or nil
    public var secureSkipped = 0
}

public enum AXReader {
    // Never read these or anything under them (spec 5.3).
    static let skipRoles: Set<String> = [
        "AXSecureTextField", "AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem", "AXToolbar",
    ]
    static let skipSubroles: Set<String> = [
        "AXSecureTextField", "AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton",
    ]

    // Two steps per node, so a node's role is checked before any of its text is
    // read. That is how secure fields are skipped without touching their value.
    static let shapeAttributes = [kAXRoleAttribute, kAXSubroleAttribute, kAXChildrenAttribute]
    static let textAttributes = [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXSelectedTextAttribute]

    public static func focusedWindow(of app: AXUIElement) -> AXUIElement? {
        for attribute in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
            if let window = element(copy(app, attribute)) { return window }
        }
        return nil
    }

    public static func title(of window: AXUIElement) -> String? {
        copy(window, kAXTitleAttribute) as? String
    }

    /// `start` is when the whole read began; the time budget covers all of it.
    public static func walkText(_ window: AXUIElement, start: DispatchTime) -> TextWalk {
        var walk = TextWalk()
        var seen = Set<String>()
        var stack: [(AXUIElement, Int)] = [(window, 0)]

        outer: while let (node, depth) = stack.popLast() {
            if walk.nodes >= Limits.maxNodes { walk.stoppedBy = "nodes"; break }
            if elapsedMs(since: start) >= Limits.maxWalkMs { walk.stoppedBy = "time"; break }
            walk.nodes += 1

            let shape = copyMultiple(node, shapeAttributes)
            let role = shape[0] as? String ?? ""
            let subrole = shape[1] as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { walk.secureSkipped += 1; continue }
            if skipRoles.contains(role) || skipSubroles.contains(subrole) { continue }

            for value in copyMultiple(node, textAttributes) {
                guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !text.isEmpty, seen.insert(text).inserted else { continue }
                let room = Limits.maxSnapshotChars - walk.chars
                let kept = text.count <= room ? text : String(text.prefix(room))
                walk.lines.append(kept)
                walk.chars += kept.count
                if walk.chars >= Limits.maxSnapshotChars { walk.stoppedBy = "chars"; break outer }
            }

            guard let children = shape[2] as? [AnyObject], !children.isEmpty else { continue }
            if depth + 1 > Limits.maxDepth { walk.stoppedBy = walk.stoppedBy ?? "depth"; continue }
            for child in children.reversed() {
                if let child = element(child) { stack.append((child, depth + 1)) }
            }
        }
        return walk
    }

    public static func elapsedMs(since start: DispatchTime) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6
    }

    // MARK: Accessibility helpers

    public static func copy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
    }

    /// One round trip for several attributes. Missing ones come back as nil.
    static func copyMultiple(_ element: AXUIElement, _ attributes: [String]) -> [AnyObject?] {
        let count = attributes.count
        var values: CFArray?
        let error = AXUIElementCopyMultipleAttributeValues(
            element, attributes as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values
        )
        guard error == .success, let array = values as? [AnyObject], array.count == count else {
            return Array(repeating: nil, count: count)
        }
        return array.map { isAXError($0) ? nil : $0 }
    }

    static func isAXError(_ value: AnyObject) -> Bool {
        CFGetTypeID(value) == AXValueGetTypeID() && AXValueGetType(unsafeDowncast(value, to: AXValue.self)) == .axError
    }

    public static func element(_ value: AnyObject?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }
}
