//! EmbeddingGemma 2 in process on onnxruntime: text and vision encoders (audio not loaded).
//!
//! A port of `GemmaEmbedder` in src/llm/gemma.ts (Transformers.js + onnxruntime-node). A document's image is
//! placed after its prefixed text, so both land in one mean-pooled, L2-normalized 768d vector. Queries and
//! documents use the model card's asymmetric task prefixes.

pub mod text;
pub mod vision;

use anyhow::{anyhow, bail, Context, Result};
use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokenizers::Tokenizer;

pub use text::gemma_text;

/// Texts per forward pass.
pub const BATCH: usize = 16;
pub const MAX_LENGTH: usize = 2048;
pub const MAX_SOFT_TOKENS: usize = 280;
/// An image expands to <|image> + MAX_SOFT_TOKENS soft tokens + <image|>; keep the whole sequence within MAX_LENGTH.
pub const IMAGE_TEXT_BUDGET: usize = MAX_LENGTH - MAX_SOFT_TOKENS - 8;
pub const DIMENSIONS: usize = 768;
/// text_config.hidden_size: the width of the soft-token feature inputs.
const FEATURE_DIM: usize = 512;
const PAD_ID: i64 = 0;
const IMAGE_TOKEN: &str = "<|image|>";
const BOI_TOKEN: &str = "<|image>";
const EOI_TOKEN: &str = "<image|>";
const IMAGE_TOKEN_ID: u32 = 258880;

pub const DEFAULT_MODEL: &str = "onnx-community/embeddinggemma-2-ONNX";
const HF_BASE: &str = "https://huggingface.co";

#[derive(Debug, Clone)]
pub enum GemmaInput {
    /// `context` is the asker's role.
    Query { text: String, context: Option<String> },
    /// `image_b64` is base64 jpeg/png/webp, with or without a data: prefix. `context` is the author's role.
    Document { title: Option<String>, text: String, image_b64: Option<String>, context: Option<String> },
}

/// Never fp16: EmbeddingGemma 2 overflows it and returns silent garbage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Dtype {
    #[default]
    Q8,
    Q4,
    Fp32,
}

impl Dtype {
    /// Same parsing as src/config.ts: anything but q4/fp32 is q8.
    pub fn parse(s: &str) -> Self {
        match s {
            "q4" => Dtype::Q4,
            "fp32" => Dtype::Fp32,
            _ => Dtype::Q8,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Dtype::Q8 => "q8",
            Dtype::Q4 => "q4",
            Dtype::Fp32 => "fp32",
        }
    }
    /// Transformers.js file suffixes.
    fn suffix(self) -> &'static str {
        match self {
            Dtype::Q8 => "_quantized",
            Dtype::Q4 => "_q4",
            Dtype::Fp32 => "",
        }
    }
}

struct Loaded {
    tokenizer: Tokenizer,
    model: Session,
    vision: Session,
    _env: ort::environment::Environment,
}

pub struct GemmaEmbedder {
    model_dir: PathBuf,
    model_id: String,
    dtype: Dtype,
    /// onnxruntime sessions are run one call at a time; this also serializes concurrent embed calls.
    state: Mutex<Option<Loaded>>,
}

impl GemmaEmbedder {
    /// `model_dir` is `<cache>/<org>/<name>` in the Transformers.js cache layout. Nothing loads until first use.
    pub fn new(model_dir: PathBuf, dtype: Dtype) -> Self {
        let model_id = model_id_from_dir(&model_dir);
        Self { model_dir, model_id, dtype, state: Mutex::new(None) }
    }

    /// MODEL_CACHE_DIR (default .cache/models), GEMMA_MODEL, GEMMA_DTYPE, as in src/config.ts.
    pub fn from_env() -> Self {
        let cache = std::env::var("MODEL_CACHE_DIR").ok().filter(|s| !s.is_empty()).unwrap_or(".cache/models".into());
        let model = std::env::var("GEMMA_MODEL").ok().filter(|s| !s.is_empty()).unwrap_or(DEFAULT_MODEL.into());
        let dtype = Dtype::parse(&std::env::var("GEMMA_DTYPE").unwrap_or_default());
        let mut e = Self::new(Path::new(&cache).join(&model), dtype);
        e.model_id = model;
        e
    }

