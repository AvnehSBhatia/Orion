import ApplicationServices
import Foundation

// `ax-probe layout`: the structure of the front window, to find where an app
// keeps its main content (Mail's open email, an editor's document). Prints roles,
// developer identifiers, character counts, and selection or focus markers.
// Never prints any text the window shows.

enum Layout {
    static let maxDepth = 25
    static let maxNodes = 4_000
    static let listShown = 3 // children printed before the rest of a long list is summarised

    final class Walk {
        var nodes = 0
        var focused: AXUIElement?
    }

    struct Node {
        var role = "?"
        var subrole = ""
        var identifier = ""
        var ownChars = 0
        var subtreeChars = 0
        var selected = false
        var isFocused = false
        var children: [Node] = []
        var hiddenChildren = 0 // past maxNodes or maxDepth
    }

    static func run() {
        Matrix.countdown("the app and window to map")
        guard let front = Apps.frontmost() else { print("Could not tell which app is in front."); return }
        let app = AXUIElementCreateApplication(front.pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        guard let window = AXReader.focusedWindow(of: app) else { print("\(front.name) has no focused window."); return }

        let walk = Walk()
        walk.focused = AXReader.element(AXReader.copy(app, kAXFocusedUIElementAttribute))
        let root = build(window, depth: 0, walk: walk)

        print("\nLayout of \(front.name)'s front window (\(front.kind.rawValue)). Character counts only; no text is shown.")
        print("own = characters on that element, all = including everything inside it. [selected] / [focused] mark the selection and keyboard focus.\n")
        printNode(root, indent: 0)
        print("\n\(walk.nodes) elements read.\(walk.nodes >= maxNodes ? " Stopped at the \(maxNodes) element limit." : "")")
    }

    static func build(_ element: AXUIElement, depth: Int, walk: Walk) -> Node {
        walk.nodes += 1
        var node = Node()
        let attributes = AXReader.copyMultiple(element, [
            kAXRoleAttribute, kAXSubroleAttribute, kAXIdentifierAttribute, kAXSelectedAttribute, kAXChildrenAttribute,
        ] as CFArray)
        node.role = attributes[0] as? String ?? "?"
        node.subrole = attributes[1] as? String ?? ""
        node.identifier = attributes[2] as? String ?? ""
        node.selected = (attributes[3] as? Bool) == true
        if let focused = walk.focused { node.isFocused = CFEqual(focused, element) }

        // Secure fields: counted as zero, never read.
        if node.role != "AXSecureTextField" && node.subrole != "AXSecureTextField" {
            let text = AXReader.copyMultiple(element, [
                kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
            ] as CFArray)
            node.ownChars = text.compactMap { ($0 as? String)?.count }.reduce(0, +)
        }
        node.subtreeChars = node.ownChars

        let children = (attributes[4] as? [AnyObject])?.compactMap(AXReader.element) ?? []
        for child in children {
            guard depth + 1 <= maxDepth, walk.nodes < maxNodes else {
                node.hiddenChildren += 1
                continue
            }
            let built = build(child, depth: depth + 1, walk: walk)
            node.subtreeChars += built.subtreeChars
            node.children.append(built)
        }
        return node
    }

    static func printNode(_ node: Node, indent: Int) {
        var line = String(repeating: "  ", count: indent) + node.role
        if !node.subrole.isEmpty { line += " [\(node.subrole)]" }
        if !node.identifier.isEmpty { line += " id=\(node.identifier)" }
        line += "  own=\(node.ownChars) all=\(node.subtreeChars)"
        if node.children.count + node.hiddenChildren > 0 { line += " children=\(node.children.count + node.hiddenChildren)" }
        if node.selected { line += " [selected]" }
        if node.isFocused { line += " [focused]" }
        print(line)

        // Long runs of similar children (list rows, table cells) are summarised.
        let shown = node.children.count > listShown * 2 ? Array(node.children.prefix(listShown)) : node.children
        for child in shown { printNode(child, indent: indent + 1) }
        let rest = node.children.dropFirst(shown.count)
        if !rest.isEmpty {
            let roles = Dictionary(grouping: rest, by: \.role).map { "\($0.value.count) \($0.key)" }.sorted().joined(separator: ", ")
            let chars = rest.reduce(0) { $0 + $1.subtreeChars }
            let marks = rest.contains(where: containsMark) ? " (includes the selected or focused element; expanded below)" : ""
            print(String(repeating: "  ", count: indent + 1) + "… \(rest.count) more: \(roles), all=\(chars)\(marks)")
            for child in rest where containsMark(child) { printNode(child, indent: indent + 1) }
        }
        if node.hiddenChildren > 0 {
            print(String(repeating: "  ", count: indent + 1) + "… \(node.hiddenChildren) not read (limit)")
        }
    }

    static func containsMark(_ node: Node) -> Bool {
        node.selected || node.isFocused || node.children.contains(where: containsMark)
    }
}
