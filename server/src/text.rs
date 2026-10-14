//! Port of `src/lib/text.ts`, plus JS string helpers (UTF-16 lengths and slices, `trim`) so limits and
//! cuts land exactly where the TypeScript put them.

use once_cell::sync::Lazy;
use regex::Regex;

pub const LABEL_MAX: usize = 40;
pub const SUMMARY_MAX: usize = 140;

// ---- JS string semantics ----

/// `s.length` in JS: UTF-16 code units.
pub fn js_len(s: &str) -> usize {
    if s.is_ascii() { s.len() } else { s.encode_utf16().count() }
}

/// `s.slice(start, end)` in JS, by UTF-16 code units. Negative indexes count from the end; `None` is the end.
pub fn js_slice(s: &str, start: isize, end: Option<isize>) -> String {
    let len = js_len(s) as isize;
    let norm = |i: isize| if i < 0 { (len + i).max(0) } else { i.min(len) };
    let a = norm(start);
    let b = norm(end.unwrap_or(len));
    if a >= b {
        return String::new();
    }
    let (a, b) = (a as usize, b as usize);
    if s.is_ascii() {
        return s[a..b].to_string();
    }
    let units: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16_lossy(&units[a..b])
}

/// `s.slice(0, n)`
pub fn js_take(s: &str, n: usize) -> String {
    js_slice(s, 0, Some(n as isize))
}

fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// `String.prototype.trim`: Unicode whitespace plus the BOM.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_space)
}

pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

// ---- text.ts ----

static NON_ALNUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-z0-9]").unwrap());
static NON_ALNUM_RUN: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-z0-9]+").unwrap());
static EDGE_DASHES: Lazy<Regex> = Lazy::new(|| Regex::new(r"^-+|-+$").unwrap());
static TRAILING_DASHES: Lazy<Regex> = Lazy::new(|| Regex::new(r"-+$").unwrap());
static DASH_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*[—–]\s*").unwrap());
static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());

/// Dedupe key part: lowercase, alphanumerics only.
pub fn normalize_label(label: &str) -> String {
    NON_ALNUM.replace_all(&label.to_lowercase(), "").into_owned()
}

pub fn slugify(label: &str) -> String {
    let lower = label.to_lowercase();
    let dashed = NON_ALNUM_RUN.replace_all(&lower, "-");
    let trimmed = EDGE_DASHES.replace_all(&dashed, "");
    let cut = js_take(&trimmed, 60);
    let slug = TRAILING_DASHES.replace_all(&cut, "").into_owned();
    if slug.is_empty() { "node".to_string() } else { slug }
}

/// `text.replace(/\s+/g, " ").trim()`
pub fn plain_spaces(text: &str) -> String {
    js_trim(&SPACES.replace_all(text, " ")).to_string()
}

/// UI copy rules: no em or en dashes, no exclamation marks, trimmed.
pub fn plain(text: &str) -> String {
    let a = DASH_PUNCT.replace_all(text, ", ");
    let b = a.replace('!', ".");
    let c = SPACES.replace_all(&b, " ");
    js_trim(&c).to_string()
}

static HIDDEN_BLOCKS: Lazy<Regex> = Lazy::new(|| {
    // `<(script|style|noscript|svg|template)[\s\S]*?<\/\1>` without a backreference.
    Regex::new(
        r"(?i)<(?:script[\s\S]*?</script>|style[\s\S]*?</style>|noscript[\s\S]*?</noscript>|svg[\s\S]*?</svg>|template[\s\S]*?</template>)",
    )
    .unwrap()
});
static COMMENTS: Lazy<Regex> = Lazy::new(|| Regex::new(r"<!--[\s\S]*?-->").unwrap());
static BLOCK_ENDS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)<(?:br|/p|/div|/li|/tr|/h[1-6]|/section|/article)\b[^>]*>").unwrap());
static TAGS: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
static ENTITY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)&(#\d+|#x[0-9a-f]+|\w+);").unwrap());
static INLINE_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t\x0C\x0B]+").unwrap());
static NEWLINE_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s*\n\s*").unwrap());
static NEWLINES: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{2,}").unwrap());

fn entity(name: &str) -> Option<&'static str> {
    Some(match name.to_lowercase().as_str() {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{a0}",
        _ => return None,
    })
}

/// Visible text of an HTML page: drops scripts, styles, and tags, keeps line breaks between blocks.
pub fn html_to_text(html: &str) -> String {
    let s = HIDDEN_BLOCKS.replace_all(html, " ");
    let s = COMMENTS.replace_all(&s, " ");
    let s = BLOCK_ENDS.replace_all(&s, "\n");
    let s = TAGS.replace_all(&s, " ");
    let s = ENTITY.replace_all(&s, |caps: &regex::Captures| {
        let e = &caps[1];
        if let Some(num) = e.strip_prefix('#') {
            let code = if num.starts_with(['x', 'X']) { u32::from_str_radix(&num[1..], 16).ok() } else { num.parse::<u32>().ok() };
            // JS throws on code points past U+10FFFF and keeps lone surrogates; both become a space here.
            return code.and_then(char::from_u32).map(String::from).unwrap_or_else(|| " ".into());
        }
        entity(e).map(String::from).unwrap_or_else(|| caps[0].to_string())
    });
    let s = INLINE_SPACE.replace_all(&s, " ");
    let s = NEWLINE_SPACE.replace_all(&s, "\n");
    let s = NEWLINES.replace_all(&s, "\n");
    js_trim(&s).to_string()
}

static TRAILING_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\s,.;:]+$").unwrap());

pub fn clamp(text: &str, max: usize) -> String {
    let t = plain(text);
    if js_len(&t) <= max {
        return t;
    }
    let cut = js_take(&t, max.saturating_sub(3));
    // lastIndexOf(" ") in UTF-16 units.
    let last_space = cut.rfind(' ').map(|byte| js_len(&cut[..byte]) as isize).unwrap_or(-1);
    let kept = if last_space as f64 > max as f64 * 0.6 { js_take(&cut, last_space as usize) } else { cut };
    format!("{}...", TRAILING_PUNCT.replace(&kept, ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_and_slugs() {
        assert_eq!(normalize_label("Q4 Search-Campaign!"), "q4searchcampaign");
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
        assert_eq!(slugify("!!!"), "node");
        assert_eq!(slugify(&"ab ".repeat(40)).len(), 59);
    }

    #[test]
    fn plain_rules() {
        assert_eq!(plain("Ship it \u{2014} now!  "), "Ship it, now.");
    }

    #[test]
    fn html() {
        let html = "<html><head><style>p{}</style><script>x()</script></head><body><p>Hello &amp; welcome</p><div>Line&nbsp;two &#65;&#x42; &bogus;</div><!-- c --></body></html>";
        assert_eq!(html_to_text(html), "Hello & welcome\nLine\u{a0}two AB &bogus;");
    }

    #[test]
    fn clamps() {
        let long = "A very long feature name that keeps going past forty characters";
        let c = clamp(long, 40);
        assert!(js_len(&c) <= 40, "{c}");
        assert_eq!(c, "A very long feature name that keeps...");
        assert_eq!(clamp("short", 40), "short");
    }

    #[test]
    fn js_strings() {
        assert_eq!(js_len("a\u{1F600}"), 3);
        assert_eq!(js_slice("hello", -3, None), "llo");
        assert_eq!(js_take("héllo", 2), "hé");
    }
}
