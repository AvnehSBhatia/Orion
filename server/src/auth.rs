//! Port of `src/auth/*` (crypto, db, ratelimit, request, scope, service) at 48ff660.
//!
//! Same file and format as the TS backend, so accounts carry over: `$DATA_DIR/auth.db` (or AUTH_DB) with
//! `accounts` and `tokens`; passwords as `scrypt$N$r$p$salt$hash` (NFKC-normalized, 64-byte key, base64url);
//! tokens are 32 random bytes base64url and only their sha256 hex is stored. A request is signed in by
//! `Authorization: Bearer <token>` or the `orion_session` cookie.
//!
//! [`Auth`] is the extractor every non-public route takes. With AUTH_DISABLED=true it yields no caller and
//! every scope check passes (the TS `principalOf(req) === null` path).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use axum::extract::FromRequestParts;
use axum::http::{HeaderMap, header, request::Parts};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::contract::schemas::MIN_PASSWORD;
use crate::server::deps::AppState;
use crate::server::http::HttpError;
use crate::time::{iso, now_iso, now_ms, parse_ms};

pub const SESSION_COOKIE: &str = "orion_session";
pub const SIGN_IN_REQUIRED: &str = "sign in required";
pub const SESSION_DAYS: i64 = 30;
const DAY_MS: i64 = 86_400_000;

// ---- crypto.ts ----

const SCRYPT_N: u32 = 16_384;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const KEYLEN: usize = 64;

fn derive(password: &str, salt: &[u8], n: u32, r: u32, p: u32) -> Result<Vec<u8>> {
    if !n.is_power_of_two() || n < 2 {
        anyhow::bail!("scrypt N must be a power of two");
    }
    let params = scrypt::Params::new(n.trailing_zeros() as u8, r, p).map_err(|e| anyhow!("scrypt params: {e}"))?;
    let normalized: String = password.nfkc().collect();
    let mut out = vec![0u8; KEYLEN];
    scrypt::scrypt(normalized.as_bytes(), salt, &params, &mut out).map_err(|e| anyhow!("scrypt: {e}"))?;
    Ok(out)
}

/// `scrypt$N$r$p$salt$hash`, salt and hash base64url. CPU heavy: call from `spawn_blocking`.
pub fn hash_password(password: &str) -> Result<String> {
    let mut salt = [0u8; 16];
    rand::fill(&mut salt);
    let key = derive(password, &salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)?;
    Ok(format!("scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${}${}", URL_SAFE_NO_PAD.encode(salt), URL_SAFE_NO_PAD.encode(key)))
}

fn b64url(s: &str) -> Option<Vec<u8>> {
    // Node's base64url decoder tolerates padding; strip it.
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()
}

/// Constant-time compare of the derived key. False on any malformed hash.
pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 6 || parts[0] != "scrypt" {
        return false;
    }
    let (Ok(n), Ok(r), Ok(p)) = (parts[1].parse::<u32>(), parts[2].parse::<u32>(), parts[3].parse::<u32>()) else { return false };
    let (Some(salt), Some(expected)) = (b64url(parts[4]), b64url(parts[5])) else { return false };
    let Ok(key) = derive(password, &salt, n, r, p) else { return false };
    key.len() == expected.len() && key.iter().zip(&expected).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// A hash of a throwaway password, so a login for an unknown username takes as long as a real one.
static DUMMY_HASH: Lazy<String> = Lazy::new(|| hash_password(&new_raw_token()).expect("scrypt"));

/// The throwaway hash verified against for unknown usernames.
pub fn dummy_hash() -> &'static str {
    &DUMMY_HASH
}

