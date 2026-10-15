// Keeps every item's vectors current: 768d embeddings (with the author's role as context) and their org-space projection.
import { config } from "@/config";
import { textHash, type StoredNode, type StoredSource, type StoredUser, type Store } from "@/db/store";
import { doc, query, type Embedder } from "@/llm/embed";
import { ownerMatches } from "@/orgs/people";
import { nearestCluster } from "./clusters";
import { IN_DIM, OUT_DIM, compress, mrlCompressor, type Compressor } from "./compressor";

/**
 * Role context in embeddings: documents carry their author's role, questions the asker's.
 * Measured: it lifts same-role matches by about 0.06 to 0.08 cosine, so people see more from their own corner.
 */
export const ROLE_CONTEXT = { documents: true, queries: true, maxChars: 240 } as const;

const SOURCE_EMBED_CHARS = 4_000;

/** A person's profile reads like a standing search, so it embeds as a query. */
function seedInput(user: Pick<StoredUser, "role" | "teamDescription">) {
  return query(`${user.role}. ${user.teamDescription}`);
}

export function roleContext(user: Pick<StoredUser, "role"> | null | undefined): string | null {
  const role = user?.role.replace(/\s+/g, " ").trim();
  return role ? role.slice(0, ROLE_CONTEXT.maxChars) : null;
}

/** The role a node's text is embedded with: its owner's, when the owner is someone in the org. */
function nodeContext(node: Pick<StoredNode, "owner">, users: StoredUser[]): string | null {
  return ROLE_CONTEXT.documents ? roleContext(users.find((u) => ownerMatches(node.owner, u))) : null;
}

function sourceContext(s: Pick<StoredSource, "authorId">, users: StoredUser[]): string | null {
  return ROLE_CONTEXT.documents ? roleContext(users.find((u) => u.id === s.authorId)) : null;
}

/** Stored next to each vector, so a changed role triggers a re-embed. */
const ctxKey = (ctx: string | null) => (ctx ? textHash(ctx) : null);

function nodeInput(node: Pick<StoredNode, "label" | "summary">, ctx: string | null = null) {
  return doc(node.label, node.summary, null, ctx);
}

/**
 * A source embeds as one document: its title, visible text or diff (plus any screenshot text not already
 * in it), and the screenshot itself when one was kept.
 */
function sourceInput(store: Store, s: StoredSource, ctx: string | null = null) {
  const text = s.ocrText && !s.text.trim() ? s.ocrText : s.text;
  const image = s.hasImage && embedsScreenshot(text) ? store.sourceImage(s.id)?.toString("base64") ?? null : null;
  return doc(s.title || s.ref, text.slice(0, SOURCE_EMBED_CHARS), image, ctx);
}

/** See config.embedScreenshots. */
export function embedsScreenshot(text: string): boolean {
  const mode = config.embedScreenshots;
  return mode === "always" || (mode === "auto" && text.trim().length < config.screenshotTextMin);
}

/** The org's trained compressor when one was adopted, else plain Matryoshka truncation. */
export function activeCompressor(store: Store): Compressor {
  const c = store.activeCompressor();
  return c && c.weights.length === OUT_DIM * IN_DIM ? { id: c.id, kind: c.kind, weights: c.weights, metrics: null } : mrlCompressor();
}

/**
 * Embeds nodes, sources, and user seeds that are missing a 768d vector, were embedded with another model,
 * or with a role context that has since changed (an author edited their role, a node changed owner).
 */
export async function ensureEmbeddings(store: Store, embedder: Embedder): Promise<number> {
  const users = store.listUsers();
  const stale = (x: { embedding: Float32Array | null; embedModel: string | null; embedCtx: string | null }, ctx: string | null) =>
    !x.embedding || x.embedModel !== embedder.model || (x.embedCtx ?? null) !== ctxKey(ctx);
  const nodes = store
    .listNodes()
    .map((n) => ({ n, ctx: nodeContext(n, users) }))
    .filter(({ n, ctx }) => stale(n, ctx));
  const staleIds = new Map(
    store
      .listSourceMeta()
      .map((s) => ({ s, ctx: sourceContext(s, users) }))
      .filter(({ s, ctx }) => stale(s, ctx))
      .map(({ s, ctx }) => [s.id, ctx]),
  );
  const sources = store.getSources([...staleIds.keys()]).map((s) => ({ s, ctx: staleIds.get(s.id) ?? null }));
  const seeds = users.filter((u) => !u.seedVec || u.seedModel !== embedder.model);
  if (!nodes.length && !sources.length && !seeds.length) return 0;

  const vecs = await embedder.embed([
    ...nodes.map(({ n, ctx }) => nodeInput(n, ctx)),
    ...sources.map(({ s, ctx }) => sourceInput(store, s, ctx)),
    ...seeds.map(seedInput),
  ]);
  store.transaction(() => {
    let i = 0;
    for (const { n, ctx } of nodes) store.setNodeEmbedding(n.id, vecs[i++], embedder.model, ctxKey(ctx));
    for (const { s, ctx } of sources) store.setSourceEmbedding(s.id, vecs[i++], embedder.model, ctxKey(ctx));
    for (const u of seeds) store.setUserSeed(u.id, vecs[i++], embedder.model);
  });
  return nodes.length + sources.length + seeds.length;
}

/**
 * Projects every node and source whose org-space vector is missing or came from another compressor,
 * and drops newly projected items into the nearest existing cluster so routing sees them at once.
 */
export function ensureOrgSpace(store: Store, c: Compressor): void {
  const nodes = store.listNodes().filter((n) => n.embedding && n.zVersion !== c.id);
  const sources = store.listSourceMeta().filter((s) => s.embedding && s.zVersion !== c.id);
  if (!nodes.length && !sources.length) return;
  const clusters = store.listClusters(c.id);
  store.transaction(() => {
    for (const [kind, items] of [["node", nodes], ["source", sources]] as const) {
      for (const it of items) {
        const z = compress(c, it.embedding!);
        if (kind === "node") store.setNodeZ(it.id, z, c.id);
        else store.setSourceZ(it.id, z, c.id);
        store.setClusterOf(kind, it.id, nearestCluster(clusters, z)?.id ?? null);
      }
    }
  });
}
