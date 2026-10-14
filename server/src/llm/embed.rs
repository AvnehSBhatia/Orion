//! Port of `src/llm/embed.ts`: the `Embedder` trait, query/document inputs, `with_context`, `normalize`,
//! the OpenRouter embedder, and the local hashing embedder (bit-for-bit the TS vectors).

use std::sync::Arc;

use anyhow::{Result, bail};
use async_trait::async_trait;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
use sha1::{Digest, Sha1};

use crate::config::{Config, EmbedProvider};
use crate::server::http::HttpError;

/// Queries and documents embed differently (EmbeddingGemma uses asymmetric task prefixes). A document may
/// carry one image (base64 jpeg/png/webp, no data: prefix), embedded together with its text. `context` is a
/// person's role: the asker's for a query, the author's for a document.
#[derive(Debug, Clone, PartialEq)]
pub enum EmbedInput {
    Query { text: String, context: Option<String> },
    Document { title: Option<String>, text: String, image: Option<String>, context: Option<String> },
}

impl EmbedInput {
    pub fn text(&self) -> &str {
        match self {
            EmbedInput::Query { text, .. } | EmbedInput::Document { text, .. } => text,
        }
    }
    pub fn context(&self) -> Option<&str> {
        match self {
            EmbedInput::Query { context, .. } | EmbedInput::Document { context, .. } => context.as_deref(),
        }
    }
}

#[async_trait]
pub trait Embedder: Send + Sync {
    /// Stored alongside every vector so a model or dimension change triggers a re-embed.
    fn model(&self) -> &str;
    async fn embed(&self, inputs: &[EmbedInput]) -> Result<Vec<Vec<f32>>>;
}

pub fn query(text: impl Into<String>, context: Option<&str>) -> EmbedInput {
    EmbedInput::Query { text: text.into(), context: context.map(String::from) }
}

pub fn doc(title: Option<&str>, text: impl Into<String>, image: Option<String>, context: Option<&str>) -> EmbedInput {
    EmbedInput::Document { title: title.map(String::from), text: text.into(), image, context: context.map(String::from) }
}

/// The text with its role context, in the form both providers embed.
pub fn with_context(input: &EmbedInput) -> String {
    match input {
        EmbedInput::Query { text, context: Some(c) } if !c.is_empty() => format!("asked by: {c} | {text}"),
        EmbedInput::Document { text, context: Some(c), .. } if !c.is_empty() => format!("author role: {c}\n{text}"),
        other => other.text().to_string(),
    }
}

fn plain_text(input: &EmbedInput) -> String {
    let text = with_context(input);
    match input {
        EmbedInput::Document { title: Some(t), .. } if !t.is_empty() => format!("{t}. {text}"),
        _ => text,
    }
}

/// Unit length (in f32, like the Float32Array math); a zero vector is returned unchanged.
pub fn normalize(v: &[f32]) -> Vec<f32> {
    let mut sum = 0f64;
    for &x in v {
        // JS sums Float32Array elements as doubles.
        sum += f64::from(x) * f64::from(x);
    }
    let norm = sum.sqrt();
    if norm == 0.0 {
        return v.to_vec();
    }
    v.iter().map(|&x| (f64::from(x) / norm) as f32).collect()
}

pub const OPENROUTER_EMBED_URL: &str = "https://openrouter.ai/api/v1/embeddings";
const BATCH: usize = 64;

pub struct OpenRouterEmbedder {
    api_key: String,
    model_id: String,
    dimensions: usize,
    model: String,
    http: reqwest::Client,
}

impl OpenRouterEmbedder {
    pub fn new(api_key: String, model_id: String, dimensions: usize) -> Self {
        let model = format!("{model_id}@{dimensions}");
        OpenRouterEmbedder { api_key, model_id, dimensions, model, http: reqwest::Client::new() }
    }

    async fn embed_batch(&self, input: &[String]) -> Result<Vec<Vec<f32>>> {
        #[derive(Deserialize)]
        struct Item {
            index: usize,
            embedding: Vec<f32>,
        }
        #[derive(Deserialize)]
        struct Resp {
            data: Vec<Item>,
        }
        let res = self
            .http
            .post(OPENROUTER_EMBED_URL)
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({ "model": self.model_id, "input": input, "dimensions": self.dimensions }))
            .send()
            .await;
        let res = match res {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let status = r.status();
                let body = r.text().await.unwrap_or_default();
                tracing::error!("OpenRouter embeddings {status}: {}", crate::text::js_take(&body, 500));
                bail!(HttpError::new(502, "embedding provider failed"));
            }
            Err(e) => {
                tracing::error!("OpenRouter embeddings unreachable: {e}");
                bail!(HttpError::new(502, "embedding provider failed"));
            }
        };
        let mut data = res.json::<Resp>().await.map_err(|_| anyhow::Error::from(HttpError::new(502, "embedding provider failed")))?.data;
        data.sort_by_key(|d| d.index);
        Ok(data.into_iter().map(|d| normalize(&d.embedding[..d.embedding.len().min(self.dimensions)])).collect())
    }
}

