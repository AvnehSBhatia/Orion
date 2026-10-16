import ApplicationServices
import CaptureCore
import AppKit
import SwiftUI

/// First run (spec 5.1, M4): say in plain words what is read and what is not,
/// and only then open the system permission prompt. One idea per step.
struct OnboardingView: View {
    @ObservedObject var settings: Settings
    let openApps: () -> Void
    let finish: () -> Void

    @State private var step: Int
    @State private var trusted = AXIsProcessTrusted()
    private let poll = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private static let stepCount = 5

    init(settings: Settings, openApps: @escaping () -> Void, finish: @escaping () -> Void, startStep: Int = 0) {
        self.settings = settings
        self.openApps = openApps
        self.finish = finish
        _step = State(initialValue: startStep)
    }

    /// Run from Terminal in this test build, so macOS grants the permission to Terminal.
    private var runningUnbundled: Bool { Bundle.main.bundleIdentifier == nil }

    var body: some View {
        ZStack {
            SpaceBackground()
            if step == 0 {
                welcome
            } else {
                VStack(alignment: .leading, spacing: Theme.Space.l) {
                    Group {
                        switch step {
                        case 1: whatIsRead
                        case 2: permission
                        case 3: sharing
                        default: chooseApps
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                    HStack(spacing: Theme.Space.s) {
                        progress
                        Spacer()
                        Button("Back") { step -= 1 }.buttonStyle(GhostButtonStyle())
                        if step < Self.stepCount - 1 {
                            Button("Continue") { step += 1 }.buttonStyle(PrimaryButtonStyle()).keyboardShortcut(.defaultAction)
                        } else {
                            Button("Done") {
                                settings.onboardingDone = true
                                finish()
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                }
                .frame(maxWidth: 760)
                .padding(.horizontal, 40)
                .padding(.top, Theme.titlebarInset + Theme.Space.l)
                .padding(.bottom, Theme.windowPadding)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .font(Theme.Typo.body)
        .tint(Theme.accent)
        .preferredColorScheme(.dark)
        .onReceive(poll) { _ in trusted = AXIsProcessTrusted() }
    }

    // MARK: Steps

    private func stepHeader(_ title: String, _ line: String, info: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            Text(title).font(Theme.Typo.windowTitle)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(line).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                if let info { InfoButton(text: info) }
            }
            ConstellationDivider()
        }
    }

    private var progress: some View {
        HStack(spacing: 10) {
            Text(String(format: "%02d  /  %02d", step + 1, Self.stepCount))
                .font(Theme.Typo.monoSmall)
                .foregroundStyle(Theme.textSecondary)
            StepDots(current: step, count: Self.stepCount)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.cardFill, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border))
        .accessibilityElement(children: .combine)
    }

    private var welcome: some View {
        HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: Theme.Space.l) {
                Text("Less admin. More orbit.")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.2)
                    .foregroundStyle(Theme.accent)
                    .textCase(.uppercase)
                Text("Welcome to Constellation")
                    .font(Theme.Typo.windowTitle)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Your daily time entries, mostly written for you.")
                    .font(Theme.Typo.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ConstellationDivider()
                Text("A little less remembering. The timesheet is written from the work you already did, and you decide what leaves this Mac.")
                    .font(Theme.Typo.subtitle)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Theme.Space.l)
                progress
                Button("Continue") { step = 1 }
                    .buttonStyle(PrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
                Text("Made for your Mac")
                    .font(Theme.Typo.sectionHeader)
                    .kerning(1.1)
                    .foregroundStyle(Theme.textTertiary)
                    .textCase(.uppercase)
            }
            .padding(.leading, 40)
            .padding(.trailing, 12)
            .padding(.top, Theme.titlebarInset + 12)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

            ZStack(alignment: .bottomLeading) {
                Theme.welcomePanel
                PlanetPortrait()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                LinearGradient(colors: [.clear, Theme.welcomePanel.opacity(0.92)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Constellation  /  001")
                        .font(Theme.Typo.sectionHeader)
                        .kerning(1.1)
                        .foregroundStyle(Theme.textTertiary)
                        .textCase(.uppercase)
                    Text("Find your time. Keep your focus.")
                        .font(.system(size: 18, weight: .regular))
                    Text("A quieter way to keep track.")
                        .font(Theme.Typo.sectionHeader)
                        .kerning(1.1)
                        .foregroundStyle(Theme.textSecondary)
                        .textCase(.uppercase)
                }
                .padding(24)
            }
            .frame(maxWidth: 380)
            .frame(maxHeight: .infinity)
            .background(Theme.welcomePanel)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.top, Theme.titlebarInset)
            .padding(.trailing, 20)
            .padding(.bottom, 20)
        }
    }

    private var whatIsRead: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            stepHeader(
                "What It Reads",
                "Only what you choose, only while it's in front.",
                info: "Before anything is kept, card numbers and keys are always replaced with markers like [CARD], and by default so are emails, phone numbers, and street addresses. You can change those under Privacy. Nothing is kept unencrypted."
            )
            GlassCard {
                HStack(alignment: .top, spacing: Theme.Space.xl) {
                    list("Reads", symbol: "checkmark.circle.fill", color: Theme.success, items: [
                        "Window text, for apps you turn on",
                        "Window titles",
                        "Browsers: tab title and address only",
                    ])
                    list("Never reads", symbol: "xmark.circle.fill", color: Theme.danger, items: [
                        "Screenshots of your screen",
                        "Passwords and password managers",
                        "Private and incognito windows",
                        "Anything while paused or locked",
                    ])
                }
            }
        }
    }

