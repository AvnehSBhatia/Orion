//! Port of `src/config.ts`, plus the server and auth settings the TS backend did not have.
//!
//! Same env var names and defaults. `.env` is loaded once by [`load_dotenv`] (searched from the cwd upward,
//! so `server/` finds the repo root's file). Relative `DATA_DIR` and `MODEL_CACHE_DIR` resolve against the
//! directory the `.env` came from (the repo root), else against the repo root when run from `server/`,
//! else the cwd, so `cargo run` inside `server/` opens the same `data/` as `next dev` did.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedProvider {
    Gemma,
    OpenRouter,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GemmaDtype {
    Q8,
    Q4,
    Fp32,
}

impl GemmaDtype {
    pub fn as_str(self) -> &'static str {
        match self {
            GemmaDtype::Q8 => "q8",
            GemmaDtype::Q4 => "q4",
            GemmaDtype::Fp32 => "fp32",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestImages {
    Light,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedScreenshots {
    Auto,
    Always,
    Never,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// OPENROUTER_CHAT_MODEL. Built-in assistant; needs tools and structured outputs on OpenRouter.
    pub chat_model: String,
    /// OPENROUTER_EXTRACT_MODEL. Turns captured pages and commits into graph nodes.
    pub extract_model: String,
    /// OPENROUTER_FAST_MODEL (read by `llm::chat::FAST_MODEL` in TS).
    pub fast_model: String,
    pub open_router_key: Option<String>,
    pub embed_model: String,
    pub embed_dimensions: usize,
    pub embed_provider: EmbedProvider,
    pub gemma_model: String,
    /// q8 on CPU by default. Never fp16: EmbeddingGemma 2 overflows it and returns silent garbage.
    pub gemma_dtype: GemmaDtype,
    pub model_cache_dir: PathBuf,
    /// One SQLite file per org: `{data_dir}/orgs/{orgId}.db`.
    pub data_dir: PathBuf,
    pub ingest_images: IngestImages,
    pub ui_origins: Vec<String>,
    /// EMBED_SCREENSHOTS: when a source's screenshot goes into its embedding. auto (default): only when the
    /// capture has little text; always; never.
    pub embed_screenshots: EmbedScreenshots,
    /// SCREENSHOT_TEXT_MIN (400): in auto, a capture with less visible text than this embeds its screenshot.
    pub screenshot_text_min: usize,
    /// MAINTAIN_INTERVAL_MS (60000): minimum time between org maintenance runs.
    pub maintain_interval_ms: u64,

    // ---- Server and auth (new in the Rust port) ----
    pub port: u16,
    /// AUTH_DB, default `$DATA_DIR/auth.db`.
    pub auth_db: PathBuf,
    /// ALLOW_SIGNUP=true lets anyone create an org at POST /api/auth/signup. Off by default.
    pub allow_signup: bool,
    /// COOKIE_SECURE=true marks the session cookie Secure (behind HTTPS).
    pub cookie_secure: bool,
    /// AUTH_DISABLED=true skips sign-in on every route (local demos only).
    pub auth_disabled: bool,
    /// TRUST_PROXY=true reads the client IP from X-Forwarded-For for the login rate limit.
    pub trust_proxy: bool,
    /// EXTENSION_IDS. Empty means any `chrome-extension://` origin is allowed (warned at startup).
    pub extension_ids: Vec<String>,
    pub max_body_bytes: usize,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn flag(name: &str, default: bool) -> bool {
    match var(name).map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if ["1", "true", "yes", "on"].contains(&v.as_str()) => true,
        Some(v) if ["0", "false", "no", "off"].contains(&v.as_str()) => false,
        _ => default,
    }
}

/// `Number(x) || default`: unset, unparsable, or zero falls back.
fn number<T: std::str::FromStr + PartialEq + Default>(name: &str, default: T) -> T {
    match var(name).and_then(|v| v.trim().parse::<T>().ok()) {
        Some(v) if v != T::default() => v,
        _ => default,
    }
}

fn list(raw: &str) -> Vec<String> {
    raw.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

static BASE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Loads `.env` (cwd or any parent) once and remembers which directory relative paths resolve against.
pub fn load_dotenv() {
    let found = dotenvy::dotenv().ok();
    let base = match found.as_deref().and_then(Path::parent) {
        Some(dir) => dir.to_path_buf(),
        None => {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let in_server = cwd.file_name().is_some_and(|n| n == "server");
            match cwd.parent() {
                Some(parent) if in_server && parent.join("package.json").exists() => parent.to_path_buf(),
                _ => cwd,
            }
        }
    };
    let _ = BASE_DIR.set(base);
}

fn resolve(path: String) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p;
    }
    match BASE_DIR.get() {
        Some(base) => base.join(p),
        None => p,
    }
}

impl Config {
    /// Reads the environment (call [`load_dotenv`] first to pick up `.env`).
    pub fn from_env() -> Config {
        let data_dir = resolve(var("DATA_DIR").unwrap_or_else(|| "data".into()));
        let auth_db = var("AUTH_DB").map(resolve).unwrap_or_else(|| data_dir.join("auth.db"));
        Config {
            chat_model: var("OPENROUTER_CHAT_MODEL").unwrap_or_else(|| "deepseek/deepseek-v4-flash".into()),
            extract_model: var("OPENROUTER_EXTRACT_MODEL").unwrap_or_else(|| "deepseek/deepseek-v4-flash".into()),
            fast_model: var("OPENROUTER_FAST_MODEL").unwrap_or_else(|| "google/gemini-2.5-flash-lite".into()),
            open_router_key: var("OPENROUTER_API_KEY"),
            embed_model: var("OPENROUTER_EMBED_MODEL").unwrap_or_else(|| "google/gemini-embedding-2".into()),
            embed_dimensions: number("EMBED_DIMENSIONS", 768usize),
            embed_provider: match var("EMBED_PROVIDER").as_deref() {
                Some("local") => EmbedProvider::Local,
                Some("openrouter") => EmbedProvider::OpenRouter,
                _ => EmbedProvider::Gemma,
            },
            gemma_model: var("GEMMA_MODEL").unwrap_or_else(|| "onnx-community/embeddinggemma-2-ONNX".into()),
            gemma_dtype: match var("GEMMA_DTYPE").as_deref() {
                Some("q4") => GemmaDtype::Q4,
                Some("fp32") => GemmaDtype::Fp32,
                _ => GemmaDtype::Q8,
            },
            model_cache_dir: resolve(var("MODEL_CACHE_DIR").unwrap_or_else(|| ".cache/models".into())),
            data_dir,
            ingest_images: if var("INGEST_IMAGES").as_deref() == Some("full") { IngestImages::Full } else { IngestImages::Light },
            ui_origins: list(&var("UI_ORIGIN").unwrap_or_else(|| "http://localhost:3000".into())),
            embed_screenshots: match var("EMBED_SCREENSHOTS").as_deref() {
                Some("always") => EmbedScreenshots::Always,
                Some("never") => EmbedScreenshots::Never,
                _ => EmbedScreenshots::Auto,
            },
            screenshot_text_min: number("SCREENSHOT_TEXT_MIN", 400usize),
            maintain_interval_ms: number("MAINTAIN_INTERVAL_MS", 60_000u64),
            port: number("PORT", 3001u16),
            auth_db,
            allow_signup: flag("ALLOW_SIGNUP", false),
            cookie_secure: flag("COOKIE_SECURE", false),
            auth_disabled: flag("AUTH_DISABLED", false),
            trust_proxy: flag("TRUST_PROXY", false),
            extension_ids: list(&var("EXTENSION_IDS").unwrap_or_default()),
            max_body_bytes: number("MAX_BODY_BYTES", 4 * 1024 * 1024usize),
        }
    }

    /// Defaults for tests: everything under `data_dir`, local embedder, no key.
    pub fn for_tests(data_dir: &Path) -> Config {
        Config {
            chat_model: "test/chat".into(),
            extract_model: "test/extract".into(),
            fast_model: "test/fast".into(),
            open_router_key: None,
            embed_model: "test/embed".into(),
            embed_dimensions: 768,
            embed_provider: EmbedProvider::Local,
            gemma_model: "onnx-community/embeddinggemma-2-ONNX".into(),
            gemma_dtype: GemmaDtype::Q8,
            model_cache_dir: data_dir.join(".cache/models"),
            data_dir: data_dir.to_path_buf(),
            ingest_images: IngestImages::Light,
            ui_origins: vec!["http://localhost:3000".into()],
            embed_screenshots: EmbedScreenshots::Auto,
            screenshot_text_min: 400,
            maintain_interval_ms: 60_000,
            port: 0,
            auth_db: data_dir.join("auth.db"),
            allow_signup: true,
            cookie_secure: false,
            auth_disabled: false,
            trust_proxy: false,
            extension_ids: vec![],
            max_body_bytes: 4 * 1024 * 1024,
        }
    }

    /// `{data_dir}/orgs/{orgId}.db`
    pub fn org_db_path(&self, org_id: &str) -> PathBuf {
        self.data_dir.join("orgs").join(format!("{org_id}.db"))
    }

    pub fn has_model_key(&self) -> bool {
        self.open_router_key.is_some()
    }
}

static GLOBAL: OnceLock<Config> = OnceLock::new();

/// The process-wide config, read from the environment on first use. Module code that the TS read from
/// `config.*` getters uses this; request handlers use `AppState::config` (which tests can replace).
pub fn config() -> &'static Config {
    GLOBAL.get_or_init(Config::from_env)
}

/// Pins the global config (main does this after parsing env; tests may too). Ignored if already set.
pub fn set_global(c: Config) {
    let _ = GLOBAL.set(c);
}
