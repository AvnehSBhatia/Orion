// Retrieval eval over the seeded demo org: labeled (asker, query, relevant items and documents) cases,
// scored on the three surfaces people and agents actually hit:
//   search  - search_context's items (findNodes) and documents (findSources),
//   task    - context_for_task's work items (buildTaskContext, which wraps buildContext).
// Run with the real embedder via scripts/eval.ts; a small slice runs with the hash embedder in vitest.

import { seedDemo } from "@/db/seed";
import { Store, textHash, type Facet } from "@/db/store";
import type { Embedder, EmbedInput } from "@/llm/embed";
import { buildClusters } from "@/pseudo/clusters";
import { retrainCompressor } from "@/pseudo/retrain";
import { buildTaskContext } from "@/mcp/taskContext";
import { findNodes, findSources } from "@/steer/context";
import { activeCompressor, ensurePseudo, ownerMatches, recomputeUserVectors } from "@/steer/users";

/**
 * outside: an explicit topic query from someone who does not work on it (the asker's own work must not intrude).
 * own: a query about the asker's own work. vague: "what should I do", where the person's pull should dominate.
 * recency: "what changed", where the newest relevant changes should come first.
 */
export type CaseKind = "outside" | "own" | "vague" | "recency";

export type EvalCase = {
  id: string;
  asker: string;
  q: string;
  kind: CaseKind;
  /** Relevant work item ids. */
  items: string[];
  /** Relevant source documents, by ref (source ids depend on the seed time). */
  sources: string[];
};

const ADS = "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice";
const ADS_Y = "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice&date=yesterday";
const HUBSPOT = "https://app.hubspot.com/contacts/deals/acme-renewal";
const GLOBEX = "https://docs.example.com/globex-pilot-kickoff";
const GLOBEX_P = "https://docs.example.com/globex-kickoff-priya";
const PLAN = "https://docs.example.com/voice-launch-plan";
const BILLING = "https://console.cloud.example.com/billing/voice-inference";
const LATENCY_COMMIT = "acme/voice@9c1e2ab4d7f0";
const BETA_COMMIT = "acme/voice@4f2a1c9e88b0";
const API_COMMIT = "acme/api@51d0e3f8a2c1";

const DEVON = ["voice-latency-fix", "audio-streaming-service", "voice-mode", "usage-export-api", "voice-mode-general-release", "sso-login"];
const MINA = ["q4-search-campaign", "cost-per-signup", "voice-launch-messaging"];
const SAM = ["acme-renewal", "globex-pilot", "jordan-lee-acme-cto", "ana-cruz-globex-support", "raj-iyer-globex-it"];
const PRIYA = ["voice-mode-general-release", "voice-launch-messaging", "inference-cost-overrun", "voice-latency-fix", "globex-pilot"];
/** Updated within the last day of the seed. */
const TODAY = ["q4-search-campaign", "cost-per-signup", "acme-renewal", "jordan-lee-acme-cto", "voice-latency-fix", "inference-cost-overrun", "usage-export-api"];
const TODAY_DOCS = [ADS, HUBSPOT, LATENCY_COMMIT, BILLING, API_COMMIT];

const c = (id: string, asker: string, kind: CaseKind, q: string, items: string[], sources: string[] = []): EvalCase => ({ id, asker, kind, q, items, sources });

