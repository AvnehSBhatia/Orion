//! Port of `src/contract/schemas.ts`: request validation with the zod rules, defaults, transforms, and
//! clamping, and zod v4's exact English messages. A failure is the first issue zod would report, rendered the
//! way `src/server/http.ts` did: `"path.to.field: message"` (no prefix when the path is empty).
//!
//! Inputs are `serde_json::Value`s: the parsed JSON body, or [`query_value`] for `?a=b` params (strings, so
//! numeric fields coerce like `z.coerce.number()`).
//!
//! Difference from TS: `orgId` no longer defaults to "demo"; it stays `None` and the route picks the session's org.

use std::collections::{HashMap, HashSet};
use std::fmt;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use super::types::*;
use crate::text::{js_len, js_take, js_trim, js_trim_end};

pub const MAX_HTML_CHARS: usize = 60_000;
pub const MAX_SCREENSHOT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_CODE_FILES: usize = 30;
pub const MAX_DIFF_CHARS: usize = 4_000;
pub const MAX_ROLE_CHARS: usize = 400;
pub const DEFAULT_ORG: &str = "demo";
pub const MAX_CODE_CARDS: usize = 20;
/// One earlier turn of the conversation, so follow-ups like "how would you fix this?" resolve.
pub const MAX_HISTORY: usize = 6;
pub const HISTORY_CHARS: usize = 600;
pub const MAX_ORG_WEBSITES: usize = 40;
pub const MAX_ORG_TEXT: usize = 2_000;
pub const MAX_WIDGETS: usize = 12;

pub const ID_PATTERN: &str = r"^[a-z0-9][a-z0-9-]{0,39}$";
pub static ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(ID_PATTERN).unwrap());

// ---- Errors ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathSeg {
    Key(String),
    Index(usize),
}

impl fmt::Display for PathSeg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathSeg::Key(k) => f.write_str(k),
            PathSeg::Index(i) => write!(f, "{i}"),
        }
    }
}

/// The first validation issue, like `ZodError.issues[0]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub path: Vec<PathSeg>,
    pub message: String,
}

impl ValidationError {
    pub fn new(path: &[PathSeg], message: impl Into<String>) -> Self {
        ValidationError { path: path.to_vec(), message: message.into() }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            return f.write_str(&self.message);
        }
        let joined: Vec<String> = self.path.iter().map(|p| p.to_string()).collect();
        write!(f, "{}: {}", joined.join("."), self.message)
    }
}

impl std::error::Error for ValidationError {}

pub type VResult<T> = Result<T, ValidationError>;

// ---- Primitive checks with zod's messages ----

fn type_name(v: Option<&Value>) -> &'static str {
    match v {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn invalid_type(path: &[PathSeg], expected: &str, got: Option<&Value>) -> ValidationError {
    ValidationError::new(path, format!("Invalid input: expected {expected}, received {}", type_name(got)))
}

fn join(path: &[PathSeg], seg: PathSeg) -> Vec<PathSeg> {
    let mut p = path.to_vec();
    p.push(seg);
    p
}

fn key(path: &[PathSeg], k: &str) -> Vec<PathSeg> {
    join(path, PathSeg::Key(k.to_string()))
}

fn object<'a>(v: Option<&'a Value>, path: &[PathSeg]) -> VResult<&'a Map<String, Value>> {
    match v {
        Some(Value::Object(m)) => Ok(m),
        other => Err(invalid_type(path, "object", other)),
    }
}

fn string(v: Option<&Value>, path: &[PathSeg]) -> VResult<String> {
    match v {
        Some(Value::String(s)) => Ok(s.clone()),
        other => Err(invalid_type(path, "string", other)),
    }
}

/// `.optional()`: absent is None; present must pass `f` (null fails).
fn optional<T>(v: Option<&Value>, f: impl FnOnce(&Value) -> VResult<T>) -> VResult<Option<T>> {
    match v {
        None => Ok(None),
        Some(x) => f(x).map(Some),
    }
}

fn min_chars(s: &str, n: usize, path: &[PathSeg], msg: Option<&str>) -> VResult<()> {
    if js_len(s) < n {
        return Err(ValidationError::new(
            path,
            msg.map(String::from).unwrap_or_else(|| format!("Too small: expected string to have >={n} characters")),
        ));
    }
    Ok(())
}

fn max_chars(s: &str, n: usize, path: &[PathSeg], msg: Option<&str>) -> VResult<()> {
    if js_len(s) > n {
        return Err(ValidationError::new(
            path,
            msg.map(String::from).unwrap_or_else(|| format!("Too big: expected string to have <={n} characters")),
        ));
    }
    Ok(())
}

fn max_items(len: usize, n: usize, path: &[PathSeg], msg: Option<&str>) -> VResult<()> {
    if len > n {
        return Err(ValidationError::new(
            path,
            msg.map(String::from).unwrap_or_else(|| format!("Too big: expected array to have <={n} items")),
        ));
    }
    Ok(())
}

fn array<'a>(v: Option<&'a Value>, path: &[PathSeg]) -> VResult<&'a Vec<Value>> {
    match v {
        Some(Value::Array(a)) => Ok(a),
        other => Err(invalid_type(path, "array", other)),
    }
}

fn boolean(v: Option<&Value>, path: &[PathSeg]) -> VResult<bool> {
    match v {
        Some(Value::Bool(b)) => Ok(*b),
        other => Err(invalid_type(path, "boolean", other)),
    }
}

fn number(v: Option<&Value>, path: &[PathSeg]) -> VResult<f64> {
    match v {
        Some(Value::Number(n)) => Ok(n.as_f64().unwrap_or(f64::NAN)),
        other => Err(invalid_type(path, "number", other)),
    }
}

fn joined_options(names: &[&str]) -> String {
    names.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join("|")
}

