import ApplicationServices
import CaptureCore
import AppKit
import SwiftUI

/// First run (spec 5.1, M4): say in plain words what is read and what is not,
/// and only then open the system permission prompt.
struct OnboardingView: View {
    @ObservedObject var settings: Settings
    let openApps: () -> Void
    let finish: () -> Void

    @State private var step = 0
    @State private var trusted = AXIsProcessTrusted()
    private let poll = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private static let stepCount = 5

    /// Run from Terminal in this test build, so macOS grants the permission to Terminal.
    private var runningUnbundled: Bool { Bundle.main.bundleIdentifier == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Group {
                switch step {
                case 0: welcome
                case 1: whatIsRead
                case 2: permission
                case 3: sharing
                default: chooseApps
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            HStack {
                StepDots(current: step, count: Self.stepCount)
                Spacer()
                if step > 0 { Button("Back") { step -= 1 } }
                if step < Self.stepCount - 1 {
                    Button("Continue") { step += 1 }.keyboardShortcut(.defaultAction)
                } else {
                    Button("Done") {
                        settings.onboardingDone = true
                        finish()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(28)
        .frame(width: 560, height: 470)
        .onReceive(poll) { _ in trusted = AXIsProcessTrusted() }
    }

    // MARK: Steps

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "eye").font(.system(size: 34)).foregroundStyle(.secondary)
            Text("Welcome to Constellation").font(.title.bold())
            Text("Constellation keeps track of the work you do on this Mac, so your daily time entries can mostly write themselves.")
            Text("It reads the text in the apps you choose, cleans out private details on this Mac, and keeps it encrypted here. You decide what is shared.")
            Text("The next two screens explain exactly what it reads, then ask macOS for permission.")
                .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var whatIsRead: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("What Constellation reads").font(.title2.bold())
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Reads", systemImage: "checkmark.circle").font(.headline).foregroundStyle(.green)
                    Bullet("Text in the window in front, only for apps you turn on")
                    Bullet("Window titles")
                    Bullet("For browsers: the tab title and the web address, without anything after ? or #. Never the page itself")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Label("Never reads", systemImage: "xmark.circle").font(.headline).foregroundStyle(.red)
                    Bullet("Screenshots or pictures of your screen")
                    Bullet("Password fields, password managers, Keychain, System Settings")
                    Bullet("Private and incognito windows")
                    Bullet("Apps you haven't turned on, or anything while paused or locked")
                }
            }
            Text("Before anything is kept, emails, phone numbers, card numbers, and keys are replaced with markers like [EMAIL]. What's kept is encrypted on this Mac. Nothing is sent anywhere in this version.")
                .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var permission: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Allow Constellation to read windows").font(.title2.bold())
            Text("macOS calls this Accessibility permission. It lets an app read the text of other apps' windows. Constellation uses it only as described on the last screen.")
            if runningUnbundled {
                Text("This test version runs from Terminal, so macOS lists **Terminal** rather than Constellation. Turn on Terminal, then quit and reopen it.")
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Button("Open System Settings") { requestPermission() }
                    .disabled(trusted)
                Label(trusted ? "Allowed" : "Not allowed yet", systemImage: trusted ? "checkmark.circle.fill" : "circle.dashed")
                    .foregroundStyle(trusted ? .green : .secondary)
            }
            Text("You can turn this off any time in System Settings > Privacy & Security > Accessibility.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var sharing: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("You decide what is shared").font(.title2.bold())
            Text("Finished work goes to the Outbox first, where you can read exactly what would be sent, edit it, or delete it.")
            Picker("", selection: $settings.outboxMode) {
                Text("Review first: I approve before anything is sent").tag(OutboxMode.reviewFirst)
                Text("Log only: send automatically, and show me what was sent").tag(OutboxMode.logOnly)
            }
            .pickerStyle(.radioGroup)
            .labelsHidden()
            if settings.outboxMode == .reviewFirst {
                Toggle("Approve automatically after \(Limits.autoApproveMinutes) minutes if I haven't looked", isOn: $settings.autoApprove)
            }
            Text("You can change this any time in the Outbox. Nothing is sent anywhere in this version yet.")
                .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var chooseApps: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Choose your apps").font(.title2.bold())
            Text("Every app starts off. Turn on the ones you work in, for example Mail, Safari, or VS Code.")
            Button("Open the app list", action: openApps)
            Toggle("Start capturing now", isOn: $settings.captureOn).toggleStyle(.switch)
            Text("The eye in your menu bar always shows whether capture is on, paused, or off. Pause and Delete all are one click there.")
                .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func requestPermission() {
        // The system prompt, shown only now, after the explanation.
        AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}

private struct Bullet: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Text("•")
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct StepDots: View {
    let current: Int
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Circle()
                    .fill(index == current ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(width: 7, height: 7)
            }
        }
    }
}