export const CASES: EvalCase[] = [
  // Explicit topics, asked from outside the topic.
  c("eng-ads-budget", "devon", "outside", "google ads budget", ["q4-search-campaign", "cost-per-signup"], [ADS, ADS_Y]),
  c("eng-cps", "devon", "outside", "how much are we paying per signup on paid search", ["cost-per-signup", "q4-search-campaign"], [ADS, ADS_Y]),
  c("mkt-latency", "mina", "outside", "why is voice latency still above one second", ["voice-latency-fix", "audio-streaming-service"], [LATENCY_COMMIT]),
  c("mkt-streaming-owner", "mina", "outside", "who owns the audio streaming service", ["audio-streaming-service", "voice-latency-fix"], [LATENCY_COMMIT]),
  c("ae-usage-export", "sam", "outside", "usage export CSV for admins", ["usage-export-api"], [API_COMMIT]),
  c("ae-gpu-cost", "sam", "outside", "GPU inference costs over budget", ["inference-cost-overrun", "gpu-capacity-supplier"], [BILLING]),
  c("eng-acme", "devon", "outside", "acme renewal status", ["acme-renewal", "jordan-lee-acme-cto"], [HUBSPOT]),
  c("eng-globex-people", "devon", "outside", "who are the Globex pilot stakeholders", ["globex-pilot", "ana-cruz-globex-support", "raj-iyer-globex-it"], [GLOBEX, GLOBEX_P]),
  c("mkt-sso", "mina", "outside", "is SSO login shipped", ["sso-login"]),
  c("pm-cpc", "priya", "outside", "google ads cost per conversion this week", ["cost-per-signup", "q4-search-campaign"], [ADS, ADS_Y]),
  c("eng-messaging", "devon", "outside", "launch messaging for voice mode, what can marketing promise", ["voice-launch-messaging", "voice-mode-general-release"], [PLAN]),
  c("ae-latency", "sam", "outside", "engineering blocker on the voice reply delay", ["voice-latency-fix", "audio-streaming-service"], [LATENCY_COMMIT]),
  c("mkt-gpu", "mina", "outside", "GPU reservation contract renewal", ["gpu-capacity-supplier", "inference-cost-overrun"], [BILLING]),
  c("pm-jordan", "priya", "outside", "Jordan Lee, our contact at Acme", ["jordan-lee-acme-cto", "acme-renewal"], [HUBSPOT]),
  c("eng-keywords", "devon", "outside", "Q4 search campaign top keyword and clicks", ["q4-search-campaign"], [ADS, ADS_Y]),
  c("mkt-beta", "mina", "outside", "how many customers are in the voice mode beta", ["voice-mode"], [BETA_COMMIT]),
  // The asker's own work.
  c("eng-own-latency", "devon", "own", "voice latency fix", ["voice-latency-fix", "audio-streaming-service"], [LATENCY_COMMIT]),
  c("mkt-own-budget", "mina", "own", "google ads budget", ["q4-search-campaign", "cost-per-signup"], [ADS, ADS_Y]),
  c("ae-own-globex", "sam", "own", "Globex pilot decision", ["globex-pilot", "ana-cruz-globex-support", "raj-iyer-globex-it"], [GLOBEX, GLOBEX_P]),
  c("pm-own-release", "priya", "own", "voice mode general release date", ["voice-mode-general-release", "voice-latency-fix"], [PLAN]),
  c("eng-own-flag", "devon", "own", "usage export feature flag", ["usage-export-api"], [API_COMMIT]),
  c("ae-own-acme", "sam", "own", "acme renewal", ["acme-renewal", "jordan-lee-acme-cto"], [HUBSPOT]),
  // Vague: the person's pull should decide.
  c("eng-today", "devon", "vague", "what should I work on today", DEVON),
  c("mkt-today", "mina", "vague", "what should I focus on today", MINA),
  c("ae-attention", "sam", "vague", "what needs my attention", SAM),
  c("pm-anything", "priya", "vague", "anything I should know about?", PRIYA),
  c("eng-blocking", "devon", "vague", "what's blocking me", ["voice-latency-fix", "audio-streaming-service", "voice-mode-general-release"]),
  // Recency.
  c("pm-changed", "priya", "recency", "what changed today", TODAY, TODAY_DOCS),
  c("ae-new", "sam", "recency", "what's new since yesterday", TODAY, TODAY_DOCS),
  c("eng-latest", "devon", "recency", "latest updates", TODAY, TODAY_DOCS),
  c("mkt-recent", "mina", "recency", "recent changes in the last few hours", ["q4-search-campaign", "cost-per-signup", "acme-renewal", "jordan-lee-acme-cto", "voice-latency-fix"], [ADS, HUBSPOT, LATENCY_COMMIT]),
];

/** Every third case is held out from tuning. */
export const isHeldOut = (i: number) => i % 3 === 2;

