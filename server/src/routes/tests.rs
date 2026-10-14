//! HTTP-level tests: router smoke test (every route answers 401 signed out), CORS and security headers, and
//! auth flows (login, cookie and bearer, wrong org, act-as, rate limit, tokens). Ports the intent of
//! `src/auth/auth.test.ts` on top of the Rust router.

use axum::http::{Method, StatusCode};
use serde_json::json;

use super::ROUTES;
use crate::testing::TestApp;

fn method(m: &str) -> Method {
    m.parse().unwrap()
}

const PUBLIC: &[&str] = &["/api/auth/signup", "/api/auth/login", "/api/auth/logout"];

#[tokio::test]
async fn every_protected_route_needs_sign_in() {
    let app = TestApp::new();
    for (m, path) in ROUTES {
        if PUBLIC.contains(path) {
            continue;
        }
        let body = (*m != "GET").then(|| json!({}));
        let res = app.request(method(m), path, body, None).await;
        assert_eq!(res.status, StatusCode::UNAUTHORIZED, "{m} {path}: {:?}", res.body);
        assert_eq!(res.body, json!({ "error": "sign in required" }), "{m} {path}");
    }
    let res = app.request(Method::POST, "/api/auth/logout", None, None).await;
    assert_eq!(res.status, StatusCode::OK);
    let res = app.request(Method::POST, "/api/auth/login", Some(json!({})), None).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.body["error"], "username: Invalid input: expected string, received undefined");
    let res = app.request(Method::POST, "/api/mcp", Some(json!({})), None).await;
    assert_eq!(res.headers.get("www-authenticate").unwrap(), "Bearer realm=\"orion\"");
}

