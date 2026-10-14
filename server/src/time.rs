//! JS `Date` equivalents: millisecond clocks and `toISOString()` / `Date.parse()` formats.

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};

pub const HOUR_MS: i64 = 3_600_000;

/// `Date.now()`
pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// `new Date(ms).toISOString()`, e.g. `2026-10-14T12:00:00.000Z`.
pub fn iso(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(|| Utc.timestamp_millis_opt(0).unwrap())
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// `new Date().toISOString()`
pub fn now_iso() -> String {
    iso(now_ms())
}

/// `Date.parse(s)` for the formats the backend sees: RFC 3339 / ISO 8601 with or without offset, and plain
/// dates. Strings without an offset are read as UTC (JS reads date-times without one as local time).
pub fn parse_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.timestamp_millis());
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M"] {
        if let Ok(d) = NaiveDateTime::parse_from_str(s, f) {
            return Some(d.and_utc().timestamp_millis());
        }
    }
    if let Ok(d) = DateTime::parse_from_rfc2822(s) {
        return Some(d.timestamp_millis());
    }
    for f in ["%Y-%m-%d", "%Y-%m", "%Y"] {
        let padded = match f {
            "%Y-%m" => format!("{s}-01"),
            "%Y" => format!("{s}-01-01"),
            _ => s.to_string(),
        };
        if f != "%Y-%m-%d" && !s.chars().all(|c| c.is_ascii_digit() || c == '-') {
            continue;
        }
        if let Ok(d) = NaiveDate::parse_from_str(&padded, "%Y-%m-%d") {
            return Some(d.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_matches_js() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(parse_ms("2026-10-10T12:00:00.000Z"), Some(1_791_633_600_000));
        assert_eq!(iso(parse_ms("2026-10-10T12:00:00.000Z").unwrap()), "2026-10-10T12:00:00.000Z");
        assert!(parse_ms("2026-01-01").is_some());
        assert!(parse_ms("not a date").is_none());
    }
}