/** Area and use labels as the org model assigned them on the live demo org, so routing sees realistic clusters. */
const NODE_FACETS: Record<string, [string, string]> = {
  "q4-search-campaign": ["paid search ads", "status update"],
  "cost-per-signup": ["paid search ads", "metrics"],
  "acme-renewal": ["enterprise renewals", "customer record"],
  "jordan-lee-acme-cto": ["enterprise renewals", "customer record"],
  "globex-pilot": ["enterprise renewals", "customer record"],
  "ana-cruz-globex-support": ["enterprise renewals", "customer record"],
  "raj-iyer-globex-it": ["enterprise renewals", "customer record"],
  "voice-latency-fix": ["voice mode", "code change"],
  "voice-mode": ["voice mode", "reference"],
  "voice-mode-general-release": ["voice mode", "plan"],
  "voice-launch-messaging": ["voice mode", "decision"],
  "inference-cost-overrun": ["infrastructure", "metrics"],
  "audio-streaming-service": ["infrastructure", "reference"],
  "gpu-capacity-supplier": ["infrastructure", "reference"],
  "usage-export-api": ["platform", "code change"],
  "sso-login": ["platform", "code change"],
};
const SOURCE_FACETS: Record<string, [string, string]> = {
  [ADS]: ["paid search ads", "metrics"],
  [ADS_Y]: ["paid search ads", "metrics"],
  [HUBSPOT]: ["enterprise renewals", "customer record"],
  [GLOBEX]: ["enterprise renewals", "customer record"],
  [GLOBEX_P]: ["enterprise renewals", "customer record"],
  [LATENCY_COMMIT]: ["voice mode", "code change"],
  [BETA_COMMIT]: ["voice mode", "code change"],
  [PLAN]: ["voice mode", "plan"],
  [BILLING]: ["infrastructure", "metrics"],
  [API_COMMIT]: ["platform", "code change"],
};

/** Memoizes embeddings by input, so a run that tries several settings embeds each text once. */
export function cachingEmbedder(inner: Embedder): Embedder {
  const cache = new Map<string, Float32Array>();
  return {
    model: inner.model,
    async embed(inputs: EmbedInput[]) {
      const keys = inputs.map((i) => JSON.stringify(i));
      const missing = [...new Set(keys.filter((k) => !cache.has(k)))];
      if (missing.length) {
        const vecs = await inner.embed(missing.map((k) => JSON.parse(k) as EmbedInput));
        missing.forEach((k, i) => cache.set(k, vecs[i]));
      }
      return keys.map((k) => cache.get(k)!);
    },
  };
}

/**
 * The demo org as the seed script leaves it, minus the LLM: the live org's area labels, a trained org space
 * (when it beats truncation), area clusters, and every person's gravity.
 */
export async function buildEvalOrg(embedder: Embedder, { train = true }: { train?: boolean } = {}): Promise<{ store: Store; now: number }> {
  const store = Store.open(":memory:");
  seedDemo(store, { force: true });
  const now = Date.now();
  await recomputeUserVectors(store, embedder);
  const facets: Facet[] = [
    ...store.listNodes().flatMap((n) => (NODE_FACETS[n.id] ? [{ itemKind: "node" as const, itemId: n.id, area: NODE_FACETS[n.id][0], use: NODE_FACETS[n.id][1], textHash: textHash(n.summary) }] : [])),
    ...store.listSources().flatMap((s) => (SOURCE_FACETS[s.ref] ? [{ itemKind: "source" as const, itemId: s.id, area: SOURCE_FACETS[s.ref][0], use: SOURCE_FACETS[s.ref][1], textHash: textHash(s.text) }] : [])),
  ];
  store.saveFacets(facets);
  if (train) await retrainCompressor(store, embedder, { force: true });
  const comp = activeCompressor(store);
  ensurePseudo(store, comp);
  buildClusters(store, comp);
  return { store, now };
}

export type Surface = "searchItems" | "searchDocs" | "taskItems";
export const SURFACES: Surface[] = ["searchItems", "searchDocs", "taskItems"];

export type CaseResult = { case: EvalCase; heldOut: boolean; ranked: Record<Surface, string[]>; own: Set<string> };

export async function runCases(store: Store, embedder: Embedder, now: number, cases: EvalCase[] = CASES): Promise<CaseResult[]> {
  const refOf = new Map(store.listSources().map((s) => [s.id, s.ref]));
  const out: CaseResult[] = [];
  for (const ec of cases) {
    const user = store.getUser(ec.asker)!;
    const own = new Set([...store.listNodes().filter((n) => ownerMatches(n.owner, user)).map((n) => n.id), ...store.touchedNodeIds(user.id)]);
    const items = await findNodes(store, embedder, { userId: ec.asker, q: ec.q, k: 10, now });
    const docs = await findSources(store, embedder, { userId: ec.asker, q: ec.q, k: 10, now });
    const task = await buildTaskContext(store, embedder, { userId: ec.asker, task: ec.q, now });
    out.push({
      case: ec,
      heldOut: isHeldOut(CASES.indexOf(ec)),
      own,
      ranked: {
        searchItems: items.map((n) => n.id),
        searchDocs: docs.map((d) => refOf.get(d.id) ?? d.id),
        taskItems: task.itemIds,
      },
    });
  }
  return out;
}

