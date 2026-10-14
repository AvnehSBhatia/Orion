//! Text formatting, a straight port of `gemmaText` / `withContext` from src/llm/gemma.ts and src/llm/embed.ts.

use crate::GemmaInput;

/// JS `String.prototype.trim` also strips U+FEFF, which Rust's `trim` keeps.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Literal media placeholders in user text would be counted as soft-token slots and fail the forward pass.
pub fn escape_media(s: &str) -> String {
    let mut out = s.to_owned();
    for m in ["image", "audio", "video"] {
        out = out.replace(&format!("<|{m}|>"), &format!("<{m}>"));
    }
    out
}

/// The text with its role context: the asker's for a query, the author's for a document.
pub fn with_context(input: &GemmaInput) -> String {
    match input {
        GemmaInput::Query { text, context } => match context.as_deref() {
            Some(c) if !c.is_empty() => format!("asked by: {c} | {text}"),
            _ => text.clone(),
        },
        GemmaInput::Document { text, context, .. } => match context.as_deref() {
            Some(c) if !c.is_empty() => format!("author role: {c}\n{text}"),
            _ => text.clone(),
        },
    }
}

/// Model card prefixes. Queries and documents are asymmetric for retrieval.
pub fn gemma_text(input: &GemmaInput) -> String {
    let text = escape_media(&with_context(input));
    match input {
        GemmaInput::Query { .. } => format!("task: search result | query: {text}"),
        GemmaInput::Document { title, .. } => {
            let t = escape_media(title.as_deref().unwrap_or("")).replace('|', "/");
            let t = js_trim(&t);
            let t = if t.is_empty() { "none" } else { t };
            format!("title: {t} | text: {text}")
        }
    }
}

/// `clean_up_tokenization` from @huggingface/tokenizers, applied by Transformers.js `decode` by default.
pub fn clean_up_tokenization(s: &str) -> String {
    s.replace(" .", ".")
        .replace(" ?", "?")
        .replace(" !", "!")
        .replace(" ,", ",")
        .replace(" ' ", "'")
        .replace(" n't", "n't")
        .replace(" 'm", "'m")
        .replace(" 's", "'s")
        .replace(" 've", "'ve")
        .replace(" 're", "'re")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes() {
        let q = GemmaInput::Query { text: "hi".into(), context: Some("SRE".into()) };
        assert_eq!(gemma_text(&q), "task: search result | query: asked by: SRE | hi");
        let d = GemmaInput::Document {
            title: Some(" a|b <|image|> ".into()),
            text: "x <|video|>".into(),
            image_b64: None,
            context: Some("PM".into()),
        };
        assert_eq!(gemma_text(&d), "title: a/b <image> | text: author role: PM\nx <video>");
        let d = GemmaInput::Document { title: Some("  ".into()), text: "y".into(), image_b64: None, context: Some(String::new()) };
        assert_eq!(gemma_text(&d), "title: none | text: y");
    }
}