    /// Stored alongside every vector so a model or dimension change triggers a re-embed. Same string as the TS.
    pub fn model_id(&self) -> String {
        format!("{}:{}+vision@{}", self.model_id, self.dtype.as_str(), DIMENSIONS)
    }

    /// Load (downloading missing files first) without embedding anything.
    pub fn warm(&self) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| anyhow!("gemma embedder lock poisoned"))?;
        self.ensure_loaded(&mut state)?;
        Ok(())
    }

    /// Blocking. One vector per input, in order, each L2-normalized to unit length.
    pub fn embed(&self, inputs: &[GemmaInput]) -> Result<Vec<Vec<f32>>> {
        if inputs.is_empty() {
            return Ok(vec![]);
        }
        let mut state = self.state.lock().map_err(|_| anyhow!("gemma embedder lock poisoned"))?;
        let loaded = self.ensure_loaded(&mut state)?;

        let mut out: Vec<Option<Vec<f32>>> = vec![None; inputs.len()];
        let mut text_only = Vec::new();
        for (i, input) in inputs.iter().enumerate() {
            if let GemmaInput::Document { image_b64: Some(img), title, text, .. } = input {
                if !img.is_empty() {
                    // One document at a time: batching images gave no real speedup and much more peak memory.
                    match embed_with_image(loaded, input, img) {
                        Ok(v) => {
                            out[i] = Some(v);
                            continue;
                        }
                        Err(err) => {
                            let label = title.clone().unwrap_or_else(|| text.chars().take(40).collect());
                            tracing::warn!("Gemma image embed failed for \"{label}\", using text only: {err:#}");
                        }
                    }
                }
            }
            text_only.push(i);
        }
        for idx in text_only.chunks(BATCH) {
            let texts: Vec<String> = idx.iter().map(|&i| gemma_text(&inputs[i])).collect();
            let vectors = embed_texts(loaded, &texts)?;
            for (&i, v) in idx.iter().zip(vectors) {
                out[i] = Some(v);
            }
        }
        Ok(out.into_iter().map(|v| v.expect("every input embedded")).collect())
    }

    fn ensure_loaded<'a>(&self, state: &'a mut Option<Loaded>) -> Result<&'a mut Loaded> {
        if state.is_none() {
            *state = Some(self.load().with_context(|| format!("loading {} from {}", self.model_id(), self.model_dir.display()))?);
        }
        Ok(state.as_mut().unwrap())
    }

    fn load(&self) -> Result<Loaded> {
        let sfx = self.dtype.suffix();
        let model_file = format!("onnx/model{sfx}.onnx");
        let vision_file = format!("onnx/vision_encoder{sfx}.onnx");
        let files = [
            "tokenizer.json".to_string(),
            model_file.clone(),
            format!("{model_file}_data"),
            vision_file.clone(),
            format!("{vision_file}_data"),
        ];
        for f in &files {
            ensure_file(&self.model_dir, &self.model_id, f)?;
        }
        let tokenizer = Tokenizer::from_file(self.model_dir.join("tokenizer.json")).map_err(|e| anyhow!("tokenizer: {e}"))?;
        let env = ort::init().with_name("orion-gemma").build().map_err(ort_err)?;
        let session = |f: &str| -> Result<Session> {
            // CPU only, as onnxruntime-node runs it. ort's default device policy (MaxEfficiency) picks CoreML on
            // macOS, which rejects the zero-row feature inputs and changes the numerics.
            Session::builder(&env)
                .map_err(ort_err)?
                .with_auto_device(ort::session::builder::AutoDevicePolicy::PreferCPU)
                .map_err(ort_err)?
                .with_execution_providers([ort::ep::CPU::default().build()])
                .map_err(ort_err)?
                .commit_from_file(self.model_dir.join(f))
                .map_err(ort_err)
                .with_context(|| format!("onnx session {f}"))
        };
        let (model, vision) = (session(&model_file)?, session(&vision_file)?);
        Ok(Loaded { tokenizer, model, vision, _env: env })
    }
}