/// `z.enum(values)`
fn enum_of<T: Copy>(v: Option<&Value>, path: &[PathSeg], names: &[&str], parse: fn(&str) -> Option<T>) -> VResult<T> {
    match v {
        Some(Value::String(s)) => parse(s).ok_or_else(|| ValidationError::new(path, format!("Invalid option: expected one of {}", joined_options(names)))),
        // zod v4 reports a non-string enum input as invalid_value too.
        _ => Err(ValidationError::new(path, format!("Invalid option: expected one of {}", joined_options(names)))),
    }
}

fn regex_check(s: &str, re: &Regex, path: &[PathSeg], msg: Option<&str>) -> VResult<()> {
    if re.is_match(s) {
        return Ok(());
    }
    let m = msg.map(String::from).unwrap_or_else(|| format!("Invalid string: must match pattern /{}/", re.as_str()));
    Err(ValidationError::new(path, m))
}

/// `Number(value)` for a coerced query param.
pub fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Null => 0.0,
        Value::String(s) => {
            let t = js_trim(s);
            if t.is_empty() {
                return 0.0;
            }
            let lower = t.to_ascii_lowercase();
            for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
                if let Some(digits) = lower.strip_prefix(prefix) {
                    return i64::from_str_radix(digits, radix).map(|n| n as f64).unwrap_or(f64::NAN);
                }
            }
            match t {
                "Infinity" | "+Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                _ if lower.contains("inf") || lower.contains("nan") => f64::NAN,
                _ => t.parse::<f64>().unwrap_or(f64::NAN),
            }
        }
        Value::Array(_) | Value::Object(_) => f64::NAN,
    }
}

/// Rules of one coerced number field, checked in zod's order: type, int, then bounds.
struct NumRules {
    int: bool,
    /// (bound, inclusive)
    min: Option<(f64, bool)>,
    max: Option<f64>,
}

fn coerced_number(v: Option<&Value>, path: &[PathSeg], rules: NumRules) -> VResult<f64> {
    let n = v.map(js_number).unwrap_or(f64::NAN);
    if n.is_nan() {
        return Err(ValidationError::new(path, "Invalid input: expected number, received NaN"));
    }
    if n.is_infinite() {
        let shown = if n > 0.0 { "Infinity" } else { "-Infinity" };
        return Err(ValidationError::new(path, format!("Invalid input: expected number, received {shown}")));
    }
    if rules.int && (n.fract() != 0.0 || n.abs() > 9_007_199_254_740_991.0) {
        return Err(ValidationError::new(path, "Invalid input: expected int, received number"));
    }
    if let Some((min, inclusive)) = rules.min {
        if (inclusive && n < min) || (!inclusive && n <= min) {
            let adj = if inclusive { ">=" } else { ">" };
            return Err(ValidationError::new(path, format!("Too small: expected number to be {adj}{}", fmt_num(min))));
        }
    }
    if let Some(max) = rules.max {
        if n > max {
            return Err(ValidationError::new(path, format!("Too big: expected number to be <={}", fmt_num(max))));
        }
    }
    Ok(n)
}

fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() }
}

/// `z.string().trim().min(min, msg).max(max)` -> the trimmed string.
fn trimmed(v: Option<&Value>, path: &[PathSeg], min: usize, min_msg: Option<&str>, max: usize) -> VResult<String> {
    let s = js_trim(&string(v, path)?).to_string();
    min_chars(&s, min, path, min_msg)?;
    max_chars(&s, max, path, None)?;
    Ok(s)
}

/// The shared `orgId` field (regex checked; omitted stays None).
pub fn org_id_field(v: Option<&Value>, path: &[PathSeg]) -> VResult<Option<String>> {
    optional(v, |x| {
        let p = key(path, "orgId");
        let s = string(Some(x), &p)?;
        regex_check(&s, &ID_RE, &p, Some("orgId must be lowercase letters, digits, and dashes"))?;
        Ok(s)
    })
}

/// Validates a bare org id (route params like `/api/orgs/:orgId`), same rule and message as `orgId`.
pub fn org_id(s: &str) -> VResult<String> {
    regex_check(s, &ID_RE, &[], Some("orgId must be lowercase letters, digits, and dashes"))?;
    Ok(s.to_string())
}

fn user_id_field(m: &Map<String, Value>) -> VResult<String> {
    let p = key(&[], "userId");
    let s = string(m.get("userId"), &p)?;
    min_chars(&s, 1, &p, None)?;
    Ok(s)
}

/// `Object.fromEntries(searchParams)` as a JSON object of strings (the last value of a repeated key wins).
pub fn query_value(params: &[(String, String)]) -> Value {
    let mut m = Map::new();
    for (k, v) in params {
        m.insert(k.clone(), Value::String(v.clone()));
    }
    Value::Object(m)
}

/// Same, from a map.
pub fn query_value_map(params: &HashMap<String, String>) -> Value {
    Value::Object(params.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect())
}

// ---- Request schemas ----

fn rect(v: &Value, path: &[PathSeg]) -> VResult<Rect> {
    let m = object(Some(v), path)?;
    Ok(Rect {
        x: number(m.get("x"), &key(path, "x"))?,
        y: number(m.get("y"), &key(path, "y"))?,
        w: number(m.get("w"), &key(path, "w"))?,
        h: number(m.get("h"), &key(path, "h"))?,
    })
}

static DATA_URL_PREFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^data:image/\w+;base64,").unwrap());

