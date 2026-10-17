import type { GraphResponse, PublicNode, Source } from "@/lib/api/types";

/** Trims to `max` characters with an ellipsis. */
export function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export const isHttp = (ref: string) => /^https?:\/\//i.test(ref);

/** "github.com" for a URL, null for anything else. */
export function host(ref: string) {
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "Xcode" for a Mac app ref ("mac://Xcode"), null for anything else. */
export function macApp(ref: string) {
  const m = ref.match(/^mac:\/\/(.+)$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/\/+$/, "") || null;
  } catch {
    return m[1];
  }
}

/** Hostname for URLs, the app for Mac refs, repo-ish tail for everything else. */
export function shortRef(ref: string) {
  const app = macApp(ref);
  if (app !== null) return app;
  const h = host(ref);
  if (h !== null) return h;
  const clean = ref.replace(/^(git@|https?:\/\/)/, "").replace(/\.git$/, "");
  const parts = clean.split(/[/:]/).filter(Boolean);
  return parts.slice(-2).join("/") || ref;
}

/** Where a ref opens: the page itself, or the GitHub commit for "owner/repo@sha". Null when there is nowhere to go. */
export function refUrl(ref: string): string | null {
  if (isHttp(ref)) return ref;
  const m = ref.match(/^([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40})$/i);
  return m ? `https://github.com/${m[1]}/commit/${m[2]}` : null;
}

/** Where a source came from, short enough for a chip: "github.com", "Code", "Manual". */
export function sourceLabel(source: Pick<Source, "kind" | "ref">) {
  if (source.kind === "extension") return host(source.ref) ?? "Browser";
  if (source.kind === "code") return "Code";
  if (source.kind === "mac") return macApp(source.ref) ?? host(source.ref) ?? "Mac";
  if (source.kind === "digest") return "Digest";
  return "Manual";
}

/** The one line the live header shows: "Kai Nakamura captured github.com/orion/pull/12". */
export function captureLine(source: Source) {
  const who = source.authorName ?? "Someone";
  if (source.kind === "code") return `${who} committed ${source.title}`;
  if (source.kind === "mac") {
    const where = macApp(source.ref) ?? source.ref.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return `${who} worked in ${where || source.title} on their Mac`;
  }
  if (source.kind === "extension") {
    const path = source.ref.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    return `${who} captured ${path || source.title}`;
  }
  return `${who} added ${source.title}`;
}

/**
 * Two letters for an avatar from any name or id ("kai.nakamura" → "KN", "Mina" → "MI").
 * The project page keeps its own rule on purpose (first letter of each word, as written).
 */
export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ""))).toUpperCase() || "?";
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// ---- Extraction output, cleaned for display -------------------------------------------
// The extractor sometimes leaves junk ("Update 230.", a search results page as the thing to read). The server filters
// it too; this keeps old rows and any misses off the screen.

/** A to-do worth showing, or null for a few characters or a bare "Update 230". */
export function usefulTodo(todo: string | null | undefined): string | null {
  const t = todo?.trim() ?? "";
  if (t.length < 12 || /^update\s+#?\d+\.?$/i.test(t)) return null;
  return t;
}

const SEARCH_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|startpage|search\.brave)\.[a-z.]+$/i;

/** False for search results, new-tab pages, and browser internals: nothing anyone should be told to read. */
export function isReadable(url: string, title = "") {
  if (/^(about|chrome|edge|brave|moz-extension|chrome-extension):/i.test(url)) return false;
  if (/^(new tab|duckduckgo\b|google search\b)/i.test(title.trim()) || /[-–—] (google )?search$/i.test(title.trim())) return false;
  const h = host(url);
  if (!h) return true;
  return !SEARCH_HOST.test(h);
}

/** The node with junk to-dos and read links dropped. */
export function cleanNode(node: PublicNode): PublicNode {
  return { ...node, todo: usefulTodo(node.todo), readLinks: node.readLinks.filter((l) => isReadable(l.url, l.title)) };
}

export const cleanGraph = (graph: GraphResponse): GraphResponse => ({ ...graph, nodes: graph.nodes.map(cleanNode) });

/** Generated titles in plain words: "Nodes by domain" → "Projects by domain", "sources" → "documents". */
export function plainTitle(text: string) {
  return text
    .replace(/\bsellable nodes\b/gi, (m) => (m[0] === "S" ? "Ready to sell" : "ready to sell"))
    .replace(/\bsellable\b/gi, (m) => (m[0] === "S" ? "Ready to sell" : "ready to sell"))
    .replace(/\b(node|source)(s?)\b/gi, (m, word: string, plural: string) => {
      const swap = word.toLowerCase() === "node" ? "project" : "document";
      const out = swap + plural;
      return m[0] === m[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
    });
}