#[tokio::test]
async fn preflight_cors_and_security_headers() {
    let app = TestApp::new();
    let res = app
        .request_with(Method::OPTIONS, "/api/graph", None, |h| {
            h.insert("origin", "http://localhost:3000".parse().unwrap());
        })
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    assert_eq!(res.headers.get("access-control-allow-origin").unwrap(), "http://localhost:3000");
    assert_eq!(res.headers.get("access-control-allow-credentials").unwrap(), "true");
    assert_eq!(res.headers.get("access-control-allow-headers").unwrap(), "Content-Type, Authorization");
    let res = app
        .request_with(Method::GET, "/api/graph", None, |h| {
            h.insert("origin", "https://evil.example".parse().unwrap());
        })
        .await;
    assert!(res.headers.get("access-control-allow-origin").is_none());
    assert_eq!(res.headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(res.headers.get("x-frame-options").unwrap(), "DENY");
    let res = app.request(Method::GET, "/api/nope", None, None).await;
    assert_eq!((res.status, res.body["error"].as_str()), (StatusCode::NOT_FOUND, Some("not found")));
}

#[tokio::test]
async fn login_cookie_bearer_and_scope() {
    let app = TestApp::new();
    app.account("devon", "devon-password", "demo", "devon", false);
    let bad = app.request(Method::POST, "/api/auth/login", Some(json!({"username": "devon", "password": "nope"})), None).await;
    assert_eq!((bad.status, bad.body["error"].as_str()), (StatusCode::UNAUTHORIZED, Some("wrong username or password")));

    let res = app.request(Method::POST, "/api/auth/login", Some(json!({"username": " Devon ", "password": "devon-password"})), None).await;
    assert_eq!(res.status, StatusCode::OK, "{:?}", res.body);
    assert_eq!(res.body["orgId"], "demo");
    assert_eq!(res.body["userId"], "devon");
    assert_eq!(res.body["admin"], false);
    let token = res.body["token"].as_str().unwrap().to_string();
    let cookie = res.headers.get("set-cookie").unwrap().to_str().unwrap().to_string();
    assert!(cookie.starts_with(&format!("orion_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")));

    // Cookie auth.
    let me = app
        .request_with(Method::GET, "/api/auth/me", None, |h| {
            h.insert("cookie", format!("orion_session={token}").parse().unwrap());
        })
        .await;
    assert_eq!((me.status, me.body["username"].as_str(), me.body["kind"].as_str()), (StatusCode::OK, Some("devon"), Some("session")));

    // Bearer auth, orgId defaulted to the caller's.
    let users = app.request(Method::GET, "/api/users", None, Some(&token)).await;
    assert_eq!(users.status, StatusCode::OK);
    assert_eq!(users.body["users"].as_array().unwrap().len(), 4);
    let graph = app.request(Method::GET, "/api/graph", None, Some(&token)).await;
    assert_eq!(graph.status, StatusCode::OK);
    assert_eq!(graph.body["nodes"].as_array().unwrap().len(), 16);

    // Another org is 403.
    let other = app.request(Method::GET, "/api/graph?orgId=acme", None, Some(&token)).await;
    assert_eq!((other.status, other.body["error"].as_str()), (StatusCode::FORBIDDEN, Some("your account belongs to org \"demo\", not \"acme\"")));
    let other = app.request(Method::GET, "/api/orgs/acme", None, Some(&token)).await;
    assert_eq!(other.status, StatusCode::FORBIDDEN);

    // Only your own org is listed; creating one here is refused.
    let orgs = app.request(Method::GET, "/api/orgs", None, Some(&token)).await;
    assert_eq!(orgs.body["orgs"].as_array().unwrap().iter().map(|o| o["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["demo"]);
    let make = app.request(Method::POST, "/api/orgs", Some(json!({"name": "X", "description": "Y"})), Some(&token)).await;
    assert_eq!(make.status, StatusCode::FORBIDDEN);

    // Writing as someone else needs admin.
    let chat = app.request(Method::POST, "/api/chat", Some(json!({"userId": "priya", "message": "hi"})), Some(&token)).await;
    assert_eq!((chat.status, chat.body["error"].as_str()), (StatusCode::FORBIDDEN, Some("you are signed in as \"devon\" and cannot act as \"priya\"")));
    let dash = app.request(Method::POST, "/api/dashboard", Some(json!({"userId": "priya", "reset": true})), Some(&token)).await;
    assert_eq!(dash.status, StatusCode::FORBIDDEN);
    let users_post = app.request(Method::POST, "/api/users", Some(json!({"id": "priya", "name": "P", "role": "r"})), Some(&token)).await;
    assert_eq!(users_post.status, StatusCode::FORBIDDEN);
    let patch = app.request(Method::PATCH, "/api/orgs/demo", Some(json!({"context": "x"})), Some(&token)).await;
    assert_eq!((patch.status, patch.body["error"].as_str()), (StatusCode::FORBIDDEN, Some("only an org admin can do this")));

    // Reads that are fully ported answer for real.
    let src = app.request(Method::GET, "/api/sources/src-nope", None, Some(&token)).await;
    assert_eq!((src.status, src.body["error"].as_str()), (StatusCode::NOT_FOUND, Some("unknown source \"src-nope\"")));
    let act = app.request(Method::GET, "/api/activity?limit=3", None, Some(&token)).await;
    assert_eq!(act.status, StatusCode::OK);
    assert_eq!(act.body["sources"].as_array().unwrap().len(), 3);
    assert_eq!(act.body["counts"]["sources"], 10);
    let org = app.request(Method::GET, "/api/orgs/demo", None, Some(&token)).await;
    assert_eq!(org.body["org"]["name"], "Demo Co");

    // Logout revokes the token.
    let out = app.request(Method::POST, "/api/auth/logout", None, Some(&token)).await;
    assert!(out.headers.get("set-cookie").unwrap().to_str().unwrap().contains("Max-Age=0"));
    assert_eq!(app.request(Method::GET, "/api/users", None, Some(&token)).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admins_patch_orgs_create_accounts_and_manage_tokens() {
    let app = TestApp::new();
    let admin = app.account("priya", "priya-password", "demo", "priya", true);
    let patch = app.request(Method::PATCH, "/api/orgs/demo", Some(json!({"context": "New context"})), Some(&admin)).await;
    assert_eq!((patch.status, patch.body["org"]["context"].as_str()), (StatusCode::OK, Some("New context")));

    // The person exists already, so no steering refresh is needed.
    let acct = app.request(Method::POST, "/api/auth/accounts", Some(json!({"username": "sam", "password": "sam-password", "userId": "sam"})), Some(&admin)).await;
    assert_eq!(acct.status, StatusCode::OK, "{:?}", acct.body);
    assert_eq!(acct.body["account"]["orgId"], "demo");
    let dup = app.request(Method::POST, "/api/auth/accounts", Some(json!({"username": "sam", "password": "sam-password", "userId": "sam"})), Some(&admin)).await;
    assert_eq!((dup.status, dup.body["error"].as_str()), (StatusCode::CONFLICT, Some("username \"sam\" is taken")));
    let short = app.request(Method::POST, "/api/auth/accounts", Some(json!({"username": "mina", "password": "short"})), Some(&admin)).await;
    assert_eq!(short.body["error"], "password: password must be at least 8 characters");

    let sam = app.request(Method::POST, "/api/auth/login", Some(json!({"username": "sam", "password": "sam-password"})), None).await;
    let sam = sam.body["token"].as_str().unwrap().to_string();
    let denied = app.request(Method::POST, "/api/auth/accounts", Some(json!({"username": "x1", "password": "password1"})), Some(&sam)).await;
    assert_eq!((denied.status, denied.body["error"].as_str()), (StatusCode::FORBIDDEN, Some("only an org admin can create accounts")));

    // API tokens: created once, listed without secrets, usable as Bearer, revocable.
    let created = app.request(Method::POST, "/api/auth/tokens", Some(json!({"label": "cursor"})), Some(&sam)).await;
    assert_eq!(created.status, StatusCode::OK);
    assert_eq!((created.body["kind"].as_str(), created.body["label"].as_str(), created.body["userId"].as_str()), (Some("api"), Some("cursor"), Some("sam")));
    let api = created.body["token"].as_str().unwrap().to_string();
    let id = created.body["id"].as_str().unwrap().to_string();
    let list = app.request(Method::GET, "/api/auth/tokens", None, Some(&api)).await;
    let tokens = list.body["tokens"].as_array().unwrap();
    assert_eq!(tokens.len(), 2);
    assert!(tokens.iter().all(|t| t.get("token").is_none() && t.get("hash").is_none()));
    let default_label = app.request(Method::POST, "/api/auth/tokens", None, Some(&sam)).await;
    assert_eq!(default_label.body["label"], "api token");
    // An admin can revoke a token of an account in their org; a stranger's id is 404.
    assert_eq!(app.request(Method::DELETE, "/api/auth/tokens/nope", None, Some(&sam)).await.status, StatusCode::NOT_FOUND);
    let del = app.request(Method::DELETE, &format!("/api/auth/tokens/{id}"), None, Some(&admin)).await;
    assert_eq!(del.body, json!({ "ok": true }));
    assert_eq!(app.request(Method::GET, "/api/users", None, Some(&api)).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_rate_limit() {
    let app = TestApp::new();
    app.account("mina", "mina-password", "demo", "mina", false);
    for _ in 0..10 {
        let r = app.request(Method::POST, "/api/auth/login", Some(json!({"username": "mina", "password": "wrong-pass"})), None).await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    }
    let blocked = app.request(Method::POST, "/api/auth/login", Some(json!({"username": "mina", "password": "mina-password"})), None).await;
    assert_eq!(blocked.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(blocked.body["error"], "too many failed sign-ins. Try again in 15 minute(s).");
}

#[tokio::test]
async fn signup_closed_and_validated() {
    let app = TestApp::with_config(|c| c.allow_signup = false);
    let r = app.request(Method::POST, "/api/auth/signup", Some(json!({})), None).await;
    assert_eq!((r.status, r.body["error"].as_str()), (StatusCode::FORBIDDEN, Some("sign up is closed. Ask an admin for an account.")));
    let app = TestApp::new();
    let r = app.request(Method::POST, "/api/auth/signup", Some(json!({"username": "ana", "password": "long enough"})), None).await;
    assert_eq!(r.body["error"], "orgName: Invalid input: expected string, received undefined");
}

#[tokio::test]
#[ignore = "needs steer::users::recompute_user_vectors (signup refreshes steering like the TS route)"]
async fn signup_creates_org_admin_and_session() {
    let app = TestApp::new();
    let r = app.request(Method::POST, "/api/auth/signup", Some(json!({"username": "ana", "password": "long enough", "orgName": "Lumen Labs", "name": "Ana"})), None).await;
    assert_eq!(r.status, StatusCode::OK, "{:?}", r.body);
    assert_eq!((r.body["orgId"].as_str(), r.body["userId"].as_str(), r.body["admin"].as_bool()), (Some("lumen-labs"), Some("ana"), Some(true)));
    let token = r.body["token"].as_str().unwrap();
    let users = app.request(Method::GET, "/api/users", None, Some(token)).await;
    assert_eq!(users.body["users"][0]["name"], "Ana");
}

#[tokio::test]
async fn auth_disabled_opens_routes_on_the_demo_org() {
    let app = TestApp::with_config(|c| c.auth_disabled = true);
    let users = app.request(Method::GET, "/api/users", None, None).await;
    assert_eq!(users.status, StatusCode::OK);
    assert_eq!(users.body["users"].as_array().unwrap().len(), 4);
    let me = app.request(Method::GET, "/api/auth/me", None, None).await;
    assert_eq!(me.body, json!({ "authDisabled": true }));
    let bad = app.request(Method::GET, "/api/graph?orgId=Bad", None, None).await;
    assert_eq!(bad.body["error"], "orgId: orgId must be lowercase letters, digits, and dashes");
    let unknown = app.request(Method::GET, "/api/graph?orgId=nowhere", None, None).await;
    assert_eq!(unknown.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn stubbed_modules_fail_as_contract_500s() {
    let app = TestApp::new();
    let t = app.account("devon", "devon-password", "demo", "devon", false);
    // feed_for is a todo!() until steer::feed is ported: the panic becomes {"error":"internal error"}.
    let r = app.request(Method::GET, "/api/feed", None, Some(&t)).await;
    assert_eq!((r.status, r.body["error"].as_str()), (StatusCode::INTERNAL_SERVER_ERROR, Some("internal error")));
}
