import type { Store } from "@/db/store";
import { query, type Embedder } from "@/llm/embed";
import { recomputeUserVectors } from "@/steer/users";
import { trainCompressor, type CompressorMetrics, type Labels, type TrainOptions } from "./compressor";

/** Below this many training vectors a learned map cannot beat Matryoshka truncation reliably. */
export const MIN_TRAIN_VECTORS = 32;
/** Retrain once the training set has grown this much since the last attempt. */
export const RETRAIN_GROWTH = 1.25;
/** A trained map must beat truncation by this much on its objective to be adopted. */
export const ADOPT_MARGIN = 0.01;
/** With org labels, the map may give up this much 768d neighbor recall to separate areas. */
export const RECALL_SLACK = 0.15;
/** Fewer labeled vectors than this and labels are too thin to steer training. */
export const MIN_LABELED = 12;
/** A use covering more than this share of labeled vectors is ignored in training. */
export const MAX_USE_SHARE = 0.6;

export type RetrainResult =
  | { status: "skipped"; reason: string; vectors: number }
  | { status: "adopted" | "rejected"; id: string; metrics: CompressorMetrics };

/**
 * Training set: every node's and source's document vector (sources include screenshots), every node
 * label embedded as a query (teaches the map to keep query to document neighborhoods, not just
 * document to document), and every user seed. All 768d, all from the same embedder.
 * Labels: each item's area and use from the org model; a node's label query shares the node's labels.
 */
export async function trainingSet(store: Store, embedder: Embedder): Promise<{ xs: Float32Array[]; labels: Labels | null }> {
  const nodes = store.listNodes().filter((n) => n.embedding && n.embedModel === embedder.model);
  const sources = store.listSourceMeta().filter((s) => s.embedding && s.embedModel === embedder.model);
  const users = store.listUsers().filter((u) => u.seedVec && u.seedModel === embedder.model);
  const labelQueries = await embedder.embed(nodes.map((n) => query(n.label)));
  const xs = [...nodes.map((n) => n.embedding!), ...sources.map((s) => s.embedding!), ...labelQueries, ...users.map((u) => u.seedVec!)];

  const facets = new Map(store.listFacets().map((f) => [`${f.itemKind}:${f.itemId}`, f]));
  const keys = [
    ...nodes.map((n) => `node:${n.id}`),
    ...sources.map((s) => `source:${s.id}`),
    ...nodes.map((n) => `node:${n.id}`),
    ...users.map(() => ""),
  ];
  const index = (vocab: Map<string, number>, v: string | undefined) => {
    if (!v) return -1;
    if (!vocab.has(v)) vocab.set(v, vocab.size);
    return vocab.get(v)!;
  };
  const areas = new Map<string, number>();
  const uses = new Map<string, number>();
  const labels: Labels = {
    area: Int32Array.from(keys, (k) => index(areas, facets.get(k)?.area)),
    use: Int32Array.from(keys, (k) => index(uses, facets.get(k)?.use)),
  };
  const labeled = labels.area.filter((a) => a >= 0).length;
  // One use on nearly everything says nothing, and would pull every pair together.
  const useCounts = [...uses.values()].map((u) => labels.use.filter((x) => x === u).length);
  if (Math.max(0, ...useCounts) > MAX_USE_SHARE * labeled) labels.use.fill(-1);
  return { xs, labels: labeled >= MIN_LABELED && areas.size >= 2 ? labels : null };
}

export function shouldAdopt(m: CompressorMetrics): boolean {
  const recallBetter = m.recallAtK >= m.baselineRecallAtK + ADOPT_MARGIN;
  if (m.areaPurity === null || m.baselineAreaPurity === null) return recallBetter;
  if (m.recallAtK < m.baselineRecallAtK - RECALL_SLACK) return false;
  return m.areaPurity >= m.baselineAreaPurity + ADOPT_MARGIN || (m.areaPurity >= m.baselineAreaPurity && recallBetter);
}

export async function retrainCompressor(
  store: Store,
  embedder: Embedder,
  { force = false, train }: { force?: boolean; train?: TrainOptions } = {},
): Promise<RetrainResult> {
  const { xs, labels } = await trainingSet(store, embedder);
  if (xs.length < MIN_TRAIN_VECTORS && !force) {
    return { status: "skipped", reason: `need ${MIN_TRAIN_VECTORS} vectors, have ${xs.length}`, vectors: xs.length };
  }

  const trained = await trainCompressor(xs, train, labels ?? undefined);
  const metrics = trained.metrics!;
  const adopt = shouldAdopt(metrics);
  store.saveCompressor({ id: trained.id, kind: "trained", weights: trained.weights, metrics }, adopt);
  if (adopt) await recomputeUserVectors(store, embedder);
  return { status: adopt ? "adopted" : "rejected", id: trained.id, metrics };
}

export function lastTrainedSize(store: Store): number {
  const m = store.latestCompressor()?.metrics as CompressorMetrics | null | undefined;
  return m ? m.trainItems + m.valItems : 0;
}

/** Vectors the next training set would hold, without embedding anything. */
export function estimatedTrainingSize(store: Store): number {
  const { nodes, sources } = store.counts();
  return nodes * 2 + sources + store.listUsers().length;
}