pub fn capture_request(v: &Value) -> VResult<CaptureRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let p = key(&[], "url");
    let url = string(m.get("url"), &p)?;
    min_chars(&url, 1, &p, None)?;
    let title = match m.get("title") {
        None => String::new(),
        x => string(x, &key(&[], "title"))?,
    };
    let p = key(&[], "html");
    let html = string(m.get("html"), &p)?;
    max_chars(&html, MAX_HTML_CHARS, &p, Some(&format!("html must be at most {MAX_HTML_CHARS} characters")))?;
    let p = key(&[], "screenshotB64");
    let shot = match m.get("screenshotB64") {
        None => String::new(),
        x => string(x, &p)?,
    };
    let shot = DATA_URL_PREFIX.replace(&shot, "").into_owned();
    if js_len(&shot) * 3 / 4 > MAX_SCREENSHOT_BYTES {
        return Err(ValidationError::new(&p, "screenshot must be at most 2MB"));
    }
    let p = key(&[], "redactions");
    let redactions = optional(m.get("redactions"), |x| {
        array(Some(x), &p)?.iter().enumerate().map(|(i, r)| rect(r, &join(&p, PathSeg::Index(i)))).collect()
    })?;
    Ok(CaptureRequest { org_id, user_id, url, title, html, screenshot_b64: shot, redactions })
}

/// `z.string().trim().min(1).transform(clip to max with a trailing ".")`
fn clip(v: Option<&Value>, path: &[PathSeg], max: usize) -> VResult<String> {
    let s = js_trim(&string(v, path)?).to_string();
    min_chars(&s, 1, path, None)?;
    Ok(if js_len(&s) <= max { s } else { format!("{}.", js_trim_end(&js_take(&s, max - 1))) })
}

pub fn feature_card(v: &Value, path: &[PathSeg]) -> VResult<FeatureCard> {
    let m = object(Some(v), path)?;
    let label = clip(m.get("label"), &key(path, "label"), 40)?;
    let summary = clip(m.get("summary"), &key(path, "summary"), 140)?;
    let status = enum_of(m.get("status"), &key(path, "status"), CardStatus::NAMES, CardStatus::parse)?;
    let p = key(path, "paths");
    let paths = match m.get("paths") {
        None => vec![],
        x => {
            let a = array(x, &p)?;
            let out = a.iter().enumerate().map(|(i, s)| string(Some(s), &join(&p, PathSeg::Index(i)))).collect::<VResult<Vec<_>>>()?;
            max_items(out.len(), MAX_CODE_FILES, &p, None)?;
            out
        }
    };
    Ok(FeatureCard { label, summary, status, paths })
}

pub fn code_ingest_request(v: &Value) -> VResult<CodeIngestRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let p = key(&[], "repo");
    let repo = string(m.get("repo"), &p)?;
    min_chars(&repo, 1, &p, None)?;
    let p = key(&[], "commitSha");
    let commit_sha = string(m.get("commitSha"), &p)?;
    min_chars(&commit_sha, 1, &p, None)?;

    let p = key(&[], "files");
    let raw = array(m.get("files"), &p)?;
    let mut files = Vec::with_capacity(raw.len());
    for (i, f) in raw.iter().enumerate() {
        let fp = join(&p, PathSeg::Index(i));
        let fm = object(Some(f), &fp)?;
        let pp = key(&fp, "path");
        let path = string(fm.get("path"), &pp)?;
        min_chars(&path, 1, &pp, None)?;
        let diff = string(fm.get("diff"), &key(&fp, "diff"))?;
        files.push(CodeFile { path, diff });
    }
    max_items(files.len(), MAX_CODE_FILES, &p, Some(&format!("send at most {MAX_CODE_FILES} files")))?;

    let p = key(&[], "cards");
    let cards = optional(m.get("cards"), |x| {
        let a = array(Some(x), &p)?;
        let out = a.iter().enumerate().map(|(i, c)| feature_card(c, &join(&p, PathSeg::Index(i)))).collect::<VResult<Vec<_>>>()?;
        max_items(out.len(), MAX_CODE_CARDS, &p, Some(&format!("send at most {MAX_CODE_CARDS} cards")))?;
        Ok(out)
    })?;

    let p = key(&[], "userId");
    let user_id = optional(m.get("userId"), |x| {
        let s = string(Some(x), &p)?;
        min_chars(&s, 1, &p, None)?;
        Ok(s)
    })?;

    let p = key(&[], "author");
    let author = optional(m.get("author"), |x| {
        let am = object(Some(x), &p)?;
        let name = trimmed(am.get("name"), &key(&p, "name"), 1, None, 120)?;
        let ep = key(&p, "email");
        let email = optional(am.get("email"), |e| {
            let s = string(Some(e), &ep)?;
            max_chars(&s, 200, &ep, None)?;
            Ok(s)
        })?;
        Ok(CommitAuthor { name, email })
    })?;

    if files.is_empty() && cards.as_ref().is_none_or(|c| c.is_empty()) {
        return Err(ValidationError::new(&[], "send at least one file or one card"));
    }
    Ok(CodeIngestRequest { org_id, repo, commit_sha, files, cards, user_id, author })
}

fn string_array(v: Option<&Value>, path: &[PathSeg]) -> VResult<Vec<String>> {
    let a = array(v, path)?;
    a.iter().enumerate().map(|(i, s)| string(Some(s), &join(path, PathSeg::Index(i)))).collect()
}

pub fn view_command(v: &Value, path: &[PathSeg]) -> VResult<ViewCommand> {
    let m = object(Some(v), path)?;
    let focus_node_ids = string_array(m.get("focusNodeIds"), &key(path, "focusNodeIds"))?;
    let highlight_node_ids = string_array(m.get("highlightNodeIds"), &key(path, "highlightNodeIds"))?;
    let p = key(path, "visibleDomains");
    let visible_domains = match m.get("visibleDomains") {
        Some(Value::Null) => None,
        x => {
            let a = array(x, &p)?;
            Some(
                a.iter()
                    .enumerate()
                    .map(|(i, d)| enum_of(Some(d), &join(&p, PathSeg::Index(i)), Domain::NAMES, Domain::parse))
                    .collect::<VResult<Vec<_>>>()?,
            )
        }
    };
    let layout = enum_of(m.get("layout"), &key(path, "layout"), Layout::NAMES, Layout::parse)?;
    let caption = string(m.get("caption"), &key(path, "caption"))?;
    Ok(ViewCommand { focus_node_ids, highlight_node_ids, visible_domains, layout, caption })
}