/// 32 random bytes, base64url. Only its sha256 is stored.
pub fn new_raw_token() -> String {
    let mut b = [0u8; 32];
    rand::fill(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

pub fn sha256(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// 9 random bytes, base64url (token ids).
pub fn new_id() -> String {
    let mut b = [0u8; 9];
    rand::fill(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

// ---- db.ts ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenKind {
    /// A browser sign-in; expires after 30 days.
    Session,
    /// A long-lived API token (MCP clients, the extension, CI); never expires, revocable.
    Api,
}

impl TokenKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TokenKind::Session => "session",
            TokenKind::Api => "api",
        }
    }
    fn parse(s: &str) -> TokenKind {
        if s == "api" { TokenKind::Api } else { TokenKind::Session }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub username: String,
    pub org_id: String,
    pub user_id: String,
    pub admin: bool,
    pub created_at: String,
}

/// Who is calling: the account behind a session cookie or bearer token (`Principal` in TS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub username: String,
    pub org_id: String,
    pub user_id: String,
    pub admin: bool,
    pub created_at: String,
    pub token_id: String,
    pub kind: TokenKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub id: String,
    pub kind: TokenKind,
    pub label: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

pub fn normalize_username(u: &str) -> String {
    crate::text::js_trim(u).to_lowercase()
}

pub static USERNAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z0-9][a-z0-9._-]{1,39}$").unwrap());

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('session', 'api')),
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS tokens_username ON tokens(username);
";

fn row_account(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        username: r.get("username")?,
        org_id: r.get("org_id")?,
        user_id: r.get("user_id")?,
        admin: r.get::<_, i64>("admin")? == 1,
        created_at: r.get("created_at")?,
    })
}

fn row_token(r: &rusqlite::Row) -> rusqlite::Result<(TokenInfo, String)> {
    Ok((
        TokenInfo {
            id: r.get("id")?,
            kind: TokenKind::parse(&r.get::<_, String>("kind")?),
            label: r.get("label")?,
            created_at: r.get("created_at")?,
            expires_at: r.get("expires_at")?,
            last_used_at: r.get("last_used_at")?,
        },
        r.get("username")?,
    ))
}

/// Accounts and token hashes, in their own SQLite file apart from the org data (`AuthDb` in TS).
pub struct AuthStore {
    conn: Mutex<Connection>,
    pub limiter: LoginLimiter,
}