#[async_trait]
impl Embedder for OpenRouterEmbedder {
    fn model(&self) -> &str {
        &self.model
    }

    async fn embed(&self, inputs: &[EmbedInput]) -> Result<Vec<Vec<f32>>> {
        let texts: Vec<String> = inputs.iter().map(plain_text).collect();
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(BATCH) {
            out.extend(self.embed_batch(chunk).await?);
        }
        Ok(out)
    }
}

static WORDS: Lazy<Regex> = Lazy::new(|| Regex::new(r"[a-z0-9]+").unwrap());

/// Deterministic feature-hashing embedder: word unigrams and bigrams into signed buckets.
/// Only for offline dev and tests, where it gives lexical overlap rather than meaning.
pub struct LocalHashEmbedder {
    dimensions: usize,
    model: String,
}

impl LocalHashEmbedder {
    pub fn new(dimensions: usize) -> Self {
        LocalHashEmbedder { dimensions, model: format!("local-hash@{dimensions}") }
    }

    pub fn embed_one(&self, text: &str) -> Vec<f32> {
        let mut v = vec![0f32; self.dimensions];
        let lower = text.to_lowercase();
        let words: Vec<&str> = WORDS.find_iter(&lower).map(|m| m.as_str()).collect();
        let bigrams = words.windows(2).map(|w| format!("{} {}", w[0], w[1]));
        let terms = words.iter().map(|w| w.to_string()).chain(bigrams);
        for term in terms {
            let h = Sha1::digest(term.as_bytes());
            let bucket = u32::from_le_bytes([h[0], h[1], h[2], h[3]]) as usize % self.dimensions;
            v[bucket] += if h[4] & 1 == 1 { 1.0 } else { -1.0 };
        }
        normalize(&v)
    }
}

impl Default for LocalHashEmbedder {
    fn default() -> Self {
        Self::new(768)
    }
}

#[async_trait]
impl Embedder for LocalHashEmbedder {
    fn model(&self) -> &str {
        &self.model
    }

    async fn embed(&self, inputs: &[EmbedInput]) -> Result<Vec<Vec<f32>>> {
        Ok(inputs.iter().map(|i| self.embed_one(&plain_text(i))).collect())
    }
}

/// The embedder EMBED_PROVIDER asks for. Gemma falls back to the local embedder (with a warning) until the
/// in-process Gemma embedder is ported.
pub fn create_embedder(config: &Config) -> Result<Arc<dyn Embedder>> {
    match config.embed_provider {
        EmbedProvider::Gemma => match super::gemma::GemmaEmbedder::try_new(config) {
            Ok(g) => Ok(Arc::new(g)),
            Err(err) => {
                tracing::warn!(
                    "EMBED_PROVIDER=gemma: {err:#}. Falling back to the local hashing embedder; vectors from another model are re-embedded on use."
                );
                Ok(Arc::new(LocalHashEmbedder::new(config.embed_dimensions)))
            }
        },
        EmbedProvider::OpenRouter => {
            let Some(key) = config.open_router_key.clone() else { bail!("EMBED_PROVIDER=openrouter needs OPENROUTER_API_KEY") };
            Ok(Arc::new(OpenRouterEmbedder::new(key, config.embed_model.clone(), config.embed_dimensions)))
        }
        EmbedProvider::Local => {
            tracing::warn!("Using the local hashing embedder. Lexical only, for offline dev and tests.");
            Ok(Arc::new(LocalHashEmbedder::new(config.embed_dimensions)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_forms() {
        assert_eq!(with_context(&query("q", Some("eng"))), "asked by: eng | q");
        assert_eq!(with_context(&doc(Some("T"), "body", None, Some("eng"))), "author role: eng\nbody");
        assert_eq!(plain_text(&doc(Some("T"), "body", None, None)), "T. body");
        assert_eq!(plain_text(&query("q", None)), "q");
    }

    /// Non-zero entries of the TS LocalHashEmbedder's vector for the same document (generated with tsx).
    #[tokio::test]
    async fn local_hash_matches_ts() {
        let e = LocalHashEmbedder::new(768);
        let input = doc(
            Some("Voice mode"),
            "Cut voice reply delay from 2.4 seconds to under 1 second, waiting on the audio streaming service.",
            None,
            Some("Software engineer"),
        );
        let v = e.embed(&[input]).await.unwrap().remove(0);
        assert_eq!(e.model(), "local-hash@768");
        let expected: &[(usize, f32)] = include!("local_hash_fixture.in");
        let got: Vec<(usize, f32)> = v.iter().copied().enumerate().filter(|(_, x)| *x != 0.0).collect();
        assert_eq!(got, expected.to_vec());
    }
}
