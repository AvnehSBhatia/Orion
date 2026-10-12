import ApplicationServices
import Foundation

// Walks the focused window's Accessibility tree and measures the text in it
// (spec 5.3). The text is kept in memory only for the length of one walk, to
// dedupe and count it. It is never returned, printed, or written anywhere.

struct WalkResult {
    var foundWindow = false
    var chars = 0 // characters of distinct text kept
    var contentChars = 0 // characters in sentence-like strings (Limits.contentMinWords or more)
    var strings = 0 // distinct non-empty strings
    var nodes = 0
    var ms = 0.0
    var stoppedBy: String? // "depth", "nodes", "time", "chars", or nil if the whole tree fit
    var skippedSecure = 0 // secure text fields skipped without reading their value
    var hasWebArea = false
    var webAreaHasURL = false // browsers: whether AXURL is available for the domain (spec 5.5)
}

enum AXReader {
    // Never read these or anything under them (spec 5.3).
    static let skipRoles: Set<String> = [
        "AXSecureTextField", "AXMenuBar", "AXMenuBarItem", "AXMenu", "AXMenuItem", "AXToolbar",
    ]
    static let skipSubroles: Set<String> = [
        "AXSecureTextField", "AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton",
    ]

    // Read in two steps so a node's role is checked before any of its text is
    // read. That is how secure fields are skipped without ever touching their value.
    static let shapeAttributes = [kAXRoleAttribute, kAXSubroleAttribute, kAXChildrenAttribute] as CFArray
    static let textAttributes = [
        kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXSelectedTextAttribute,
    ] as CFArray

    static func focusedWindow(of app: AXUIElement) -> AXUIElement? {
        for attribute in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
            if let window = element(copy(app, attribute)) { return window }
        }
        if let windows = copy(app, kAXWindowsAttribute) as? [AnyObject], let first = windows.first {
            return element(first)
        }
        return nil
    }

    static func walk(app: AXUIElement) -> WalkResult {
        var result = WalkResult()
        let start = DispatchTime.now()
        func elapsedMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6 }
        defer { result.ms = elapsedMs() }

        guard let window = focusedWindow(of: app) else { return result }
        result.foundWindow = true

        var seen = Set<String>()
        var stack: [(AXUIElement, Int)] = [(window, 0)]

        while let (node, depth) = stack.popLast() {
            if result.nodes >= Limits.maxNodes { result.stoppedBy = "nodes"; break }
            if elapsedMs() >= Limits.maxWalkMs { result.stoppedBy = "time"; break }
            result.nodes += 1

            let shape = copyMultiple(node, shapeAttributes)
            let role = shape[0] as? String ?? ""
            let subrole = shape[1] as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { result.skippedSecure += 1; continue }
            if skipRoles.contains(role) || skipSubroles.contains(subrole) { continue }

            if role == "AXWebArea" {
                result.hasWebArea = true
                if copy(node, kAXURLAttribute) != nil { result.webAreaHasURL = true }
            }

            for value in copyMultiple(node, textAttributes) {
                guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !text.isEmpty, seen.insert(text).inserted else { continue }
                let room = Limits.maxChars - result.chars
                let kept = min(text.count, room)
                result.chars += kept
                result.strings += 1
                if text.split(whereSeparator: \.isWhitespace).count >= Limits.contentMinWords {
                    result.contentChars += kept
                }
                if result.chars >= Limits.maxChars { result.stoppedBy = "chars"; break }
            }
            if result.stoppedBy == "chars" { break }

            guard let children = shape[2] as? [AnyObject], !children.isEmpty else { continue }
            if depth + 1 > Limits.maxDepth { result.stoppedBy = result.stoppedBy ?? "depth"; continue }
            for child in children.reversed() {
                if let child = element(child) { stack.append((child, depth + 1)) }
            }
        }
        return result
    }

    // MARK: Accessibility helpers

    static func copy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
    }

    /// One round trip for several attributes. Missing ones come back as nil.
    static func copyMultiple(_ element: AXUIElement, _ attributes: CFArray) -> [AnyObject?] {
        let count = CFArrayGetCount(attributes)
        var values: CFArray?
        let error = AXUIElementCopyMultipleAttributeValues(element, attributes, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
        guard error == .success, let array = values as? [AnyObject], array.count == count else {
            return Array(repeating: nil, count: count)
        }
        return array.map { isAXError($0) ? nil : $0 }
    }

    static func isAXError(_ value: AnyObject) -> Bool {
        CFGetTypeID(value) == AXValueGetTypeID() && AXValueGetType(unsafeBitCast(value, to: AXValue.self)) == .axError
    }

    static func element(_ value: AnyObject?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(value, to: AXUIElement.self)
    }
}

func axName(_ error: AXError) -> String {
    switch error {
    case .success: return "ok"
    case .attributeUnsupported: return "unsupported"
    case .cannotComplete: return "no reply"
    case .notImplemented: return "not implemented"
    case .apiDisabled: return "no permission"
    case .illegalArgument: return "rejected"
    default: return "error \(error.rawValue)"
    }
}
