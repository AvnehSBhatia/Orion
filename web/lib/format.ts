import type { Source } from "@/lib/api/types";

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

/** Hostname for URLs, repo-ish tail for everything else. */
export function shortRef(ref: string) {
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
  if (source.kind === "digest") return "Digest";
  return "Manual";
}

/** The one line the live header shows: "Kai Nakamura captured github.com/orion/pull/12". */
export function captureLine(source: Source) {
  const who = source.authorName ?? "Someone";
  if (source.kind === "code") return `${who} committed ${source.title}`;
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
