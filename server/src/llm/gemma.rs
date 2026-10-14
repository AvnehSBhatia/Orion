//! Port of `src/llm/gemma.ts`. STUB: the in-process EmbeddingGemma 2 embedder (ONNX text + vision encoders)
//! is owned by another agent, who adds `ort`/`tokenizers`. Until then `try_new` fails and `create_embedder`
//! falls back to the local hashing embedder.

use anyhow::{Result, bail};
use async_trait::async_trait;
use once_cell::sync::Lazy;
use regex::Regex;

use super::embed::{EmbedInput, Embedder, with_context};
use crate::config::Config;

pub const BATCH: usize = 16;
pub const MAX_LENGTH: usize = 2048;
pub const MAX_SOFT_TOKENS: usize = 280;
/// An image expands to <|image> + MAX_SOFT_TOKENS soft tokens + <image|>; keep the whole sequence within MAX_LENGTH.
pub const IMAGE_TEXT_BUDGET: usize = MAX_LENGTH - MAX_SOFT_TOKENS - 8;

static MEDIA: Lazy<Regex> = Lazy::new(|| Regex::new(r"<\|(image|audio|video)\|>").unwrap());

/// Literal media placeholders in user text would be counted as soft-token slots and fail the forward pass.
pub fn escape_media(s: &str) -> String {
    MEDIA.replace_all(s, "<$1>").into_owned()
}

/// Model card prefixes. Queries and documents are asymmetric for retrieval.
pub fn gemma_text(input: &EmbedInput) -> String {
    let text = escape_media(&with_context(input));
    match input {
        EmbedInput::Query { .. } => format!("task: search result | query: {text}"),
        EmbedInput::Document { title, .. } => {
            let t = escape_media(title.as_deref().unwrap_or("")).replace('|', "/");
            let t = crate::text::js_trim(&t);
            format!("title: {} | text: {text}", if t.is_empty() { "none" } else { t })
        }
    }
}

/// EmbeddingGemma 2 in process, text and vision encoders. A document's image is placed after its prefixed
/// text, so both land in one mean-pooled, L2-normalized 768d vector.
pub struct GemmaEmbedder {
    model: String,
}

impl GemmaEmbedder {
    /// `${modelId}:${dtype}+vision@768`
    pub fn model_name(config: &Config) -> String {
        format!("{}:{}+vision@768", config.gemma_model, config.gemma_dtype.as_str())
    }

    /// Loads the model (downloading to MODEL_CACHE_DIR on first use).
    pub fn try_new(config: &Config) -> Result<Self> {
        let _ = Self::model_name(config);
        bail!("gemma embedder not built yet")
    }

    /// Loads the model ahead of the first request.
    pub async fn warm(&self) -> Result<()> {
        todo!("port GemmaEmbedder.warm from src/llm/gemma.ts")
    }
}

#[async_trait]
impl Embedder for GemmaEmbedder {
    fn model(&self) -> &str {
        &self.model
    }

    async fn embed(&self, _inputs: &[EmbedInput]) -> Result<Vec<Vec<f32>>> {
        todo!("port GemmaEmbedder.embed from src/llm/gemma.ts")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::embed::{doc, query};

    #[test]
    fn prefixes() {
        assert_eq!(gemma_text(&query("hi", None)), "task: search result | query: hi");
        assert_eq!(gemma_text(&doc(Some("a|b"), "x <|image|>", None, None)), "title: a/b | text: x <image>");
        assert_eq!(gemma_text(&doc(None, "x", None, None)), "title: none | text: x");
    }
}
