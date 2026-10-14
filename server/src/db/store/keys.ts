import { createHash } from "node:crypto";
import type { NodeType, Relation, SourceKind } from "@/contract/types";
import { normalizeLabel } from "@/lib/text";

/** The dedupe key of a node: two extractions with the same type and normalized label are the same node. */
export function nodeKey(type: NodeType, label: string): string {
  return `${type}:${normalizeLabel(label)}`;
}

export function sourceId(kind: SourceKind, ref: string, createdAt: string): string {
  return `src-${createHash("sha1").update(`${kind}\n${ref}\n${createdAt}`).digest("hex").slice(0, 12)}`;
}

export function edgeId(source: string, relation: Relation, target: string): string {
  return `${source}__${relation}__${target}`;
}

/** Short content hash: tells whether an item's text changed since it was embedded, labeled, or summarized. */
export function textHash(...parts: (string | null | undefined)[]): string {
  return createHash("sha1").update(parts.map((p) => p ?? "").join("\n")).digest("hex").slice(0, 12);
}
