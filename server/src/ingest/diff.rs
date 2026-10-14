//! Port of `src/ingest/diff.ts` (48ff660): change-aware captures. STUB. Tests: `src/ingest/diff.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

pub const MAX_DIFF_CHARS: usize = 3_000;
pub const MAX_LINE_CHARS: usize = 240;
pub const MAX_LCS_LINES: usize = 1_500;
pub const MAX_CHANGED_SHARE: f64 = 0.6;
pub const HEADER: &str = "What changed since the last capture (at ";
pub const PAGE_MARK: &str = "\n\nPage now:\n";

/// A line with volatile bits (times, counters) masked, for comparing captures.
pub fn quiet(line: &str) -> String {
    todo!("port quiet from src/ingest/diff.ts")
}

pub fn same_page(a: &str, b: &str) -> bool {
    todo!("port samePage from src/ingest/diff.ts")
}

/// A short line diff of two captures of one page, or None when they are the same or too different.
pub fn page_diff(prev: &str, next: &str, prev_truncated: bool) -> Option<String> {
    todo!("port pageDiff from src/ingest/diff.ts")
}

pub fn with_changes(page: &str, diff: Option<&str>, since: &str) -> String {
    todo!("port withChanges from src/ingest/diff.ts")
}

/// The page text of a stored source that may carry a diff header.
pub fn page_of(stored: &str) -> String {
    todo!("port pageOf from src/ingest/diff.ts")
}