fn ort_err<E: std::fmt::Display>(e: E) -> anyhow::Error {
    anyhow!("{e}")
}

/// `<cache>/onnx-community/embeddinggemma-2-ONNX` -> `onnx-community/embeddinggemma-2-ONNX`.
fn model_id_from_dir(dir: &Path) -> String {
    let parts: Vec<String> = dir
        .components()
        .rev()
        .take(2)
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    match parts.as_slice() {
        [name, org] => format!("{org}/{name}"),
        [name] => name.clone(),
        _ => DEFAULT_MODEL.to_string(),
    }
}

/// Download a missing model file from the Hugging Face hub into the same layout Transformers.js uses.
fn ensure_file(dir: &Path, model_id: &str, rel: &str) -> Result<()> {
    let path = dir.join(rel);
    if path.exists() {
        return Ok(());
    }
    let url = format!("{HF_BASE}/{model_id}/resolve/main/{rel}");
    tracing::info!("downloading {url}");
    std::fs::create_dir_all(path.parent().unwrap())?;
    let resp = ureq::get(&url).call().with_context(|| format!("GET {url}"))?;
    let tmp = path.with_extension("part");
    let mut file = std::fs::File::create(&tmp)?;
    std::io::copy(&mut resp.into_reader(), &mut file).with_context(|| format!("download {url}"))?;
    file.sync_all()?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

fn encode(tok: &Tokenizer, text: &str, special: bool) -> Result<Vec<u32>> {
    Ok(tok.encode(text, special).map_err(|e| anyhow!("tokenize: {e}"))?.get_ids().to_vec())
}

fn empty_features() -> Result<Tensor<f32>> {
    Tensor::from_array(([0usize, FEATURE_DIM], Vec::<f32>::new())).map_err(ort_err)
}

/// Run the text model on padded rows and return unit-length sentence embeddings.
fn run_model(loaded: &mut Loaded, rows: &[Vec<u32>], image_features: Tensor<f32>) -> Result<Vec<Vec<f32>>> {
    let b = rows.len();
    let s = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut ids = vec![PAD_ID; b * s];
    let mut mask = vec![0i64; b * s];
    for (r, row) in rows.iter().enumerate() {
        for (c, &id) in row.iter().enumerate() {
            ids[r * s + c] = id as i64;
            mask[r * s + c] = 1;
        }
    }
    let outputs = loaded
        .model
        .run(ort::inputs![
            "input_ids" => Tensor::from_array(([b, s], ids)).map_err(ort_err)?,
            "attention_mask" => Tensor::from_array(([b, s], mask)).map_err(ort_err)?,
            "image_features" => image_features,
            "video_features" => empty_features()?,
            "audio_features" => empty_features()?,
        ])
        .map_err(ort_err)?;
    let (shape, data) = outputs["sentence_embedding"].try_extract_tensor::<f32>().map_err(ort_err)?;
    let dim = shape[1] as usize;
    if shape[0] as usize != b {
        bail!("sentence_embedding has {} rows for {b} inputs", shape[0]);
    }
    Ok(data.chunks(dim).map(normalize).collect())
}

fn normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm = if norm == 0.0 { 1.0 } else { norm };
    v.iter().map(|x| x / norm).collect()
}

/// Tokenizer call with `{ padding: true, truncation: true, max_length: 2048 }`: Transformers.js truncates after
/// adding special tokens by slicing, so an over-long text loses its trailing <eos>.
fn embed_texts(loaded: &mut Loaded, texts: &[String]) -> Result<Vec<Vec<f32>>> {
    let rows = texts
        .iter()
        .map(|t| {
            let mut ids = encode(&loaded.tokenizer, t, true)?;
            ids.truncate(MAX_LENGTH);
            Ok(ids)
        })
        .collect::<Result<Vec<_>>>()?;
    run_model(loaded, &rows, empty_features()?)
}

