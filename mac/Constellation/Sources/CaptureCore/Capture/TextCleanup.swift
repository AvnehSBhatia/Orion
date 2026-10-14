import Foundation

// Tidies what a read returns before it is redacted and stored: the browser's own
// name and profile come off window titles, lines that only repeat the title go,
// and lines broken around a link are put back together.

public enum TextCleanup {
    static let browserNames = ["Google Chrome", "Microsoft Edge", "Brave", "Arc", "Mozilla Firefox", "Firefox", "Safari"]
    static let separators = [" - ", " – ", " — "]

    /// "Pricing - Google Chrome - Veer" becomes "Pricing". Chrome adds its name and
    /// the profile name (often the person's own) to every window title.
    public static func browserTitle(_ title: String, appName: String) -> String {
        var cut = title.endIndex
        for name in [appName] + browserNames where !name.isEmpty {
            for separator in separators {
                if let range = title.range(of: separator + name, options: [.caseInsensitive, .backwards]),
                   range.lowerBound < cut {
                    cut = range.lowerBound
                }
            }
        }
        let kept = title[..<cut].trimmingCharacters(in: .whitespaces)
        return kept.isEmpty ? title : kept
    }

    /// Lines that are just the title or a part of it ("Subject — Sender"): the
    /// record already has them as its title.
    public static func dropTitleLines(_ lines: [String], title: String) -> [String] {
        let parts = Set(([title] + title.components(separatedBy: " — "))
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { $0.count >= 3 })
        guard !parts.isEmpty else { return lines }
        return lines.filter { !parts.contains($0.trimmingCharacters(in: .whitespaces).lowercased()) }
    }

    /// Apps expose text in runs, so a sentence with a link in it arrives as
    /// "Your Apple ID (" and ") was used to sign in". Joins a line onto the one
    /// before when it starts with closing punctuation or the one before ends open.
    public static func joinFragments(_ lines: [String]) -> [String] {
        var out: [String] = []
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            if let last = out.last, let first = line.first, let end = last.last,
               ")],.;:!?".contains(first) || "([".contains(end) {
                out[out.count - 1] = tidy(last + line)
            } else {
                out.append(line)
            }
        }
        return out
    }

    /// Empty brackets left where a link was, and the doubled spaces around them.
    private static func tidy(_ text: String) -> String {
        var text = text.replacingOccurrences(of: "()", with: "").replacingOccurrences(of: "( )", with: "")
            .replacingOccurrences(of: "[]", with: "")
        while text.contains("  ") { text = text.replacingOccurrences(of: "  ", with: " ") }
        return text
    }
}
