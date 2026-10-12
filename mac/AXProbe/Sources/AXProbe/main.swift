import ApplicationServices
import Foundation

// M0 capture probe for Constellation for Mac (spec section 12).
// Prints numbers only. Captured text never leaves memory and is never written to disk.

let usage = """
Usage: ax-probe <command>

  matrix [--apps "Safari,Chrome"]   Guided run over the spec's app list (or your own), then the coverage table.
  once                              Measure whatever app is in front after a 5 second countdown.
  selftest                          Check that CPU and memory readings work. Reads no app text.
"""

let arguments = Array(CommandLine.arguments.dropFirst())

func option(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func requireAccessibility() {
    let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(prompt) else {
        print("""
        Accessibility permission is needed.
        Open System Settings > Privacy & Security > Accessibility and turn on the app you are
        running this from (for example Terminal). Quit and reopen that app, then run this again.
        """)
        exit(1)
    }
}

switch arguments.first {
case "matrix":
    requireAccessibility()
    let targets = option("--apps")?
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    Matrix.run(targets: targets ?? Matrix.defaultTargets)
case "once":
    requireAccessibility()
    Matrix.runOnce()
case "selftest":
    SelfTest.run()
default:
    print(usage)
}