pub fn chat_turn(v: &Value, path: &[PathSeg]) -> VResult<ChatTurn> {
    let m = object(Some(v), path)?;
    let role = enum_of(m.get("role"), &key(path, "role"), TurnRole::NAMES, TurnRole::parse)?;
    let text = js_take(&string(m.get("text"), &key(path, "text"))?, HISTORY_CHARS);
    Ok(ChatTurn { role, text })
}

pub fn chat_request(v: &Value) -> VResult<ChatRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let p = key(&[], "message");
    let message = string(m.get("message"), &p)?;
    min_chars(&message, 1, &p, None)?;
    max_chars(&message, 2_000, &p, None)?;
    let current_view = match m.get("currentView") {
        None | Some(Value::Null) => None,
        Some(x) => Some(view_command(x, &key(&[], "currentView"))?),
    };
    let skip_dashboard = optional(m.get("skipDashboard"), |x| boolean(Some(x), &key(&[], "skipDashboard")))?;
    let p = key(&[], "history");
    let history = optional(m.get("history"), |x| {
        let a = array(Some(x), &p)?;
        let turns = a.iter().enumerate().map(|(i, t)| chat_turn(t, &join(&p, PathSeg::Index(i)))).collect::<VResult<Vec<_>>>()?;
        let kept: Vec<ChatTurn> = turns.into_iter().filter(|t| !js_trim(&t.text).is_empty()).collect();
        let skip = kept.len().saturating_sub(MAX_HISTORY);
        Ok(kept.into_iter().skip(skip).collect())
    })?;
    Ok(ChatRequest { org_id, user_id, message, current_view, skip_dashboard, history })
}

fn user_query(v: &Value) -> VResult<UserQuery> {
    let m = object(Some(v), &[])?;
    Ok(UserQuery { org_id: org_id_field(m.get("orgId"), &[])?, user_id: user_id_field(m)? })
}

pub fn brief_query(v: &Value) -> VResult<BriefQuery> {
    user_query(v)
}

pub fn dashboard_query(v: &Value) -> VResult<DashboardQuery> {
    user_query(v)
}

pub fn context_query(v: &Value) -> VResult<ContextQuery> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let q = optional(m.get("q"), |x| string(Some(x), &key(&[], "q")))?;
    let k = match m.get("k") {
        None => 8.0,
        x => coerced_number(x, &key(&[], "k"), NumRules { int: true, min: Some((1.0, true)), max: Some(50.0) })?,
    };
    Ok(ContextQuery { org_id, user_id, q, k: k as usize })
}

pub fn feed_query(v: &Value) -> VResult<FeedQuery> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let since_hours = match m.get("sinceHours") {
        None => 72.0,
        x => coerced_number(x, &key(&[], "sinceHours"), NumRules { int: false, min: Some((0.0, false)), max: Some(24.0 * 90.0) })?,
    };
    let limit = match m.get("limit") {
        None => 20.0,
        x => coerced_number(x, &key(&[], "limit"), NumRules { int: true, min: Some((1.0, true)), max: Some(100.0) })?,
    };
    Ok(FeedQuery { org_id, user_id, since_hours, limit: limit as usize })
}

pub fn org_query(v: &Value) -> VResult<OrgQuery> {
    let m = object(Some(v), &[])?;
    Ok(OrgQuery { org_id: org_id_field(m.get("orgId"), &[])? })
}

pub fn activity_query(v: &Value) -> VResult<ActivityQuery> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let limit = match m.get("limit") {
        None => 40.0,
        x => coerced_number(x, &key(&[], "limit"), NumRules { int: true, min: Some((1.0, true)), max: Some(200.0) })?,
    };
    Ok(ActivityQuery { org_id, limit: limit as usize })
}

static HAS_SCHEME: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z]+://").unwrap());
static HOSTNAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z0-9.-]+\.[a-z]{2,}$").unwrap());

/// "https://www.GitHub.com/acme" and "github.com" both become "github.com".
pub fn host_of(site: &str) -> Option<String> {
    let s = js_trim(site).to_lowercase();
    if s.is_empty() {
        return None;
    }
    let full = if HAS_SCHEME.is_match(&s) { s } else { format!("https://{s}") };
    let url = url::Url::parse(&full).ok()?;
    let host = url.host_str()?;
    let host = host.strip_prefix("www.").unwrap_or(host);
    HOSTNAME.is_match(host).then(|| host.to_string())
}

/// The `websites` field: up to 40 entries of at most 300 chars, stored as unique hostnames.
fn websites(v: Option<&Value>, path: &[PathSeg]) -> VResult<Vec<String>> {
    let list = string_array(v, path)?;
    for (i, s) in list.iter().enumerate() {
        max_chars(s, 300, &join(path, PathSeg::Index(i)), None)?;
    }
    max_items(list.len(), MAX_ORG_WEBSITES, path, Some(&format!("list at most {MAX_ORG_WEBSITES} websites")))?;
    let hosts: Vec<Option<String>> = list.iter().map(|s| host_of(s)).collect();
    if let Some(i) = hosts.iter().position(Option::is_none) {
        return Err(ValidationError::new(path, format!("\"{}\" is not a website", list[i])));
    }
    let mut seen = HashSet::new();
    Ok(hosts.into_iter().flatten().filter(|h| seen.insert(h.clone())).collect())
}

