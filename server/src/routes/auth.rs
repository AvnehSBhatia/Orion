//! Port of `app/api/auth/**` (48ff660): signup, login, logout, me, accounts, tokens. These are the TS
//! `{ public: true }` routes; each checks the caller itself.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::auth::{Account, MaybeAuth, TokenKind, cleared_session_cookie, client_ip, normalize_username, session_cookie};
use crate::contract::schemas::{ID_RE, NewAccountRequest, create_token_request, login_request, new_account_request, signup_request, user_id};
use crate::contract::types::{Org, User};
use crate::db::store::Store;
use crate::server::deps::AppState;
use crate::server::http::{HttpError, JsonBody};
use crate::steer::users::recompute_user_vectors;
use crate::text::{js_take, slugify};
use crate::time::{now_iso, now_ms};

fn with_cookie(body: Value, cookie: String) -> Response {
    let mut res = axum::Json(body).into_response();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        res.headers_mut().append(header::SET_COOKIE, v);
    }
    res
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> Result<T, HttpError> {
    Ok(tokio::task::spawn_blocking(f).await.map_err(|e| anyhow::anyhow!(e))??)
}

/// `login` in src/auth/service.ts: 429 after 10 failures per ip+username in 15 minutes.
pub async fn login(State(state): State<Arc<AppState>>, headers: HeaderMap, JsonBody(body): JsonBody) -> Result<Response, HttpError> {
    let body = login_request(&body)?;
    let username = normalize_username(&body.username);
    let key = format!("{}|{username}", client_ip(&headers, state.config.trust_proxy));
    let wait = state.auth.limiter.blocked_for(&key, now_ms());
    if wait > 0 {
        let minutes = (wait as f64 / 60.0).ceil() as i64;
        return Err(HttpError::new(429, format!("too many failed sign-ins. Try again in {minutes} minute(s).")));
    }
    let auth = state.auth.clone();
    let (u, password) = (username.clone(), body.password);
    let account = blocking(move || {
        let stored = auth.password_hash(&u)?;
        let ok = crate::auth::verify_password(&password, stored.as_deref().unwrap_or_else(|| crate::auth::dummy_hash()));
        Ok(if stored.is_some() && ok { auth.get_account(&u)? } else { None })
    })
    .await?;
    let Some(account) = account else {
        state.auth.limiter.fail(&key, now_ms());
        return Err(HttpError::new(401, "wrong username or password"));
    };
    state.auth.limiter.reset(&key);
    let (token, _) = state.auth.issue_token(&username, TokenKind::Session, "login")?;
    let out = json!({ "token": token, "orgId": account.org_id, "userId": account.user_id, "admin": account.admin, "username": username });
    Ok(with_cookie(out, session_cookie(&token, state.config.cookie_secure)))
}

/// Revokes the token this request carries (cookie or bearer) and clears the cookie.
pub async fn logout(State(state): State<Arc<AppState>>, MaybeAuth(p): MaybeAuth) -> Result<Response, HttpError> {
    if let Some(p) = p {
        state.auth.revoke_token(&p.token_id)?;
    }
    Ok(with_cookie(json!({ "ok": true }), cleared_session_cookie(state.config.cookie_secure)))
}

/// Who is signed in. 401 when nobody is; `authDisabled: true` when the server runs with AUTH_DISABLED=true.
pub async fn me(State(state): State<Arc<AppState>>, MaybeAuth(p): MaybeAuth) -> Result<axum::Json<Value>, HttpError> {
    let disabled = state.config.auth_disabled;
    if let Some(p) = p {
        return Ok(axum::Json(json!({ "username": p.username, "orgId": p.org_id, "userId": p.user_id, "admin": p.admin, "kind": p.kind, "authDisabled": disabled })));
    }
    if disabled {
        return Ok(axum::Json(json!({ "authDisabled": true })));
    }
    Err(HttpError::new(401, crate::auth::SIGN_IN_REQUIRED))
}

/// Adds the person to the org if they are not in it yet. True when it created them.
pub fn ensure_person(store: &Store, user_id: &str, name: Option<&str>, role: Option<&str>) -> anyhow::Result<bool> {
    let db = store.db();
    if db.get_user(user_id)?.is_some() {
        return Ok(false);
    }
    let name = name.filter(|n| !n.is_empty()).unwrap_or(user_id);
    let role = role.filter(|r| !r.is_empty()).unwrap_or("Member");
    db.save_user(&User { id: user_id.into(), name: name.into(), role: role.into(), team_description: String::new() })?;
    Ok(true)
}

