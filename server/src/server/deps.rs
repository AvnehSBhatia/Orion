//! Port of `src/server/deps.ts`: the per-process singletons, now one `AppState` shared by every handler.
//!
//! One SQLite handle per org (`{DATA_DIR}/orgs/{orgId}.db`); the file is the truth, so a deleted file means
//! the org is gone even if a handle is cached. The demo org is seeded on first open.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use parking_lot::Mutex;

use crate::auth::AuthStore;
use crate::config::Config;
use crate::contract::schemas::DEFAULT_ORG;
use crate::contract::types::{Org, OrgSummary};
use crate::db::seed::{demo_org, seed_demo};
use crate::db::store::{Db, Store, StoredUser};
use crate::ingest::pipeline::{Background, IngestDeps};
use crate::llm::chat::{ChatModel, LlmChat, open_router_stream};
use crate::llm::embed::{Embedder, create_embedder};
use crate::llm::extract::{Extractor, LlmExtractor};
use crate::llm::openrouter::{LlmClient, OpenRouterClient};
use crate::server::http::{CorsPolicy, HttpError};
use crate::time::now_iso;

pub struct AppState {
    pub config: Arc<Config>,
    stores: Mutex<HashMap<String, Arc<Store>>>,
    pub embedder: Arc<dyn Embedder>,
    pub llm: Arc<dyn LlmClient>,
    pub extractor: Arc<dyn Extractor>,
    pub chat: Arc<dyn ChatModel>,
    pub auth: Arc<AuthStore>,
    pub cors: Arc<CorsPolicy>,
    /// Org maintenance and coalesced refreshes after ingest. Off in tests, so ingest work runs inline.
    pub background: bool,
}

/// The pieces a test (or an alternative deployment) swaps in.
pub struct Parts {
    pub embedder: Arc<dyn Embedder>,
    pub llm: Arc<dyn LlmClient>,
    pub extractor: Arc<dyn Extractor>,
    pub chat: Arc<dyn ChatModel>,
    pub background: bool,
}

impl AppState {
    /// Production wiring from config: OpenRouter client, configured embedder, LLM extractor and chat.
    pub fn new(config: Config) -> Result<Arc<AppState>> {
        let embedder = create_embedder(&config)?;
        let router = Arc::new(OpenRouterClient::from_config(&config));
        let llm: Arc<dyn LlmClient> = router.clone();
        let extractor = Arc::new(LlmExtractor::new(llm.clone(), config.extract_model.clone()));
        let streamer = Some(open_router_stream_lazy(router));
        let chat = Arc::new(LlmChat::new(llm.clone(), config.fast_model.clone(), streamer));
        Self::with_parts(config, Parts { embedder, llm, extractor, chat, background: true })
    }

    pub fn with_parts(config: Config, parts: Parts) -> Result<Arc<AppState>> {
        let auth = Arc::new(AuthStore::open(&config.auth_db)?);
        let cors = Arc::new(CorsPolicy::from_config(&config));
        Ok(Arc::new(AppState {
            config: Arc::new(config),
            stores: Mutex::new(HashMap::new()),
            embedder: parts.embedder,
            llm: parts.llm,
            extractor: parts.extractor,
            chat: parts.chat,
            auth,
            cors,
            background: parts.background,
        }))
    }

    pub fn org_db_path(&self, org_id: &str) -> PathBuf {
        self.config.org_db_path(org_id)
    }

    /// The file is the truth: an org whose .db was deleted is gone, even if a handle to it is still cached.
    pub fn org_exists(&self, org_id: &str) -> bool {
        org_id == DEFAULT_ORG || self.org_db_path(org_id).exists()
    }