impl AuthStore {
    pub fn open(path: &std::path::Path) -> Result<AuthStore> {
        let conn = if path.as_os_str() == ":memory:" {
            Connection::open_in_memory()?
        } else {
            if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(dir)?;
            }
            Connection::open(path).with_context(|| format!("opening {}", path.display()))?
        };
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        Ok(AuthStore { conn: Mutex::new(conn), limiter: LoginLimiter::default() })
    }

    pub fn memory() -> Result<AuthStore> {
        Self::open(std::path::Path::new(":memory:"))
    }

    /// Validates, hashes (CPU heavy: call from `spawn_blocking`), and inserts. Errors are plain messages;
    /// callers map them to 400 (a taken username is checked first, as 409).
    pub fn create_account(&self, username: &str, password: &str, org_id: &str, user_id: &str, admin: bool) -> Result<Account> {
        let username = normalize_username(username);
        if !USERNAME_RE.is_match(&username) {
            anyhow::bail!("username must be 2-40 lowercase letters, digits, dots, dashes, or underscores");
        }
        if crate::text::js_len(password) < MIN_PASSWORD {
            anyhow::bail!("password must be at least {MIN_PASSWORD} characters");
        }
        if self.get_account(&username)?.is_some() {
            anyhow::bail!("username \"{username}\" is taken");
        }
        let hash = hash_password(password)?;
        self.conn.lock().execute(
            "INSERT INTO accounts (username, password_hash, org_id, user_id, admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            params![username, hash, org_id, user_id, admin as i64, now_iso()],
        )?;
        self.get_account(&username)?.ok_or_else(|| anyhow!("account vanished"))
    }

    /// A new password signs out every session (API tokens stay).
    pub fn set_password(&self, username: &str, password: &str) -> Result<()> {
        if crate::text::js_len(password) < MIN_PASSWORD {
            anyhow::bail!("password must be at least {MIN_PASSWORD} characters");
        }
        let u = normalize_username(username);
        let hash = hash_password(password)?;
        let conn = self.conn.lock();
        conn.execute("UPDATE accounts SET password_hash = ? WHERE username = ?", params![hash, u])?;
        conn.execute("DELETE FROM tokens WHERE username = ? AND kind = 'session'", [&u])?;
        Ok(())
    }

    pub fn get_account(&self, username: &str) -> Result<Option<Account>> {
        Ok(self
            .conn
            .lock()
            .query_row("SELECT * FROM accounts WHERE username = ?", [normalize_username(username)], row_account)
            .optional()?)
    }

    pub fn password_hash(&self, username: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .lock()
            .query_row("SELECT password_hash FROM accounts WHERE username = ?", [normalize_username(username)], |r| r.get(0))
            .optional()?)
    }

    /// Returns the raw token; only its hash is stored. Sessions expire after 30 days, API tokens never.
    pub fn issue_token(&self, username: &str, kind: TokenKind, label: &str) -> Result<(String, TokenInfo)> {
        let raw = new_raw_token();
        let id = new_id();
        let now = now_ms();
        let expires = (kind == TokenKind::Session).then(|| iso(now + SESSION_DAYS * DAY_MS));
        self.conn.lock().execute(
            "INSERT INTO tokens (id, hash, username, kind, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![id, sha256(&raw), normalize_username(username), kind.as_str(), crate::text::js_take(label, 80), iso(now), expires],
        )?;
        let info = self.token_by_id(&id)?.map(|(t, _)| t).ok_or_else(|| anyhow!("token vanished"))?;
        Ok((raw, info))
    }

    /// The account behind a raw token, or None when unknown or expired. Touches last_used_at at most once a minute.
    pub fn resolve_token(&self, raw: &str) -> Result<Option<Session>> {
        if raw.is_empty() {
            return Ok(None);
        }
        let conn = self.conn.lock();
        let Some((t, username)) = conn.query_row("SELECT * FROM tokens WHERE hash = ?", [sha256(raw)], row_token).optional()? else {
            return Ok(None);
        };
        let now = now_ms();
        if let Some(exp) = &t.expires_at {
            if parse_ms(exp).is_none_or(|e| e <= now) {
                conn.execute("DELETE FROM tokens WHERE id = ?", [&t.id])?;
                return Ok(None);
            }
        }
        let Some(a) = conn.query_row("SELECT * FROM accounts WHERE username = ?", [&username], row_account).optional()? else {
            return Ok(None);
        };
        if t.last_used_at.as_deref().and_then(parse_ms).is_none_or(|last| now - last > 60_000) {
            conn.execute("UPDATE tokens SET last_used_at = ? WHERE id = ?", params![iso(now), t.id])?;
        }
        Ok(Some(Session {
            username: a.username,
            org_id: a.org_id,
            user_id: a.user_id,
            admin: a.admin,
            created_at: a.created_at,
            token_id: t.id,
            kind: t.kind,
        }))
    }

    /// The token and its owner's username.
    pub fn token_by_id(&self, id: &str) -> Result<Option<(TokenInfo, String)>> {
        Ok(self.conn.lock().query_row("SELECT * FROM tokens WHERE id = ?", [id], row_token).optional()?)
    }

    pub fn list_tokens(&self, username: &str) -> Result<Vec<TokenInfo>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT * FROM tokens WHERE username = ? ORDER BY created_at DESC")?;
        let rows = stmt.query_map([normalize_username(username)], row_token)?;
        Ok(rows.map(|r| r.map(|(t, _)| t)).collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn revoke_token(&self, id: &str) -> Result<bool> {
        Ok(self.conn.lock().execute("DELETE FROM tokens WHERE id = ?", [id])? > 0)
    }
}

// ---- ratelimit.ts ----

/// Counts failed logins per key (ip + username) in a sliding window. In memory: one process, resets on restart.
pub struct LoginLimiter {
    failures: Mutex<HashMap<String, Vec<i64>>>,
    pub max: usize,
    pub window_ms: i64,
}

impl Default for LoginLimiter {
    fn default() -> Self {
        LoginLimiter { failures: Mutex::new(HashMap::new()), max: 10, window_ms: 15 * 60_000 }
    }
}