/// `createAccountIn`: creates the account in an org (and the person in it). 409 when taken, 400 on bad input.
pub async fn create_account_in(state: &AppState, store: &Store, org_id: &str, body: NewAccountRequest) -> Result<(Account, bool), HttpError> {
    let username = normalize_username(&body.username);
    if state.auth.get_account(&username)?.is_some() {
        return Err(HttpError::new(409, format!("username \"{username}\" is taken")));
    }
    let uid = match &body.user_id {
        Some(u) => u.clone(),
        None => {
            let derived: String = username.chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' { c } else { '-' }).collect();
            user_id(&js_take(&derived, 40))?
        }
    };
    let auth = state.auth.clone();
    let (u, pw, org, id, admin) = (username.clone(), body.password.clone(), org_id.to_string(), uid.clone(), body.admin.unwrap_or(false));
    let account = tokio::task::spawn_blocking(move || auth.create_account(&u, &pw, &org, &id, admin))
        .await
        .map_err(|e| anyhow::anyhow!(e))?
        .map_err(|e| HttpError::bad_request(e.to_string()))?;
    let created = ensure_person(store, &uid, body.name.as_deref(), body.role.as_deref())?;
    Ok((account, created))
}

/// Only with ALLOW_SIGNUP=true: creates a new org and its first (admin) account, and signs in.
pub async fn signup(State(state): State<Arc<AppState>>, JsonBody(body): JsonBody) -> Result<Response, HttpError> {
    if !state.config.allow_signup {
        return Err(HttpError::forbidden("sign up is closed. Ask an admin for an account."));
    }
    let body = signup_request(&body)?;
    if state.auth.get_account(&body.account.username)?.is_some() {
        return Err(HttpError::new(409, format!("username \"{}\" is taken", normalize_username(&body.account.username))));
    }
    let org_id = body.org_id.clone().unwrap_or_else(|| js_take(&slugify(&body.org_name), 40));
    if !ID_RE.is_match(&org_id) {
        return Err(HttpError::bad_request("orgName needs a letter or number, or pass an orgId"));
    }
    let store = state.create_org_store(&Org {
        id: org_id.clone(),
        name: body.org_name.clone(),
        description: body.org_description.clone().unwrap_or_else(|| body.org_name.clone()),
        websites: vec![],
        context: String::new(),
        created_at: now_iso(),
    })?;
    let (account, _) = create_account_in(&state, &store, &org_id, NewAccountRequest { admin: Some(true), ..body.account }).await?;
    recompute_user_vectors(&store, state.embedder.as_ref()).await?;
    let (token, _) = state.auth.issue_token(&account.username, TokenKind::Session, "signup")?;
    let out = json!({ "token": token, "orgId": org_id, "userId": account.user_id, "admin": true, "username": account.username });
    Ok(with_cookie(out, session_cookie(&token, state.config.cookie_secure)))
}

/// An org admin adds an account to their org; the person is added to the org if missing.
pub async fn accounts(State(state): State<Arc<AppState>>, caller: MaybeAuth, JsonBody(body): JsonBody) -> Result<axum::Json<Value>, HttpError> {
    let p = caller.require()?;
    if !p.admin {
        return Err(HttpError::forbidden("only an org admin can create accounts"));
    }
    let body = new_account_request(&body)?;
    let store = state.store(&p.org_id)?;
    let (account, created) = create_account_in(&state, &store, &p.org_id, body).await?;
    if created {
        recompute_user_vectors(&store, state.embedder.as_ref()).await?;
    }
    Ok(axum::Json(json!({ "account": account })))
}

/// Your tokens (sessions and API tokens), without the secrets.
pub async fn list_tokens(State(state): State<Arc<AppState>>, caller: MaybeAuth) -> Result<axum::Json<Value>, HttpError> {
    let p = caller.require()?;
    Ok(axum::Json(json!({ "tokens": state.auth.list_tokens(&p.username)? })))
}

/// A new API token for MCP, the extension, or CI. The raw token is in this response only.
pub async fn create_token(State(state): State<Arc<AppState>>, caller: MaybeAuth, body: axum::body::Bytes) -> Result<axum::Json<Value>, HttpError> {
    let p = caller.require()?;
    let raw: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
    let label = create_token_request(&raw)?;
    let (token, info) = state.auth.issue_token(&p.username, TokenKind::Api, &label)?;
    let mut out = serde_json::to_value(&info)?;
    if let Value::Object(m) = &mut out {
        m.insert("token".into(), json!(token));
        m.insert("orgId".into(), json!(p.org_id));
        m.insert("userId".into(), json!(p.user_id));
    }
    Ok(axum::Json(out))
}

/// Revoke one of your tokens. An admin may revoke any token of an account in their org.
pub async fn delete_token(State(state): State<Arc<AppState>>, caller: MaybeAuth, Path(id): Path<String>) -> Result<axum::Json<Value>, HttpError> {
    let p = caller.require()?;
    let found = state.auth.token_by_id(&id)?;
    let allowed = match &found {
        Some((_, owner)) if *owner == p.username => true,
        Some((_, owner)) => p.admin && state.auth.get_account(owner)?.is_some_and(|a| a.org_id == p.org_id),
        None => false,
    };
    if !allowed {
        return Err(HttpError::not_found(format!("unknown token \"{id}\"")));
    }
    state.auth.revoke_token(&id)?;
    Ok(axum::Json(json!({ "ok": true })))
}
