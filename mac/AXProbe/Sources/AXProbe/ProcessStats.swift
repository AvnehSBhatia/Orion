import Darwin
import Foundation

// CPU and memory for an app, including its helper processes. Chromium and
// Electron apps do their accessibility work in renderer helpers, so the main
// process alone would understate the cost of turning the tree on.

struct Usage {
    let cpuNs: UInt64
    let footprintBytes: UInt64
}

enum ProcessStats {
    static let timebase: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    static func usage(_ pid: pid_t) -> Usage? {
        var info = rusage_info_v2()
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V2, $0) }
        }
        guard result == 0 else { return nil }
        // These times are in Mach ticks, which differ from nanoseconds on Apple silicon.
        let ticks = info.ri_user_time + info.ri_system_time
        let ns = ticks * UInt64(timebase.numer) / UInt64(timebase.denom)
        return Usage(cpuNs: ns, footprintBytes: info.ri_phys_footprint)
    }

    /// The app plus its children and grandchildren (Chromium helpers).
    static func family(_ pid: pid_t) -> [pid_t] {
        var all = [pid]
        var frontier = [pid]
        for _ in 0..<2 {
            frontier = frontier.flatMap(children)
            all += frontier
        }
        return Array(Set(all))
    }

    static func children(of pid: pid_t) -> [pid_t] {
        var buffer = [pid_t](repeating: 0, count: 1024)
        let found = buffer.withUnsafeMutableBytes { proc_listchildpids(pid, $0.baseAddress, Int32($0.count)) }
        guard found > 0 else { return [] }
        return buffer.filter { $0 > 0 && $0 != pid }
    }

    static func snapshot(_ pids: [pid_t]) -> [pid_t: Usage] {
        var out: [pid_t: Usage] = [:]
        for pid in pids { out[pid] = usage(pid) }
        return out
    }

    /// Percent of one core, like Activity Monitor, summed over processes alive at both ends.
    static func cpuPercent(from a: [pid_t: Usage], to b: [pid_t: Usage], seconds: Double) -> Double {
        guard seconds > 0 else { return 0 }
        var ns: UInt64 = 0
        for (pid, end) in b {
            if let begin = a[pid], end.cpuNs >= begin.cpuNs { ns += end.cpuNs - begin.cpuNs }
        }
        return Double(ns) / (seconds * 1e9) * 100
    }

    static func footprintMB(_ snapshot: [pid_t: Usage]) -> Double {
        Double(snapshot.values.reduce(0) { $0 + $1.footprintBytes }) / 1_048_576
    }
}
