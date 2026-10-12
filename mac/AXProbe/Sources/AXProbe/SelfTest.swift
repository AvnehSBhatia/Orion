import AppKit
import Darwin
import Foundation

// Checks the CPU and memory readings without touching any app's text: burn a
// known amount of CPU in this process and compare proc_pid_rusage with getrusage,
// then read another app's process family.

enum SelfTest {
    static func run() {
        let before = ProcessStats.usage(getpid())
        let reference0 = ownCPUSeconds()
        let start = Date()
        var x = 0.0
        while Date().timeIntervalSince(start) < 0.5 { x += sin(x) + 1 }
        withExtendedLifetime(x) {} // keep the loop from being optimized away
        let reference1 = ownCPUSeconds()
        let after = ProcessStats.usage(getpid())

        guard let before, let after else {
            print("FAIL: proc_pid_rusage could not read this process.")
            exit(1)
        }
        let measured = Double(after.cpuNs - before.cpuNs) / 1e9
        let reference = reference1 - reference0
        let ratio = reference > 0 ? measured / reference : 0
        print("CPU burn: proc_pid_rusage \(Matrix.fmt(measured, 3)) s vs getrusage \(Matrix.fmt(reference, 3)) s (ratio \(Matrix.fmt(ratio, 2)))")
        print("Own memory footprint: \(Matrix.fmt(Double(after.footprintBytes) / 1_048_576)) MB")

        if let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first {
            let pids = ProcessStats.family(finder.processIdentifier)
            let snapshot = ProcessStats.snapshot(pids)
            print("Finder: \(pids.count) process(es), \(snapshot.count) readable, \(Matrix.fmt(ProcessStats.footprintMB(snapshot), 0)) MB")
        }
        if let chrome = NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").first {
            let pids = ProcessStats.family(chrome.processIdentifier)
            let snapshot = ProcessStats.snapshot(pids)
            print("Chrome: \(pids.count) process(es) including helpers, \(snapshot.count) readable, \(Matrix.fmt(ProcessStats.footprintMB(snapshot), 0)) MB, type \(Apps.kind(of: chrome).rawValue)")
        }
        print("Accessibility permission for this terminal: \(AXIsProcessTrusted() ? "granted" : "not granted yet")")
        print(abs(ratio - 1) < 0.15 ? "PASS" : "CHECK: CPU readings disagree by more than 15%")
    }

    static func ownCPUSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        func seconds(_ t: timeval) -> Double { Double(t.tv_sec) + Double(t.tv_usec) / 1e6 }
        return seconds(usage.ru_utime) + seconds(usage.ru_stime)
    }
}