impl LoginLimiter {
    fn recent(map: &mut HashMap<String, Vec<i64>>, key: &str, now: i64, window: i64) -> Vec<i64> {
        let kept: Vec<i64> = map.get(key).map(|v| v.iter().copied().filter(|t| now - t < window).collect()).unwrap_or_default();
        if kept.is_empty() {
            map.remove(key);
        } else {
            map.insert(key.to_string(), kept.clone());
        }
        kept
    }

    /// Seconds until the key may try again, or 0 when it is not blocked.
    pub fn blocked_for(&self, key: &str, now: i64) -> i64 {
        let mut map = self.failures.lock();
        let kept = Self::recent(&mut map, key, now, self.window_ms);
        if kept.len() < self.max {
            return 0;
        }
        let oldest = kept[kept.len() - self.max];
        (((oldest + self.window_ms - now) as f64) / 1000.0).ceil().max(1.0) as i64
    }

    pub fn fail(&self, key: &str, now: i64) {
        let mut map = self.failures.lock();
        let mut kept = Self::recent(&mut map, key, now, self.window_ms);
        kept.push(now);
        map.insert(key.to_string(), kept);
        // Keep memory bounded under a spray of usernames.
        if map.len() > 50_000 {
            let drop: Vec<String> = map.keys().take(10_000).cloned().collect();
            for k in drop {
                map.remove(&k);
            }
        }
    }

    pub fn reset(&self, key: &str) {
        self.failures.lock().remove(key);
    }
}

// ---- request.ts ----

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    for v in headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()) {
        for part in v.split(';') {
            let Some(i) = part.find('=') else { continue };
            if part[..i].trim() == name {
                let raw = part[i + 1..].trim();
                return url::form_urlencoded::parse(format!("v={}", raw.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned());
            }
        }
    }
    None
}

static BEARER: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^Bearer\s+(\S+)\s*$").unwrap());

/// The raw token: `Authorization: Bearer <token>` first, else the session cookie.
pub fn raw_token(headers: &HeaderMap) -> Option<String> {
    if let Some(m) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| BEARER.captures(v)) {
        return Some(m[1].to_string());
    }
    cookie_value(headers, SESSION_COOKIE)
}

/// The signed-in account, or None.
pub async fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<Option<Session>, HttpError> {
    let Some(raw) = raw_token(headers) else { return Ok(None) };
    let auth = state.auth.clone();
    Ok(tokio::task::spawn_blocking(move || auth.resolve_token(&raw)).await.map_err(|e| anyhow!(e))??)
}

pub fn session_cookie(token: &str, secure: bool) -> String {
    let mut parts = vec![format!("{SESSION_COOKIE}={token}"), "Path=/".into(), "HttpOnly".into(), "SameSite=Lax".into(), format!("Max-Age={}", SESSION_DAYS * 86_400)];
    if secure {
        parts.push("Secure".into());
    }
    parts.join("; ")
}

pub fn cleared_session_cookie(secure: bool) -> String {
    let mut parts = vec![format!("{SESSION_COOKIE}="), "Path=/".into(), "HttpOnly".into(), "SameSite=Lax".into(), "Max-Age=0".into()];
    if secure {
        parts.push("Secure".into());
    }
    parts.join("; ")
}

/// The client IP for rate limiting. X-Forwarded-For only counts when TRUST_PROXY=true, since clients can forge it.
pub fn client_ip(headers: &HeaderMap, trust_proxy: bool) -> String {
    if !trust_proxy {
        return "direct".into();
    }
    let get = |h: &str| headers.get(h).and_then(|v| v.to_str().ok()).map(str::trim).map(String::from);
    get("x-forwarded-for")
        .and_then(|v| v.split(',').next().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .or_else(|| get("x-real-ip").filter(|s| !s.is_empty()))
        .unwrap_or_else(|| "unknown".into())
}

// ---- scope.ts ----

fn empty(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null)) || v.and_then(Value::as_str) == Some("")
}

