// Global opener for the in-app viewer drawer. Any component can open a source or node without prop drilling;
// <SourceViewer /> (mounted once in AppShell) listens for these events.

import { API, type Source } from "@/lib/orion";

export const OPEN_SOURCE = "orion:open-source";
export const OPEN_NODE = "orion:open-node";

export type ImageStatus = "none" | "text_only" | "kept" | "pruned";
export type SourceDetail = { source: Source; text: string; ocrText: string; imageStatus: ImageStatus };

export function openSource(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(OPEN_SOURCE, { detail: { id } }));
}

export function openNode(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(OPEN_NODE, { detail: { id } }));
}

// Small cache so reopening (or hovering then opening) is instant.
const sourceCache = new Map<string, Promise<SourceDetail>>();

export function fetchSource(orgId: string, id: string): Promise<SourceDetail> {
  const key = `${orgId}:${id}`;
  let p = sourceCache.get(key);
  if (!p) {
    p = fetch(`${API}/api/sources/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error || `source ${id} returned ${r.status}`);
      return body as SourceDetail;
    });
    p.catch(() => sourceCache.delete(key));
    sourceCache.set(key, p);
  }
  return p;
}

export const isHttp = (ref: string) => /^https?:\/\//i.test(ref);

/** Where a ref opens: the page itself, or the GitHub commit for "owner/repo@sha". Null when there is nowhere to go. */
export function refUrl(ref: string): string | null {
  if (isHttp(ref)) return ref;
  const m = ref.match(/^([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40})$/i);
  return m ? `https://github.com/${m[1]}/commit/${m[2]}` : null;
}