const DESCRIPTION_MSG: &str = "say what the org does in a sentence or two";

pub fn create_org_request(v: &Value) -> VResult<CreateOrgRequest> {
    let m = object(Some(v), &[])?;
    let p = key(&[], "id");
    let id = optional(m.get("id"), |x| {
        let s = string(Some(x), &p)?;
        regex_check(&s, &ID_RE, &p, Some("id must be lowercase letters, digits, and dashes"))?;
        Ok(s)
    })?;
    let name = trimmed(m.get("name"), &key(&[], "name"), 1, None, 80)?;
    let description = trimmed(m.get("description"), &key(&[], "description"), 1, Some(DESCRIPTION_MSG), MAX_ORG_TEXT)?;
    let sites = match m.get("websites") {
        None => vec![],
        x => websites(x, &key(&[], "websites"))?,
    };
    let context = match m.get("context") {
        None => String::new(),
        x => trimmed(x, &key(&[], "context"), 0, None, MAX_ORG_TEXT)?,
    };
    let p = key(&[], "members");
    let members = match m.get("members") {
        None => vec![],
        x => {
            let a = array(x, &p)?;
            let mut out = Vec::with_capacity(a.len());
            for (i, item) in a.iter().enumerate() {
                let ip = join(&p, PathSeg::Index(i));
                let im = object(Some(item), &ip)?;
                let name = trimmed(im.get("name"), &key(&ip, "name"), 1, None, 80)?;
                let role = trimmed(im.get("role"), &key(&ip, "role"), 1, None, MAX_ROLE_CHARS)?;
                out.push(NewMember { name, role });
            }
            max_items(out.len(), 50, &p, None)?;
            out
        }
    };
    Ok(CreateOrgRequest { id, name, description, websites: sites, context, members })
}

pub fn update_org_request(v: &Value) -> VResult<UpdateOrgRequest> {
    let m = object(Some(v), &[])?;
    Ok(UpdateOrgRequest {
        name: optional(m.get("name"), |x| trimmed(Some(x), &key(&[], "name"), 1, None, 80))?,
        description: optional(m.get("description"), |x| trimmed(Some(x), &key(&[], "description"), 1, Some(DESCRIPTION_MSG), MAX_ORG_TEXT))?,
        websites: optional(m.get("websites"), |x| websites(Some(x), &key(&[], "websites")))?,
        context: optional(m.get("context"), |x| trimmed(Some(x), &key(&[], "context"), 0, None, MAX_ORG_TEXT))?,
    })
}

pub fn upsert_user_request(v: &Value) -> VResult<UpsertUserRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let p = key(&[], "id");
    let id = optional(m.get("id"), |x| {
        let s = string(Some(x), &p)?;
        regex_check(&s, &ID_RE, &p, None)?;
        Ok(s)
    })?;
    let name = trimmed(m.get("name"), &key(&[], "name"), 1, None, 80)?;
    let role = trimmed(m.get("role"), &key(&[], "role"), 1, None, MAX_ROLE_CHARS)?;
    let team_description = match m.get("teamDescription") {
        None => String::new(),
        x => trimmed(x, &key(&[], "teamDescription"), 0, None, MAX_ROLE_CHARS)?,
    };
    Ok(UpsertUserRequest { org_id, id, name, role, team_description })
}

// ---- Dashboards ----
// Lenient on purpose: specs come from the model and from the UI. Missing optional fields become null,
// unknown enum values are dropped, malformed widgets are skipped, and at most MAX_WIDGETS are kept.

static WS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

/// Collapse whitespace, trim, and cut to `max` with a trailing ".".
pub fn short(s: &str, max: usize) -> String {
    let t = WS.replace_all(s, " ");
    let t = js_trim(&t);
    if js_len(t) <= max { t.to_string() } else { format!("{}.", js_trim_end(&js_take(t, max - 1))) }
}

/// `z.string().nullish().catch(null)`
fn lenient_string(v: Option<&Value>) -> Option<&str> {
    match v {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}

/// A list of known values, deduped; empty, missing, or malformed means None ("any").
fn enum_list<T: Copy + PartialEq>(v: Option<&Value>, parse: fn(&str) -> Option<T>) -> Option<Vec<T>> {
    let Some(Value::Array(a)) = v else { return None };
    let mut kept: Vec<T> = vec![];
    for x in a {
        if let Some(t) = x.as_str().and_then(parse) {
            if !kept.contains(&t) {
                kept.push(t);
            }
        }
    }
    (!kept.is_empty()).then_some(kept)
}

fn opt_text(v: Option<&Value>, max: usize) -> Option<String> {
    lenient_string(v).filter(|s| !js_trim(s).is_empty()).map(|s| short(s, max))
}

/// Lenient widget filter: each field falls back to None on anything malformed.
pub fn widget_filter(v: &Value) -> Option<WidgetFilter> {
    let Value::Object(m) = v else { return None };
    let node_ids = match m.get("nodeIds") {
        Some(Value::Array(a)) if a.iter().all(Value::is_string) && !a.is_empty() => {
            let mut seen = HashSet::new();
            Some(a.iter().filter_map(|x| x.as_str()).filter(|s| seen.insert(s.to_string())).take(50).map(String::from).collect())
        }
        _ => None,
    };
    Some(WidgetFilter {
        domains: enum_list(m.get("domains"), Domain::parse),
        statuses: enum_list(m.get("statuses"), Status::parse),
        node_ids,
        owner: opt_text(m.get("owner"), 80),
        query: opt_text(m.get("query"), 120),
        since_hours: match m.get("sinceHours").and_then(Value::as_f64) {
            Some(h) if h > 0.0 => Some(((h + 0.5).floor() as i64).min(24 * 90)),
            _ => None,
        },
        source: opt_text(m.get("source"), 60),
    })
}

pub fn kind_title(kind: WidgetKind) -> &'static str {
    match kind {
        WidgetKind::Kpi => "Metric",
        WidgetKind::StatusBreakdown => "Status",
        WidgetKind::DomainBreakdown => "By domain",
        WidgetKind::NodeList => "Work",
        WidgetKind::Activity => "Live activity",
        WidgetKind::Constellation => "Constellation",
        WidgetKind::Map => "Star map",
        WidgetKind::Gaps => "Gaps",
        WidgetKind::People => "Who is active",
        WidgetKind::Note => "Note",
    }
}

