import { z } from "zod";
import { textHash, type StoredDigest, type StoredSource, type Store } from "@/db/store";
import { doc, normalize, type Embedder } from "@/llm/embed";
import { completeJson, type LlmClient } from "@/llm/openrouter";

export const SYNTH = {
  /**
   * Two sources in one cluster this close (768d, plain text) are merged into one digest. Measured with Gemma:
   * follow-ups on one issue, two people's notes of one meeting, one report on two days score 0.90 to 0.98;
   * related but different documents score at most 0.78.
   */
  mergeSim: 0.85,
  maxMembers: 5,
  /** Longer documents are summarized before merging. */
  summarizeOver: 1_500,
  summaryChars: 600,
  /** A summary is used only if its embedding stays this close to the original's. */
  summaryFidelity: 0.85,
  /** A digest is kept only if it stays this close to its members' centroid... */
  digestFidelity: 0.85,
  /** ...and this close to every single member, so no document is drowned out. */
  memberFloor: 0.75,
  digestChars: 1_200,
} as const;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};
const DIGEST_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, digest: { type: "string" } },
  required: ["title", "digest"],
  additionalProperties: false,
};

const SUMMARY_SYSTEM = `You summarize one document from an organization so it can stand in for the original in a search index.
Keep every concrete fact: names, numbers, dates, statuses, owners, decisions, file and feature names. Drop boilerplate and repetition. Never add anything.
Plain sentences, at most ${SYNTH.summaryChars} characters. Answer with JSON only.`;

const DIGEST_SYSTEM = `You merge several closely related documents from one organization into one digest that replaces them in a search index.
Keep every concrete fact from every document: names, numbers, dates, statuses, owners, decisions. When documents disagree, keep both and say which is newer. Drop repetition. Never add facts.
Cite each fact with its document number in brackets, like [2]. Plain sentences, no headings, at most ${SYNTH.digestChars} characters.
title: at most 60 characters, names the shared subject. Answer with JSON only.`;

export type DigestReport = {
  groups: number;
  created: number;
  kept: number;
  rejected: number;
  deleted: number;
  summaries: number;
  details: { title: string; members: number; fidelity: number; minMember: number; accepted: boolean }[];
};

const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
const body = (s: StoredSource) => (s.text.trim() ? s.text : s.ocrText);

function mean(vs: Float32Array[]): Float32Array {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalize(out);
}

/** Greedy, newest first: each unassigned source takes its closest unassigned neighbors above mergeSim. */
export function groupSimilar(ids: string[], vec: Map<string, Float32Array>): string[][] {
  const left = new Set(ids);
  const groups: string[][] = [];
  for (const id of ids) {
    if (!left.has(id)) continue;
    left.delete(id);
    const near = [...left]
      .map((o) => [o, cos(vec.get(id)!, vec.get(o)!)] as const)
      .filter(([, s]) => s >= SYNTH.mergeSim)
      .sort((a, b) => b[1] - a[1])
      .slice(0, SYNTH.maxMembers - 1)
      .map(([o]) => o);
    near.forEach((o) => left.delete(o));
    if (near.length) groups.push([id, ...near]);
  }
  return groups;
}

export const membersKey = (members: StoredSource[]) =>
  `${members.map((m) => m.id).sort().join(",")}|${members.map((m) => m.createdAt).sort().at(-1)}`;

/**
 * Pre-synthesis. Within each cluster, sources whose plain text embeddings are at least mergeSim apart are
 * grouped; long members are summarized first (kept only if faithful); each group becomes one digest,
 * kept only if its embedding passes both fidelity checks. Unchanged groups keep their digest without a call.
 */
