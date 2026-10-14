//! `orion serve` (default), `orion account create ...`, `orion seed [orgId]`.

use std::net::SocketAddr;

use anyhow::{Context, Result, bail};
use orion::auth::AuthStore;
use orion::config::{Config, load_dotenv, set_global};
use orion::contract::types::User;
use orion::db::seed::seed_demo;
use orion::db::store::Store;
use orion::server::deps::AppState;

const USAGE: &str = "usage:
  orion [serve]
  orion account create --username <u> --password <p> --org <orgId> --user <userId> [--name <n>] [--role <r>] [--admin]
  orion seed [orgId]";

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

#[tokio::main]
async fn main() -> Result<()> {
    load_dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=warn".into()))
        .init();
    let config = Config::from_env();
    set_global(config.clone());
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("serve") => serve(config).await,
        Some("account") if args.get(1).map(String::as_str) == Some("create") => account_create(&config, &args[2..]),
        Some("seed") => seed(config, args.get(1).cloned().unwrap_or_else(|| "demo".into())).await,
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}

async fn serve(config: Config) -> Result<()> {
    if config.extension_ids.is_empty() {
        tracing::warn!("EXTENSION_IDS is empty: any chrome-extension:// origin may call the API with credentials");
    }
    if config.auth_disabled {
        tracing::warn!("AUTH_DISABLED=true: every route is open. Never run this on a public box.");
    }
    let port = config.port;
    let data_dir = config.data_dir.clone();
    let state = AppState::new(config)?;
    let app = orion::routes::router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.with_context(|| format!("binding {addr}"))?;
    tracing::info!("orion listening on http://{addr} (data in {})", data_dir.display());
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

/// Port of `scripts/account.ts create`: creates the account, and the person in the org if missing.
fn account_create(config: &Config, args: &[String]) -> Result<()> {
    let need = |n: &str| flag(args, n).with_context(|| format!("missing {n}\n{USAGE}"));
    let (username, password, org, user) = (need("--username")?, need("--password")?, need("--org")?, need("--user")?);
    orion::contract::schemas::org_id(&org).map_err(|e| anyhow::anyhow!("{e}"))?;
    let path = config.org_db_path(&org);
    if org != "demo" && !path.exists() {
        bail!("unknown org \"{org}\" (no {})", path.display());
    }
    let store = Store::open(&path)?;
    {
        let db = store.db();
        if org == "demo" {
            seed_demo(&db, false)?;
        }
        if db.get_user(&user)?.is_none() {
            let name = flag(args, "--name").unwrap_or_else(|| user.clone());
            let role = flag(args, "--role").unwrap_or_else(|| "Member".into());
            db.save_user(&User { id: user.clone(), name, role, team_description: String::new() })?;
            println!("added {user} to {org}");
        }
    }
    let auth = AuthStore::open(&config.auth_db)?;
    let account = auth.create_account(&username, &password, &org, &user, args.iter().any(|a| a == "--admin"))?;
    println!("created account {} for {}/{}{}", account.username, account.org_id, account.user_id, if account.admin { " (admin)" } else { "" });
    Ok(())
}

/// Port of `scripts/seed.ts`: reset an org to the demo data, embed it, and run org maintenance.
async fn seed(config: Config, org_id: String) -> Result<()> {
    let state = AppState::new(config)?;
    let store = std::sync::Arc::new(Store::open(state.org_db_path(&org_id))?);
    seed_demo(&store.db(), true)?;
    let t = std::time::Instant::now();
    orion::steer::users::recompute_user_vectors(&store, state.embedder.as_ref()).await?;
    {
        let db = store.db();
        let c = db.counts()?;
        println!("Embedded {} nodes, {} sources, {} people with {} in {:.1}s", c.nodes, c.sources, db.list_users()?.len(), state.embedder.model(), t.elapsed().as_secs_f64());
    }
    let t = std::time::Instant::now();
    let r = orion::pseudo::maintain::maintain_org(&store, state.embedder.as_ref(), state.llm.as_ref(), &state.config.extract_model, true).await?;
    println!("\nOrg maintenance in {:.1}s", t.elapsed().as_secs_f64());
    println!("facets: {:?}\norg space: {:?}\ndigests: {:?}", r.facets, r.retrain, r.digests);
    println!("\nclusters:");
    for c in &r.clusters {
        println!("  {} ({})", c.label, c.size);
    }
    for u in store.db().list_users()? {
        let top: Vec<String> = u.ranked.unwrap_or_default().into_iter().take(4).collect();
        println!("  {:<6} {}", u.id, top.join(", "));
    }
    Ok(())
}
