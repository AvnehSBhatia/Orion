// Global opener for the in-app viewer drawer. Any component can open a source or node without prop drilling;
// <SourceViewer /> (mounted once by the shell) listens for these events.

import { api } from "@/lib/api/client";
import type { SourceDetail } from "@/lib/api/types";

export const OPEN_SOURCE = "orion:open-source";
export const OPEN_NODE = "orion:open-node";

export function openSource(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(OPEN_SOURCE, { detail: { id } }));
}

export function openNode(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(OPEN_NODE, { detail: { id } }));
}

// Small cache so reopening (or hovering then opening) is instant. Failures are dropped so a retry refetches.
const sourceCache = new Map<string, Promise<SourceDetail>>();

export function fetchSource(orgId: string, id: string): Promise<SourceDetail> {
  const key = `${orgId}:${id}`;
  let p = sourceCache.get(key);
  if (!p) {
    p = api.sources.get(orgId, id);
    p.catch(() => sourceCache.delete(key));
    sourceCache.set(key, p);
  }
  return p;
}
