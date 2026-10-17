export const LABEL_MAX = 40;
export const SUMMARY_MAX = 140;

/** Dedupe key part: lowercase, alphanumerics only. */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "node";
}

/** UI copy rules: no em or en dashes, no exclamation marks, trimmed. */
export function plain(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/!/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Visible text of an HTML page: drops scripts, styles, and tags, keeps line breaks between blocks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function clamp(text: string, max: number): string {
  const t = plain(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, "") + "...";
}