export async function synthesizeDigests(
  store: Store,
  embedder: Embedder,
  llm: LlmClient,
  model: string,
): Promise<DigestReport> {
  const report: DigestReport = { groups: 0, created: 0, kept: 0, rejected: 0, deleted: 0, summaries: 0, details: [] };
  const sources = store.listSources().filter((s) => s.clusterId && body(s).trim());
  const byCluster = new Map<string, StoredSource[]>();
  for (const s of sources) byCluster.set(s.clusterId!, [...(byCluster.get(s.clusterId!) ?? []), s]);
  const pool = [...byCluster.values()].filter((g) => g.length >= 2).flat();

  const plain = await embedder.embed(pool.map((s) => doc(s.title, body(s).slice(0, 4_000))));
  const vec = new Map(pool.map((s, i) => [s.id, plain[i]]));
  const byId = new Map(sources.map((s) => [s.id, s]));

  const groups = [...byCluster.entries()].flatMap(([clusterId, ss]) =>
    ss.length < 2 ? [] : groupSimilar(ss.map((s) => s.id), vec).map((ids) => ({ clusterId, members: ids.map((id) => byId.get(id)!) })),
  );
  report.groups = groups.length;

  const existing = new Map(store.listDigests().map((d) => [d.membersKey, d]));
  const wanted = new Set<string>();
  const users = new Map(store.listUsers().map((u) => [u.id, u]));

  for (const { clusterId, members } of groups) {
    const key = membersKey(members);
    wanted.add(key);
    if (existing.has(key)) {
      report.kept++;
      continue;
    }

    const texts: string[] = [];
    for (const m of members) texts.push(await memberText(store, embedder, llm, model, m, vec.get(m.id)!, report));

    const raw = await completeJson(llm, {
      model,
      name: "digest",
      schema: DIGEST_SCHEMA,
      maxTokens: 1500,
      system: DIGEST_SYSTEM,
      user: members
        .map((m, i) => {
          const author = m.authorId ? users.get(m.authorId) : null;
          return `[${i + 1}] ${m.title} | ${author ? `${author.name} (${author.role.slice(0, 80)})` : "unknown author"} | ${m.createdAt}\n${texts[i]}`;
        })
        .join("\n\n"),
    });
    const { title, digest } = z.object({ title: z.string(), digest: z.string() }).parse(raw);
    const [dv] = await embedder.embed([doc(title, digest)]);
    const mv = members.map((m) => vec.get(m.id)!);
    const fidelity = cos(dv, mean(mv));
    const minMember = Math.min(...mv.map((v) => cos(dv, v)));
    const accepted = fidelity >= SYNTH.digestFidelity && minMember >= SYNTH.memberFloor;
    report.details.push({ title, members: members.length, fidelity, minMember, accepted });
    if (!accepted) {
      report.rejected++;
      continue;
    }
    const d: StoredDigest = {
      id: `dg-${textHash(key)}`,
      title: title.slice(0, 80),
      text: digest.slice(0, SYNTH.digestChars * 2),
      members: members.map((m) => m.id),
      membersKey: key,
      clusterId,
      fidelity,
      newestAt: members.map((m) => m.createdAt).sort().at(-1)!,
      createdAt: new Date().toISOString(),
      embedding: dv,
      embedModel: embedder.model,
    };
    store.saveDigest(d);
    report.created++;
  }

  const stale = store.listDigests().filter((d) => !wanted.has(d.membersKey) || d.members.some((id) => !byId.has(id)));
  store.deleteDigests(stale.map((d) => d.id));
  report.deleted = stale.length;
  return report;
}

/** A member's text for the digest prompt: a cached or fresh summary when it is long and faithful, else the text. */
async function memberText(
  store: Store,
  embedder: Embedder,
  llm: LlmClient,
  model: string,
  m: StoredSource,
  original: Float32Array,
  report: DigestReport,
): Promise<string> {
  const text = body(m);
  if (text.length <= SYNTH.summarizeOver) return text;
  const hash = textHash(m.title, text);
  const cached = store.getSummary(m.id);
  if (cached?.textHash === hash) return cached.text;

  const raw = await completeJson(llm, {
    model,
    name: "summary",
    schema: SUMMARY_SCHEMA,
    maxTokens: 800,
    system: SUMMARY_SYSTEM,
    user: `${m.title}\n\n${text.slice(0, 12_000)}`,
  });
  const summary = z.object({ summary: z.string() }).parse(raw).summary.trim();
  const [sv] = await embedder.embed([doc(m.title, summary)]);
  const fidelity = cos(sv, original);
  if (fidelity < SYNTH.summaryFidelity) return text.slice(0, SYNTH.summarizeOver);
  store.saveSummary({ sourceId: m.id, text: summary, textHash: hash, fidelity });
  report.summaries++;
  return summary;
}
