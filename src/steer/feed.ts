import type { FeedItem, Relation, SourceChange } from "@/contract/types";
import type { Store } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import { lensFor, ownerMatches, rankSources } from "./users";

/** Added to the gravity score when a document changed something tied to the reader. */
export const IMPACT = { owned: 0.25, touched: 0.15, linked: 0.1, alarming: 0.05 } as const;
const LINKS: ReadonlySet<Relation> = new Set(["blocks", "feeds", "part_of"]);

function statusNote(c: SourceChange): string {
  if (c.statusFrom && c.statusFrom !== c.statusTo) return `, now ${c.statusTo.replace("_", " ")}`;
  if (c.change === "created") return ", new";
  return "";
}

/**
 * What other people captured or committed in the window, ranked for the reader:
 * gravity score of the document against their center, plus freshness, plus impact when the
 * document changed something they own, worked on, or that blocks, feeds, or contains their work.
 */
export async function feedFor(
  store: Store,
  embedder: Embedder,
  { userId, sinceHours, limit, now = Date.now() }: { userId: string; sinceHours: number; limit: number; now?: number },
): Promise<FeedItem[]> {
  const lens = await lensFor(store, embedder, { userId, now });
  if (!lens) return [];
  const since = now - sinceHours * 3_600_000;
  const others = (authorId: string | null) => authorId !== userId;

  const nodes = new Map(store.listNodes().map((n) => [n.id, n]));
  const mine = new Set([...nodes.values()].filter((n) => ownerMatches(n.owner, lens.user)).map((n) => n.id));
  const touched = new Set(store.touchedNodeIds(userId));
  /** Phrase for "changed X, which ..." when X links to one of the reader's items. */
  const neighbors = new Map<string, string>();
  const verb = (r: Relation) => (r === "part_of" ? "is part of" : r);
  const yours = (id: string) => mine.has(id) || touched.has(id);
  const label = (id: string) => nodes.get(id)?.label ?? id;
  for (const e of store.listEdges()) {
    if (!LINKS.has(e.relation)) continue;
    if (yours(e.target) && !yours(e.source)) neighbors.set(e.source, `${verb(e.relation)} your ${label(e.target)}`);
    if (yours(e.source) && !yours(e.target)) {
      neighbors.set(e.target, e.relation === "part_of" ? `contains your ${label(e.source)}` : `your ${label(e.source)} ${e.relation}`);
    }
  }

  const scored = rankSources(
    store,
    lens,
    Number.MAX_SAFE_INTEGER,
    (s) => others(s.authorId) && Date.parse(s.createdAt) >= since,
  ).flatMap((r) => {
    const s = store.getSource(r.id);
    if (!s) return [];
    const pub = store.toPublicSource(s);
    let impact = 0;
    let why = "";
    const bump = (value: number, reason: string) => {
      if (value > impact) {
        impact = value;
        why = reason;
      }
    };
    for (const c of pub.changes) {
      const note = statusNote(c);
      if (mine.has(c.nodeId)) bump(IMPACT.owned, `changed ${c.label}, which you own${note}`);
      else if (touched.has(c.nodeId)) bump(IMPACT.touched, `changed ${c.label}, which you worked on${note}`);
      else if (neighbors.has(c.nodeId)) bump(IMPACT.linked, `changed ${c.label}, which ${neighbors.get(c.nodeId)}${note}`);
      if (c.statusTo === "blocked" || c.statusTo === "at_risk") {
        impact += c.statusFrom !== c.statusTo ? IMPACT.alarming : 0;
        if (!why) why = `${c.label} is ${c.statusTo.replace("_", " ")}`;
      }
    }
    return [{ ...pub, why: why || "close to your work", score: r.score + impact }];
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}