export type Metrics = { n: number; p5: number; r10: number; mrr: number; intrusion: number | null; intrusionN: number };

function relevantFor(r: CaseResult, s: Surface): string[] {
  return s === "searchDocs" ? r.case.sources : r.case.items;
}

/**
 * P@5 is over min(5, |relevant|) so a case with two relevant items can score 1. Intrusion (outside cases, item
 * surfaces only): share of cases where an item of the asker's own work (owned or touched) that is not relevant
 * takes one of the first min(5, |relevant|) slots, i.e. a slot a perfect ranking gives to a relevant item.
 */
export function metrics(results: CaseResult[], s: Surface): Metrics {
  const scored = results.filter((r) => relevantFor(r, s).length);
  let p5 = 0;
  let r10 = 0;
  let mrr = 0;
  for (const r of scored) {
    const rel = new Set(relevantFor(r, s));
    const list = r.ranked[s];
    p5 += list.slice(0, 5).filter((id) => rel.has(id)).length / Math.min(5, rel.size);
    r10 += list.slice(0, 10).filter((id) => rel.has(id)).length / rel.size;
    const first = list.findIndex((id) => rel.has(id));
    mrr += first >= 0 ? 1 / (first + 1) : 0;
  }
  const outside = s === "searchDocs" ? [] : results.filter((r) => r.case.kind === "outside");
  const intruded = outside.filter((r) =>
    r.ranked[s].slice(0, Math.min(5, r.case.items.length)).some((id) => r.own.has(id) && !r.case.items.includes(id)),
  ).length;
  const n = scored.length || 1;
  return {
    n: scored.length,
    p5: p5 / n,
    r10: r10 / n,
    mrr: mrr / n,
    intrusion: outside.length ? intruded / outside.length : null,
    intrusionN: outside.length,
  };
}

const f = (x: number | null) => (x === null ? "   -" : x.toFixed(2).padStart(4));

export function table(results: CaseResult[]): string {
  const lines = [`${"surface".padEnd(12)} ${"split".padEnd(6)} ${"n".padStart(3)}   P@5  R@10   MRR  intrude`];
  for (const s of SURFACES) {
    for (const [split, rs] of [
      ["train", results.filter((r) => !r.heldOut)],
      ["held", results.filter((r) => r.heldOut)],
      ["all", results],
    ] as const) {
      const m = metrics(rs, s);
      lines.push(`${s.padEnd(12)} ${split.padEnd(6)} ${String(m.n).padStart(3)}  ${f(m.p5)}  ${f(m.r10)}  ${f(m.mrr)}    ${f(m.intrusion)}`);
    }
  }
  lines.push("", `${"by kind (all)".padEnd(19)} ${"n".padStart(3)}  item P@5 search/task   MRR search/task`);
  for (const kind of ["outside", "own", "vague", "recency"] as const) {
    const rs = results.filter((r) => r.case.kind === kind);
    const a = metrics(rs, "searchItems");
    const b = metrics(rs, "taskItems");
    lines.push(`${kind.padEnd(19)} ${String(rs.length).padStart(3)}  ${f(a.p5)} / ${f(b.p5)}            ${f(a.mrr)} / ${f(b.mrr)}`);
  }
  return lines.join("\n");
}

/** One line per case: the top items on each item surface, relevant ones marked with *, own-work intrusions with !. */
export function details(results: CaseResult[]): string {
  const mark = (r: CaseResult, id: string) => (r.case.items.includes(id) ? `*${id}` : r.own.has(id) && r.case.kind === "outside" ? `!${id}` : id);
  return results
    .map(
      (r) =>
        `${r.heldOut ? "H" : " "} ${r.case.id.padEnd(20)} ${r.case.asker.padEnd(6)} "${r.case.q}"\n` +
        `    search: ${r.ranked.searchItems.slice(0, 5).map((id) => mark(r, id)).join(", ")}\n` +
        `    task:   ${r.ranked.taskItems.slice(0, 5).map((id) => mark(r, id)).join(", ")}`,
    )
    .join("\n");
}