static ID_JUNK: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-z0-9-]+").unwrap());
static ID_EDGES: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-+|-+$").unwrap());

/// The widgets list: malformed entries skipped, empty notes dropped, ids made unique, at most 12.
pub fn widgets(v: Option<&Value>) -> Vec<Widget> {
    let Some(Value::Array(list)) = v else { return vec![] };
    let mut ids = HashSet::new();
    let mut out = vec![];
    for raw in list {
        let Value::Object(m) = raw else { continue };
        let Some(kind) = m.get("kind").and_then(Value::as_str).and_then(WidgetKind::parse) else { continue };
        let text = opt_text(m.get("text"), 600);
        if kind == WidgetKind::Note && text.is_none() {
            continue;
        }
        let raw_id = lenient_string(m.get("id")).unwrap_or("").to_lowercase();
        let dashed = ID_JUNK.replace_all(&raw_id, "-");
        let base = js_take(&ID_EDGES.replace_all(&dashed, ""), 40);
        let base = if base.is_empty() { kind.as_str().to_string() } else { base };
        let mut id = base.clone();
        let mut n = 2;
        while ids.contains(&id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        ids.insert(id.clone());
        let title = short(lenient_string(m.get("title")).unwrap_or(""), 60);
        let size = m.get("size").and_then(Value::as_str).and_then(WidgetSize::parse).unwrap_or(WidgetSize::Md);
        let metric = m.get("metric").and_then(Value::as_str).and_then(WidgetMetric::parse);
        let filter = m.get("filter").and_then(widget_filter).filter(|f| !f.is_empty());
        out.push(Widget {
            id,
            kind,
            title: if title.is_empty() { kind_title(kind).to_string() } else { title },
            size,
            metric: if kind == WidgetKind::Kpi { Some(metric.unwrap_or(WidgetMetric::TotalNodes)) } else { metric },
            filter,
            text,
        });
        if out.len() == MAX_WIDGETS {
            break;
        }
    }
    out
}

/// `dashboardSpec`: the object itself is required; every field inside is lenient.
pub fn dashboard_spec(v: &Value, path: &[PathSeg]) -> VResult<DashboardSpec> {
    let m = object(Some(v), path)?;
    let title = short(lenient_string(m.get("title")).unwrap_or(""), 80);
    let updated_at = match lenient_string(m.get("updatedAt")) {
        Some(s) if crate::time::parse_ms(s).is_some() => s.to_string(),
        _ => crate::time::now_iso(),
    };
    Ok(DashboardSpec {
        title: if title.is_empty() { "Your dashboard".into() } else { title },
        subtitle: short(lenient_string(m.get("subtitle")).unwrap_or(""), 160),
        widgets: widgets(m.get("widgets")),
        origin: m.get("origin").and_then(Value::as_str).and_then(DashboardOrigin::parse).unwrap_or(DashboardOrigin::Chat),
        updated_at,
    })
}

pub fn dashboard_ask_request(v: &Value) -> VResult<DashboardAskRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let p = key(&[], "message");
    let message = string(m.get("message"), &p)?;
    min_chars(&message, 1, &p, None)?;
    max_chars(&message, 2_000, &p, None)?;
    Ok(DashboardAskRequest { org_id, user_id, message })
}

pub fn dashboard_request(v: &Value) -> VResult<DashboardRequest> {
    let m = object(Some(v), &[])?;
    let org_id = org_id_field(m.get("orgId"), &[])?;
    let user_id = user_id_field(m)?;
    let dashboard = optional(m.get("dashboard"), |x| dashboard_spec(x, &key(&[], "dashboard")))?;
    let reset = optional(m.get("reset"), |x| boolean(Some(x), &key(&[], "reset")))?;
    if reset != Some(true) && dashboard.is_none() {
        return Err(ValidationError::new(&[], "send a dashboard, or reset: true"));
    }
    Ok(DashboardRequest { org_id, user_id, dashboard, reset })
}

// ---- Auth (src/auth/service.ts, app/api/auth/**) ----

pub const MIN_PASSWORD: usize = 8;
static USER_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(ID_PATTERN).unwrap());
pub const USER_ID_MSG: &str = "userId must be lowercase letters, digits, and dashes";

#[derive(Debug, Clone, PartialEq)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub fn login_request(v: &Value) -> VResult<LoginRequest> {
    let m = object(Some(v), &[])?;
    let username = trimmed(m.get("username"), &key(&[], "username"), 1, None, 40)?;
    let p = key(&[], "password");
    let password = string(m.get("password"), &p)?;
    min_chars(&password, 1, &p, None)?;
    max_chars(&password, 200, &p, None)?;
    Ok(LoginRequest { username, password })
}

/// `newAccountRequest` (admin creates an account) and the account half of signup.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NewAccountRequest {
    pub username: String,
    pub password: String,
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
    pub admin: Option<bool>,
}