/// Pins a query or body to the caller's org: a missing orgId becomes theirs, a different one is a 403.
/// With `user`, a missing userId becomes theirs too. No caller (auth disabled) passes the input through.
pub fn scope_input(p: Option<&Session>, raw: Value, user: bool) -> Result<Value, HttpError> {
    let (Some(p), Value::Object(mut o)) = (p, raw.clone()) else { return Ok(raw) };
    if empty(o.get("orgId")) {
        o.insert("orgId".into(), Value::String(p.org_id.clone()));
    } else if o.get("orgId").and_then(Value::as_str) != Some(p.org_id.as_str()) {
        let shown = match o.get("orgId") {
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
            None => String::new(),
        };
        return Err(HttpError::forbidden(format!("your account belongs to org \"{}\", not \"{shown}\"", p.org_id)));
    }
    if user && empty(o.get("userId")) {
        o.insert("userId".into(), Value::String(p.user_id.clone()));
    }
    Ok(Value::Object(o))
}

/// Same-org check for an org id taken from the path.
pub fn assert_org(p: Option<&Session>, org_id: &str) -> Result<(), HttpError> {
    match p {
        Some(p) if p.org_id != org_id => Err(HttpError::forbidden(format!("your account belongs to org \"{}\", not \"{org_id}\"", p.org_id))),
        _ => Ok(()),
    }
}

/// Writing as someone takes being them, or an admin of the org.
pub fn assert_acting_as(p: Option<&Session>, user_id: &str) -> Result<(), HttpError> {
    match p {
        Some(p) if !p.admin && p.user_id != user_id => {
            Err(HttpError::forbidden(format!("you are signed in as \"{}\" and cannot act as \"{user_id}\"", p.user_id)))
        }
        _ => Ok(()),
    }
}

pub fn assert_admin(p: Option<&Session>) -> Result<(), HttpError> {
    match p {
        Some(p) if !p.admin => Err(HttpError::forbidden("only an org admin can do this")),
        _ => Ok(()),
    }
}

// ---- Extractors (route() in src/server/http.ts) ----

/// The caller of a protected route: 401 without a valid token, unless AUTH_DISABLED (then `None`).
pub struct Auth(pub Option<Session>);

impl Auth {
    pub fn session(&self) -> Option<&Session> {
        self.0.as_ref()
    }
    /// `scopedQuery` / `scopedBody`
    pub fn scope(&self, raw: Value, user: bool) -> Result<Value, HttpError> {
        scope_input(self.session(), raw, user)
    }
    /// `actingAs`
    pub fn acting_as(&self, user_id: &str) -> Result<(), HttpError> {
        assert_acting_as(self.session(), user_id)
    }
    /// `sameOrg`
    pub fn same_org(&self, org_id: &str) -> Result<(), HttpError> {
        assert_org(self.session(), org_id)
    }
    /// `adminOnly`
    pub fn admin_only(&self) -> Result<(), HttpError> {
        assert_admin(self.session())
    }
}

impl FromRequestParts<Arc<AppState>> for Auth {
    type Rejection = HttpError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, Self::Rejection> {
        if state.config.auth_disabled {
            return Ok(Auth(None));
        }
        match authenticate(state, &parts.headers).await? {
            Some(s) => Ok(Auth(Some(s))),
            None => Err(HttpError::new(401, SIGN_IN_REQUIRED)),
        }
    }
}

/// For public routes that look at the caller themselves (`authenticate(req)` in TS): never rejects.
pub struct MaybeAuth(pub Option<Session>);

impl FromRequestParts<Arc<AppState>> for MaybeAuth {
    type Rejection = HttpError;

    async fn from_request_parts(parts: &mut Parts, state: &Arc<AppState>) -> Result<Self, Self::Rejection> {
        Ok(MaybeAuth(authenticate(state, &parts.headers).await?))
    }
}

