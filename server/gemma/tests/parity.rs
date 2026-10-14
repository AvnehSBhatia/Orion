//! Parity against the TypeScript embedder. Generate the reference first (see parity/ref.ts), then:
//!   MODEL_CACHE_DIR=/Users/avneh/Code/Orion/.cache/models cargo test --release --test parity -- --ignored --nocapture
//! DEBUG_DIR=<dir written by ref.ts> also compares token ids and pixel values with what Transformers.js produced.

use base64::Engine;
use orion_gemma::{debug, Dtype, GemmaEmbedder, GemmaInput};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Deserialize)]
struct Reference {
    model: String,
    timings_ms: serde_json::Map<String, serde_json::Value>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    input: RefInput,
    vector: Vec<f32>,
}

#[derive(Deserialize)]
struct RefInput {
    kind: String,
    text: String,
    context: Option<String>,
    title: Option<String>,
    image_file: Option<String>,
    image_b64: Option<String>,
    #[serde(default)]
    image_data_uri: bool,
}

fn parity_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("parity")
}

fn model_dir() -> PathBuf {
    if let Ok(d) = std::env::var("GEMMA_MODEL_DIR") {
        return d.into();
    }
    let cache = std::env::var("MODEL_CACHE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.cache/models"));
    cache.join(orion_gemma::DEFAULT_MODEL)
}

fn to_input(r: &RefInput) -> GemmaInput {
    if r.kind == "query" {
        return GemmaInput::Query { text: r.text.clone(), context: r.context.clone() };
    }
    let image_b64 = match (&r.image_file, &r.image_b64) {
        (Some(f), _) => {
            let b = base64::engine::general_purpose::STANDARD.encode(std::fs::read(parity_dir().join("images").join(f)).unwrap());
            Some(if r.image_data_uri { format!("data:image/jpeg;base64,{b}") } else { b })
        }
        (None, b) => b.clone(),
    };
    GemmaInput::Document { title: r.title.clone(), text: r.text.clone(), image_b64, context: r.context.clone() }
}

fn cosine(a: &[f32], b: &[f32]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| *x as f64 * *y as f64).sum();
    let na: f64 = a.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    let nb: f64 = b.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    dot / (na * nb)
}

fn debug_compare(dir: &Path, model: &Path, cases: &[Case], inputs: &[GemmaInput]) {
    let tok = debug::tokenizer(model).unwrap();
    for (c, input) in cases.iter().zip(inputs) {
        let ids_path = dir.join(format!("{}.ids.json", c.name));
        let Ok(ts_ids) = std::fs::read_to_string(&ids_path) else { continue };
        let ts_ids: Vec<u32> = serde_json::from_str(&ts_ids).unwrap();
        if c.input.image_file.is_some() {
            let GemmaInput::Document { image_b64: Some(img), .. } = input else { unreachable!() };
            let (text, ids, patches) = debug::image_inputs(&tok, input, img).unwrap();
            let ts_text = std::fs::read_to_string(dir.join(format!("{}.text.txt", c.name))).unwrap();
            let raw = std::fs::read(dir.join(format!("{}.pixels.f32", c.name))).unwrap();
            let ts_px: Vec<f32> = raw.chunks(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
            let (mut max, mut sum, mut n_diff) = (0f32, 0f64, 0usize);
            for (a, b) in patches.pixel_values.iter().zip(&ts_px) {
                let d = (a - b).abs();
                max = max.max(d);
                sum += d as f64;
                if d > 1e-6 {
                    n_diff += 1;
                }
            }
            println!(
                "  debug {:<18} text_eq={} ids_eq={} ({} vs {}) pixels: max|d|={:.4} mean|d|={:.6} differing={:.3}%",
                c.name,
                text == ts_text,
                ids == ts_ids,
                ids.len(),
                ts_ids.len(),
                max,
                sum / ts_px.len() as f64,
                100.0 * n_diff as f64 / ts_px.len() as f64
            );
        } else {
            let ids = debug::text_ids(&tok, input).unwrap();
            // TS ids are padded to the batch; one input per call there, so no padding.
            if ids != ts_ids {
                println!("  debug {:<18} ids differ ({} vs {})", c.name, ids.len(), ts_ids.len());
            }
        }
    }
}

fn median_ms(reps: usize, mut f: impl FnMut()) -> f64 {
    f();
    let mut ts: Vec<f64> = (0..reps)
        .map(|_| {
            let s = Instant::now();
            f();
            s.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ts[ts.len() / 2]
}

#[test]
#[ignore = "needs the model files and parity/reference.json; run with --ignored"]
fn parity_with_transformers_js() {
    let reference: Reference =
        serde_json::from_str(&std::fs::read_to_string(parity_dir().join("reference.json")).expect("run parity/ref.ts first")).unwrap();
    let model = model_dir();
    let emb = GemmaEmbedder::new(model.clone(), Dtype::Q8);
    assert_eq!(emb.model_id(), reference.model);

    let inputs: Vec<GemmaInput> = reference.cases.iter().map(|c| to_input(&c.input)).collect();
    if let Ok(dir) = std::env::var("DEBUG_DIR") {
        debug_compare(Path::new(&dir), &model, &reference.cases, &inputs);
    }

    let t = Instant::now();
    emb.warm().unwrap();
    println!("load: {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);

    let vectors = emb.embed(&inputs).unwrap();
    let mut failures = vec![];
    let (mut min_text, mut min_image) = (1f64, 1f64);
    for (c, v) in reference.cases.iter().zip(&vectors) {
        assert_eq!(v.len(), 768);
        let cos = cosine(v, &c.vector);
        let is_image = c.input.image_file.is_some();
        let threshold = if is_image { 0.995 } else { 0.999 };
        if is_image {
            min_image = min_image.min(cos);
        } else {
            min_text = min_text.min(cos);
        }
        println!("{:<20} {:<5} cos={cos:.8}", c.name, if is_image { "image" } else { "text" });
        if cos < threshold {
            failures.push(format!("{} cos {cos:.6} < {threshold}", c.name));
        }
    }
    println!("min cosine: text {min_text:.8}, image {min_image:.8}");

    if std::env::var("SKIP_TIMINGS").is_err() {
        let reps = 5;
        let pick = |name: &str| reference.cases.iter().position(|c| c.name == name).unwrap();
        let batch: Vec<GemmaInput> = reference
            .cases
            .iter()
            .zip(&inputs)
            .filter(|(c, _)| c.input.image_file.is_none() && c.name != "d_long")
            .take(16)
            .map(|(_, i)| i.clone())
            .collect();
        let ts = |k: &str| reference.timings_ms.get(k).and_then(|v| v["median"].as_f64()).unwrap_or(f64::NAN);
        println!("timings (median of {reps}, ms)       rust      ts");
        let ms = median_ms(reps, || drop(emb.embed(&batch).unwrap()));
        println!("  text_batch16              {ms:>9.1} {:>7.1}", ts("text_batch16"));
        let long = inputs[pick("d_long")].clone();
        let ms = median_ms(reps, || drop(emb.embed(std::slice::from_ref(&long)).unwrap()));
        println!("  long_doc (2048 tok)       {ms:>9.1} {:>7.1}", ts("long_doc"));
        for name in ["d_img_screenshot", "d_img_gradient", "d_img_small", "d_img_wide"] {
            let input = inputs[pick(name)].clone();
            let ms = median_ms(reps, || drop(emb.embed(std::slice::from_ref(&input)).unwrap()));
            println!("  {name:<25} {ms:>9.1} {:>7.1}", ts(name));
        }
    }

    assert!(failures.is_empty(), "parity failures: {failures:#?}");
}