fn account_fields(m: &Map<String, Value>, with_admin: bool) -> VResult<NewAccountRequest> {
    let username = trimmed(m.get("username"), &key(&[], "username"), 2, None, 40)?;
    let p = key(&[], "password");
    let password = string(m.get("password"), &p)?;
    min_chars(&password, MIN_PASSWORD, &p, Some(&format!("password must be at least {MIN_PASSWORD} characters")))?;
    max_chars(&password, 200, &p, None)?;
    let p = key(&[], "userId");
    let user_id = optional(m.get("userId"), |x| {
        let s = string(Some(x), &p)?;
        regex_check(&s, &USER_ID_RE, &p, Some(USER_ID_MSG))?;
        Ok(s)
    })?;
    let name = optional(m.get("name"), |x| trimmed(Some(x), &key(&[], "name"), 1, None, 80))?;
    let role = optional(m.get("role"), |x| trimmed(Some(x), &key(&[], "role"), 0, None, MAX_ROLE_CHARS))?;
    let admin = if with_admin { optional(m.get("admin"), |x| boolean(Some(x), &key(&[], "admin")))? } else { None };
    Ok(NewAccountRequest { username, password, user_id, name, role, admin })
}

pub fn new_account_request(v: &Value) -> VResult<NewAccountRequest> {
    account_fields(object(Some(v), &[])?, true)
}