impl MaybeAuth {
    /// `requirePrincipal`: the caller or 401.
    pub fn require(self) -> Result<Session, HttpError> {
        self.0.ok_or_else(|| HttpError::new(401, SIGN_IN_REQUIRED))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scrypt_matches_node() {
        // Produced by src/auth/crypto.ts hashPassword("correct horse") with tsx.
        let node = include_str!("auth_scrypt_fixture.txt").trim();
        assert!(verify_password("correct horse", node));
        assert!(!verify_password("wrong horse", node));
        let ours = hash_password("correct horse").unwrap();
        assert!(ours.starts_with("scrypt$16384$8$1$"));
        assert!(verify_password("correct horse", &ours));
        assert!(!verify_password("x", "bcrypt$nope"));
    }

    #[test]
    fn tokens_and_cookies() {
        assert_eq!(new_raw_token().len(), 43);
        assert_eq!(new_id().len(), 12);
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, "a=1; orion_session=tok; b=2".parse().unwrap());
        assert_eq!(raw_token(&h).as_deref(), Some("tok"));
        h.insert(header::AUTHORIZATION, "bearer xyz".parse().unwrap());
        assert_eq!(raw_token(&h).as_deref(), Some("xyz"));
        assert_eq!(session_cookie("t", true), "orion_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure");
        assert_eq!(client_ip(&h, false), "direct");
    }

    #[test]
    fn accounts_and_tokens() {
        let a = AuthStore::memory().unwrap();
        let acct = a.create_account(" Ana ", "correct horse", "demo", "priya", true).unwrap();
        assert_eq!(acct.username, "ana");
        assert!(a.create_account("ana", "another one", "demo", "x", false).unwrap_err().to_string().contains("is taken"));
        assert!(a.create_account("a", "longenough", "demo", "x", false).unwrap_err().to_string().contains("2-40"));
        let (raw, info) = a.issue_token("ana", TokenKind::Api, "cli").unwrap();
        assert_eq!(info.expires_at, None);
        let s = a.resolve_token(&raw).unwrap().unwrap();
        assert_eq!((s.org_id.as_str(), s.kind, s.token_id.as_str()), ("demo", TokenKind::Api, info.id.as_str()));
        let (sess, sinfo) = a.issue_token("ana", TokenKind::Session, "login").unwrap();
        assert!(sinfo.expires_at.is_some());
        assert_eq!(a.list_tokens("ana").unwrap().len(), 2);
        a.set_password("ana", "brand new pass").unwrap();
        assert!(a.resolve_token(&sess).unwrap().is_none(), "a new password signs out sessions");
        assert!(a.resolve_token(&raw).unwrap().is_some(), "api tokens survive");
        assert!(a.revoke_token(&info.id).unwrap());
        assert!(a.resolve_token(&raw).unwrap().is_none());
    }

    #[test]
    fn limiter_blocks_after_ten() {
        let l = LoginLimiter::default();
        for i in 0..10 {
            assert_eq!(l.blocked_for("k", 1_000 + i), 0);
            l.fail("k", 1_000 + i);
        }
        assert!(l.blocked_for("k", 2_000) > 0);
        assert_eq!(l.blocked_for("k", 1_000 + 15 * 60_000 + 10), 0);
    }

    #[test]
    fn scope_rules() {
        let s = Session {
            username: "u".into(),
            org_id: "acme".into(),
            user_id: "devon".into(),
            admin: false,
            created_at: String::new(),
            token_id: "t".into(),
            kind: TokenKind::Session,
        };
        let v = scope_input(Some(&s), json!({}), true).unwrap();
        assert_eq!(v, json!({"orgId": "acme", "userId": "devon"}));
        let e = scope_input(Some(&s), json!({"orgId": "other"}), false).unwrap_err();
        assert_eq!((e.status, e.message.as_str()), (403, "your account belongs to org \"acme\", not \"other\""));
        assert_eq!(assert_acting_as(Some(&s), "priya").unwrap_err().message, "you are signed in as \"devon\" and cannot act as \"priya\"");
        assert!(assert_acting_as(None, "priya").is_ok());
        assert_eq!(assert_admin(Some(&s)).unwrap_err().message, "only an org admin can do this");
    }
}
