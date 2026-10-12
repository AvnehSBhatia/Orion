import AppKit

// Menu bar app with no Dock icon (the spec's LSUIElement = true, set at runtime
// because M1 runs as a plain executable rather than an .app bundle).
let delegate = AppDelegate()
let application = NSApplication.shared
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