    private var permission: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            stepHeader(
                "Allow Reading Windows",
                "macOS calls this Accessibility permission.",
                info: "It lets an app read the text of other apps' windows. You can turn it off any time in System Settings > Privacy & Security > Accessibility."
            )
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    HStack(spacing: Theme.Space.m) {
                        GlowDot(color: trusted ? Theme.success : Theme.warning)
                        Text(trusted ? "Allowed" : "Not allowed yet").font(Theme.Typo.bodyStrong)
                        Spacer()
                        Button("Open System Settings") { requestPermission() }
                            .buttonStyle(PrimaryButtonStyle(small: true))
                            .disabled(trusted)
                    }
                    if runningUnbundled {
                        Text("This test version runs from Terminal, so turn on Terminal in the list, then quit and reopen Terminal.")
                            .font(Theme.Typo.caption).foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var sharing: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            stepHeader(
                "You Decide What's Shared",
                "Finished work waits in the Outbox first.",
                info: "In the Outbox you read your company's AI summary of each batch and exactly what was captured, and can edit or delete it. To write the summary, your company's server reads the batch's cleaned text but keeps nothing until you approve. You can change this choice any time there."
            )
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    Picker("", selection: $settings.outboxMode) {
                        Text("Review first: I approve everything before it is sent").tag(OutboxMode.reviewFirst)
                        Text("Log only: send automatically and show me what was sent").tag(OutboxMode.logOnly)
                    }
                    .pickerStyle(.radioGroup)
                    .labelsHidden()
                    if settings.outboxMode == .reviewFirst {
                        Toggle("Auto-approve after \(Limits.autoApproveMinutes) minutes", isOn: $settings.autoApprove)
                            .toggleStyle(.switch)
                            .controlSize(.small)
                    }
                }
            }
        }
    }

    private var chooseApps: some View {
        VStack(alignment: .leading, spacing: Theme.Space.l) {
            stepHeader(
                "Choose Your Apps",
                "Every app starts off.",
                info: "The eye in your menu bar always shows whether capture is on, paused, or off. Pause is there. Delete all data is in Settings."
            )
            GlassCard {
                VStack(alignment: .leading, spacing: Theme.Space.m) {
                    HStack {
                        Text("Turn on the apps you work in")
                        Spacer()
                        Button("Open App List", action: openApps).buttonStyle(GhostButtonStyle(small: true))
                    }
                    Toggle("Start capturing now", isOn: $settings.captureOn).toggleStyle(.switch).controlSize(.small)
                }
            }
        }
    }

    private func list(_ title: String, symbol: String, color: Color, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s) {
            Label(title, systemImage: symbol).font(Theme.Typo.bodyStrong).foregroundStyle(color)
            ForEach(items, id: \.self) { item in
                Text(item).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func requestPermission() {
        // The system prompt, shown only now, after the explanation.
        AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}

/// Five dots. The current step is the accent.
private struct StepDots: View {
    let current: Int
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Circle()
                    .fill(index == current ? Theme.accent : Theme.border)
                    .frame(width: 6, height: 6)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Step \(current + 1) of \(count)")
    }
}