/// The text kept in front of an image: at most IMAGE_TEXT_BUDGET tokens, cut by a decode round trip as the TS does.
pub fn image_doc_text(tok: &Tokenizer, input: &GemmaInput) -> Result<String> {
    let text = gemma_text(input);
    let ids = encode(tok, &text, false)?;
    if ids.len() <= IMAGE_TEXT_BUDGET {
        return Ok(text);
    }
    let decoded = tok.decode(&ids[..IMAGE_TEXT_BUDGET], true).map_err(|e| anyhow!("detokenize: {e}"))?;
    Ok(text::clean_up_tokenization(&decoded))
}

/// `EmbeddingGemma2Processor`: each `<|image|>` becomes `<|image>` + n x `<|image|>` + `<image|>`.
pub fn expand_image_placeholder(text: &str, num_soft_tokens: usize) -> Result<String> {
    let count = text.matches(IMAGE_TOKEN).count();
    if count != 1 {
        bail!("Found {count} {IMAGE_TOKEN} tokens in the text, but 1 inputs were passed.");
    }
    Ok(text.replace(IMAGE_TOKEN, &format!("{BOI_TOKEN}{}{EOI_TOKEN}", IMAGE_TOKEN.repeat(num_soft_tokens))))
}

fn embed_with_image(loaded: &mut Loaded, input: &GemmaInput, image_b64: &str) -> Result<Vec<f32>> {
    let img = vision::decode_b64(image_b64)?;
    let text = image_doc_text(&loaded.tokenizer, input)?;
    let patches = vision::preprocess(&img, MAX_SOFT_TOKENS)?;
    let full = expand_image_placeholder(&format!("{text} {IMAGE_TOKEN}"), patches.num_soft_tokens)?;
    let ids = encode(&loaded.tokenizer, &full, true)?;
    let n_tokens = ids.iter().filter(|&&id| id == IMAGE_TOKEN_ID).count();

    let mp = patches.max_patches;
    let vis = loaded
        .vision
        .run(ort::inputs![
            "pixel_values" => Tensor::from_array(([1usize, mp, vision::PATCH_SIZE * vision::PATCH_SIZE * 3], patches.pixel_values)).map_err(ort_err)?,
            "pixel_position_ids" => Tensor::from_array(([1usize, mp, 2], patches.positions)).map_err(ort_err)?,
        ])
        .map_err(ort_err)?;
    let (shape, data) = vis["image_features"].try_extract_tensor::<f32>().map_err(ort_err)?;
    let rows = shape[0] as usize;
    let dim = shape[shape.len() - 1] as usize;
    if rows != n_tokens || dim != FEATURE_DIM {
        bail!("The number of image tokens ({n_tokens}) and image features ({rows}x{dim}) do not match.");
    }
    let features = Tensor::from_array(([rows, dim], data.to_vec())).map_err(ort_err)?;
    drop(vis);
    Ok(run_model(loaded, &[ids], features)?.remove(0))
}

#[doc(hidden)]
pub mod debug {
    //! Hooks for the parity test: the exact token ids and patches the embedder would feed the model.
    use super::*;

    pub fn tokenizer(dir: &Path) -> Result<Tokenizer> {
        Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| anyhow!("tokenizer: {e}"))
    }

    /// Token ids of a text-only input, as fed (before batch padding).
    pub fn text_ids(tok: &Tokenizer, input: &GemmaInput) -> Result<Vec<u32>> {
        let mut ids = encode(tok, &gemma_text(input), true)?;
        ids.truncate(MAX_LENGTH);
        Ok(ids)
    }

    /// (text kept, token ids, patches) of an image document.
    pub fn image_inputs(tok: &Tokenizer, input: &GemmaInput, image_b64: &str) -> Result<(String, Vec<u32>, vision::Patches)> {
        let img = vision::decode_b64(image_b64)?;
        let text = image_doc_text(tok, input)?;
        let patches = vision::preprocess(&img, MAX_SOFT_TOKENS)?;
        let full = expand_image_placeholder(&format!("{text} {IMAGE_TOKEN}"), patches.num_soft_tokens)?;
        Ok((text, encode(tok, &full, true)?, patches))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_string() {
        let e = GemmaEmbedder::new(PathBuf::from("/x/.cache/models/onnx-community/embeddinggemma-2-ONNX"), Dtype::Q8);
        assert_eq!(e.model_id(), "onnx-community/embeddinggemma-2-ONNX:q8+vision@768");
    }
}