/// Validates a derived user id like `userIdSchema.parse(...)` (no path).
pub fn user_id(s: &str) -> VResult<String> {
    regex_check(s, &USER_ID_RE, &[], Some(USER_ID_MSG))?;
    Ok(s.to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub struct SignupRequest {
    pub account: NewAccountRequest,
    pub org_name: String,
    pub org_id: Option<String>,
    pub org_description: Option<String>,
}

pub fn signup_request(v: &Value) -> VResult<SignupRequest> {
    let m = object(Some(v), &[])?;
    let account = account_fields(m, false)?;
    let org_name = trimmed(m.get("orgName"), &key(&[], "orgName"), 1, None, 80)?;
    let p = key(&[], "orgId");
    let org_id = optional(m.get("orgId"), |x| {
        let s = string(Some(x), &p)?;
        regex_check(&s, &ID_RE, &p, Some("orgId must be lowercase letters and dashes"))?;
        Ok(s)
    })?;
    let org_description = optional(m.get("orgDescription"), |x| trimmed(Some(x), &key(&[], "orgDescription"), 1, None, MAX_ORG_TEXT))?;
    Ok(SignupRequest { account, org_name, org_id, org_description })
}

/// `{ label }` for a new API token; default "api token".
pub fn create_token_request(v: &Value) -> VResult<String> {
    let m = object(Some(v), &[])?;
    match m.get("label") {
        None => Ok("api token".into()),
        x => trimmed(x, &key(&[], "label"), 1, None, 80),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn err<T: std::fmt::Debug>(r: VResult<T>) -> String {
        r.unwrap_err().to_string()
    }

    // Expected strings were produced by running the TS schemas through zod 4.6.5.
    #[test]
    fn capture_errors_match_zod() {
        assert_eq!(err(capture_request(&json!({}))), "userId: Invalid input: expected string, received undefined");
        assert_eq!(
            err(capture_request(&json!({"orgId": "Bad", "userId": "x", "url": "u", "html": ""}))),
            "orgId: orgId must be lowercase letters, digits, and dashes"
        );
        assert_eq!(
            err(capture_request(&json!({"userId": "x", "url": "u", "html": "a".repeat(60_001)}))),
            "html: html must be at most 60000 characters"
        );
        assert_eq!(
            err(capture_request(&json!({"userId": "x", "url": "u", "html": "", "redactions": [{"x": 1}]}))),
            "redactions.0.y: Invalid input: expected number, received undefined"
        );
        assert_eq!(err(capture_request(&json!(null))), "Invalid input: expected object, received null");
        assert_eq!(err(capture_request(&json!([]))), "Invalid input: expected object, received array");
        assert_eq!(err(capture_request(&json!({"userId": 5, "url": "u", "html": ""}))), "userId: Invalid input: expected string, received number");
        assert_eq!(err(capture_request(&json!({"userId": "", "url": "u", "html": ""}))), "userId: Too small: expected string to have >=1 characters");
        let ok = capture_request(&json!({"userId": "x", "url": "u", "html": "", "screenshotB64": "data:image/jpeg;base64,AAAA"})).unwrap();
        assert_eq!(ok.screenshot_b64, "AAAA");
        assert_eq!(ok.title, "");
        assert_eq!(ok.org_id, None);
    }

    #[test]
    fn code_errors_match_zod() {
        assert_eq!(err(code_ingest_request(&json!({"repo": "r", "commitSha": "c", "files": []}))), "send at least one file or one card");
        assert_eq!(
            err(code_ingest_request(&json!({"repo": "r", "commitSha": "c", "files": [], "cards": [{"label": " ", "summary": "s", "status": "x"}]}))),
            "cards.0.label: Too small: expected string to have >=1 characters"
        );
        assert_eq!(
            err(code_ingest_request(&json!({"repo": "r", "commitSha": "c", "files": [], "cards": [{"label": "a", "summary": "s", "status": "x"}]}))),
            "cards.0.status: Invalid option: expected one of \"shipped\"|\"in_beta\"|\"in_progress\""
        );
        let ok = code_ingest_request(&json!({"repo": "r", "commitSha": "c", "files": [], "cards": [{"label": "a".repeat(50), "summary": "s", "status": "shipped"}]})).unwrap();
        let card = &ok.cards.unwrap()[0];
        assert_eq!(card.label, format!("{}.", "a".repeat(39)));
        assert!(card.paths.is_empty());
    }

    #[test]
    fn chat_and_queries_match_zod() {
        assert_eq!(err(chat_request(&json!({"userId": "u", "message": ""}))), "message: Too small: expected string to have >=1 characters");
        assert_eq!(
            err(chat_request(&json!({"userId": "u", "message": "m", "currentView": {"focusNodeIds": [], "highlightNodeIds": [], "visibleDomains": ["x"], "layout": "list", "caption": ""}}))),
            "currentView.visibleDomains.0: Invalid option: expected one of \"engineering\"|\"sales\"|\"marketing\"|\"ops\""
        );
        let ok = chat_request(&json!({"userId": "u", "message": "m", "history": [{"role": "user", "text": " "}, {"role": "assistant", "text": "hi"}]})).unwrap();
        assert_eq!(ok.history.unwrap(), vec![ChatTurn { role: TurnRole::Assistant, text: "hi".into() }]);
        assert_eq!(ok.current_view, None);
        assert_eq!(err(chat_request(&json!({"userId": "u", "message": "m", "skipDashboard": "yes"}))), "skipDashboard: Invalid input: expected boolean, received string");

        assert_eq!(err(context_query(&json!({"userId": "u", "k": "abc"}))), "k: Invalid input: expected number, received NaN");
        assert_eq!(err(context_query(&json!({"userId": "u", "k": "1.5"}))), "k: Invalid input: expected int, received number");
        assert_eq!(err(context_query(&json!({"userId": "u", "k": "100"}))), "k: Too big: expected number to be <=50");
        assert_eq!(err(context_query(&json!({"userId": "u", "k": ""}))), "k: Too small: expected number to be >=1");
        assert_eq!(err(context_query(&json!({"userId": "u", "k": "Infinity"}))), "k: Invalid input: expected number, received Infinity");
        assert_eq!(context_query(&json!({"userId": "u"})).unwrap().k, 8);
        assert_eq!(err(feed_query(&json!({"userId": "u", "sinceHours": "0"}))), "sinceHours: Too small: expected number to be >0");
        assert_eq!(err(feed_query(&json!({"userId": "u", "sinceHours": "99999"}))), "sinceHours: Too big: expected number to be <=2160");
        assert_eq!(err(activity_query(&json!({"limit": "0"}))), "limit: Too small: expected number to be >=1");
        assert_eq!(activity_query(&json!({})).unwrap().limit, 40);
    }

    #[test]
    fn org_and_user_errors_match_zod() {
        assert_eq!(err(create_org_request(&json!({"name": "", "description": ""}))), "name: Too small: expected string to have >=1 characters");
        assert_eq!(err(create_org_request(&json!({"name": "a", "description": " "}))), "description: say what the org does in a sentence or two");
        assert_eq!(err(create_org_request(&json!({"name": "a", "description": "d", "id": "BAD"}))), "id: id must be lowercase letters, digits, and dashes");
        assert_eq!(err(create_org_request(&json!({"name": "a", "description": "d", "websites": ["ok.com", "nope"]}))), "websites: \"nope\" is not a website");
        assert_eq!(err(create_org_request(&json!({"name": "a", "description": "d", "members": [{"name": "x"}]}))), "members.0.role: Invalid input: expected string, received undefined");
        assert_eq!(err(upsert_user_request(&json!({"name": "a", "role": "r", "id": "BAD"}))), "id: Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{0,39}$/");
        assert_eq!(err(update_org_request(&json!({"websites": "x"}))), "websites: Invalid input: expected array, received string");
    }

    #[test]
    fn dashboards_are_lenient() {
        assert_eq!(err(dashboard_request(&json!({"userId": "u"}))), "send a dashboard, or reset: true");
        assert_eq!(err(dashboard_request(&json!({"userId": "u", "dashboard": "x"}))), "dashboard: Invalid input: expected object, received string");
        let ok = dashboard_request(&json!({"userId": "u", "dashboard": {
            "title": 5,
            "widgets": [
                {"kind": "kpi"}, {"kind": "note"}, {"kind": "x"},
                {"kind": "node_list", "id": "Hello World!!", "size": "huge", "filter": {"domains": ["sales", "bogus", "sales"], "query": "  "}},
                {"kind": "kpi", "id": "kpi-total_nodes"}
            ],
            "origin": "zzz",
            "updatedAt": "2026-01-01"
        }}))
        .unwrap();
        let got = serde_json::to_value(ok.dashboard.unwrap()).unwrap();
        assert_eq!(
            got,
            json!({"title":"Your dashboard","subtitle":"","widgets":[
                {"id":"kpi","kind":"kpi","title":"Metric","size":"md","metric":"total_nodes","filter":null,"text":null},
                {"id":"hello-world","kind":"node_list","title":"Work","size":"md","metric":null,"filter":{"domains":["sales"],"statuses":null,"nodeIds":null,"owner":null,"query":null},"text":null},
                {"id":"kpi-total-nodes","kind":"kpi","title":"Metric","size":"md","metric":"total_nodes","filter":null,"text":null}
            ],"origin":"chat","updatedAt":"2026-01-01"})
        );
    }

    // Port of the schema half of src/contract/org.test.ts.
    #[test]
    fn org_profile_websites() {
        assert_eq!(host_of("https://www.GitHub.com/lumen/app").as_deref(), Some("github.com"));
        assert_eq!(host_of("lumen.atlassian.net").as_deref(), Some("lumen.atlassian.net"));
        assert_eq!(host_of("not a site"), None);
        let ok = create_org_request(&json!({"name": "Lumen", "description": "Budgeting app.", "websites": ["github.com", "https://github.com/x"]})).unwrap();
        assert_eq!(ok.websites, vec!["github.com"]);
        assert_eq!(ok.context, "");
        assert!(ok.members.is_empty());
        assert!(err(create_org_request(&json!({"name": "Lumen", "description": "x", "websites": ["nope"]}))).contains("not a website"));
        assert!(create_org_request(&json!({"name": "Lumen", "description": ""})).is_err());
        assert_eq!(update_org_request(&json!({"context": "new"})).unwrap(), UpdateOrgRequest { context: Some("new".into()), ..Default::default() });
    }
}