    fn open_store(&self, org_id: &str) -> Result<Arc<Store>> {
        let mut stores = self.stores.lock();
        if let Some(s) = stores.get(org_id) {
            // The file was deleted under us (a fresh demo start): drop the stale handle and open a new file.
            if org_id == DEFAULT_ORG || self.org_db_path(org_id).exists() {
                return Ok(s.clone());
            }
            stores.remove(org_id);
        }
        let store = Arc::new(Store::open(self.org_db_path(org_id))?);
        if org_id == DEFAULT_ORG {
            let db = store.db();
            if seed_demo(&db, false)? {
                tracing::info!("Seeded demo org into {}", self.org_db_path(org_id).display());
            }
            if db.get_org()?.is_none() {
                db.save_org(&demo_org(&now_iso()))?;
            }
        }
        stores.insert(org_id.to_string(), store.clone());
        Ok(store)
    }

    /// The org's store; 404 for an unknown org (the demo org is seeded on first use).
    pub fn store(&self, org_id: &str) -> Result<Arc<Store>, HttpError> {
        if !self.org_exists(org_id) {
            return Err(HttpError::not_found(format!(
                "unknown orgId \"{org_id}\". Create it with POST /api/orgs, or GET /api/orgs to list orgs."
            )));
        }
        Ok(self.open_store(org_id)?)
    }

    /// Creates the org's file with its profile; 409 when the id is taken.
    pub fn create_org_store(&self, org: &Org) -> Result<Arc<Store>, HttpError> {
        if self.org_exists(&org.id) {
            return Err(HttpError::new(409, format!("org \"{}\" already exists. Pick another id.", org.id)));
        }
        let store = self.open_store(&org.id)?;
        store.db().save_org(org)?;
        Ok(store)
    }

    /// Every org on disk plus the demo org, or with `only`, just that one (a signed-in caller sees only theirs).
    pub fn list_orgs(&self, only: Option<&str>) -> Result<Vec<OrgSummary>> {
        if let Some(id) = only {
            return if self.org_exists(id) { Ok(vec![self.org_summary(id)?]) } else { Ok(vec![]) };
        }
        let dir = self.config.data_dir.join("orgs");
        let mut ids: BTreeSet<String> = BTreeSet::from([DEFAULT_ORG.to_string()]);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                if let Some(id) = e.file_name().to_str().and_then(|n| n.strip_suffix(".db")) {
                    ids.insert(id.to_string());
                }
            }
        }
        ids.into_iter().map(|id| self.org_summary(&id)).collect()
    }

    pub fn org_summary(&self, id: &str) -> Result<OrgSummary> {
        let store = self.open_store(id)?;
        let db = store.db();
        let org = db.get_org()?;
        Ok(OrgSummary {
            id: id.to_string(),
            name: org.as_ref().map(|o| o.name.clone()).unwrap_or_else(|| id.to_string()),
            description: org.map(|o| o.description).unwrap_or_default(),
            members: db.list_users()?.len() as i64,
        })
    }

    pub fn ingest_deps(&self, org_id: &str) -> Result<IngestDeps, HttpError> {
        Ok(IngestDeps {
            store: self.store(org_id)?,
            embedder: self.embedder.clone(),
            extractor: self.extractor.clone(),
            background: self.background.then(|| Background { llm: self.llm.clone(), model: self.config.extract_model.clone() }),
            ocr: None,
        })
    }
}

/// The streaming function for the built-in assistant, bound to the OpenRouter client's key and connection pool.
fn open_router_stream_lazy(client: Arc<OpenRouterClient>) -> crate::llm::chat::Streamer {
    let key = client.key().map(String::from);
    let http = client.http().clone();
    // Built on first use so a stubbed llm::chat does not panic at startup.
    let cell: Arc<once_cell::sync::OnceCell<crate::llm::chat::Streamer>> = Arc::new(once_cell::sync::OnceCell::new());
    Arc::new(move |req, on_delta| {
        let s = cell.get_or_init(|| open_router_stream(key.clone(), http.clone())).clone();
        s(req, on_delta)
    })
}

/// 404 with the TS message when the person is not in the org.
pub fn require_user(db: &Db, user_id: &str) -> Result<StoredUser, HttpError> {
    db.get_user(user_id)?
        .ok_or_else(|| HttpError::not_found(format!("unknown userId \"{user_id}\". GET /api/users lists valid ids for the org.")))
}
