import type { Store } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import type { LlmClient } from "@/llm/openrouter";
import { HttpError } from "@/server/http";
import { activeCompressor, ensurePseudo, recomputeUserVectors } from "@/steer/users";
import { synthesizeDigests, type DigestReport } from "@/synth/digest";
import { buildClusters } from "./clusters";
import { labelFacets } from "./facets";
import { MIN_TRAIN_VECTORS, RETRAIN_GROWTH, estimatedTrainingSize, lastTrainedSize, retrainCompressor, type RetrainResult } from "./retrain";

/** Newly labeled items, as a share of all items, that justify retraining even without corpus growth. */
const RELABEL_SHARE = 0.2;
const DEBOUNCE_MS = 3_000;
/**
 * At least this long between the end of one run and the start of the next. Areas, the map, and digests change
 * slowly, while a busy org ingests every few seconds; without a floor maintenance would run back to back.
 */
export const MAINTAIN_INTERVAL_MS = Number(process.env.MAINTAIN_INTERVAL_MS) || 60_000;

type Skipped = { skipped: string };

export type MaintainReport = {
  facets: { labeled: number; areas: number } | Skipped;
  retrain: RetrainResult | Skipped;
  clusters: { id: string; label: string; size: number }[];
  digests: DigestReport | Skipped;
  ms: number;
};

/** Model steps are optional: without a key or on a provider error the org keeps working on what it has. */
async function optional<T>(run: () => Promise<T>): Promise<T | Skipped> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return { skipped: `${err.status}: ${err.message}` };
  }
}

/**
 * Keeps an org's space current, in order: embed and project anything new, label areas and uses with the org
 * model, retrain the 64d map when the corpus grew or many labels changed, rebuild the area clusters, then
 * refresh the digests of similar documents.
 */
export async function maintainOrg(
  store: Store,
  embedder: Embedder,
  llm: LlmClient,
  model: string,
  { forceRetrain = false }: { forceRetrain?: boolean } = {},
): Promise<MaintainReport> {
  const t = performance.now();
  await recomputeUserVectors(store, embedder);

  const facets = await optional(() => labelFacets(store, llm, model));
  const relabeled = "labeled" in facets ? facets.labeled : 0;
  const counts = store.counts();
  const total = counts.nodes + counts.sources;

  const size = estimatedTrainingSize(store);
  const last = lastTrainedSize(store);
  const grown = size >= MIN_TRAIN_VECTORS && (last === 0 || size >= last * RETRAIN_GROWTH);
  const retrain: RetrainResult | Skipped =
    forceRetrain || grown || relabeled >= Math.max(4, RELABEL_SHARE * total)
      ? await retrainCompressor(store, embedder, { force: forceRetrain })
      : { skipped: "corpus and labels unchanged enough" };

  const c = activeCompressor(store);
  ensurePseudo(store, c);
  const adopted = "status" in retrain && retrain.status === "adopted";
  if (adopted || relabeled > 0 || !store.listClusters(c.id).length) buildClusters(store, c);

  const digests = await optional(() => synthesizeDigests(store, embedder, llm, model));
  return {
    facets,
    retrain,
    clusters: store.listClusters(c.id).map(({ id, label, size }) => ({ id, label, size })),
    digests,
    ms: Math.round(performance.now() - t),
  };
}

const state = new WeakMap<Store, { timer: NodeJS.Timeout | null; running: boolean; again: boolean; lastEnd: number }>();

/** After an ingest: debounced per org, one run at a time, a burst of ingests coalesces into one rerun. Never throws. */
export function maintainInBackground(store: Store, embedder: Embedder, llm: LlmClient, model: string): void {
  const s = state.get(store) ?? { timer: null, running: false, again: false, lastEnd: 0 };
  state.set(store, s);
  if (s.running) {
    s.again = true;
    return;
  }
  const floor = s.lastEnd + MAINTAIN_INTERVAL_MS - Date.now();
  // Inside the floor a run is already scheduled for when it ends; more ingests ride along.
  if (s.timer && floor > DEBOUNCE_MS) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(async () => {
    s.timer = null;
    s.running = true;
    try {
      const r = await maintainOrg(store, embedder, llm, model);
      const d = "created" in r.digests ? `${r.digests.created} new digests` : `digests ${r.digests.skipped}`;
      const f = "labeled" in r.facets ? `${r.facets.labeled} labeled` : `facets ${r.facets.skipped}`;
      const tr = "status" in r.retrain ? r.retrain.status : "not retrained";
      console.log(`org maintenance: ${f}, map ${tr}, ${r.clusters.length} clusters, ${d}, ${r.ms}ms`);
    } catch (err) {
      console.error("org maintenance failed", err);
    } finally {
      s.running = false;
      s.lastEnd = Date.now();
      if (s.again) {
        s.again = false;
        maintainInBackground(store, embedder, llm, model);
      }
    }
  }, Math.max(DEBOUNCE_MS, floor));
  s.timer.unref?.();
}
