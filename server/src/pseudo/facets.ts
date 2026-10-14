import { z } from "zod";
import { textHash, type Facet, type StoredNode, type StoredSource, type Store } from "@/db/store";
import { completeJson, type LlmClient } from "@/llm/openrouter";
import { ownerMatches } from "@/steer/users";

/** How people use an item. A fixed set, so "same use" means the same thing across orgs. */
export const USES = ["status update", "plan", "decision", "customer record", "code change", "metrics", "reference"] as const;

const BATCH = 30;
const EXCERPT = 400;
const AREA_MAX = 40;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, area: { type: "string" }, use: { type: "string", enum: [...USES] } },
        required: ["id", "area", "use"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const answer = z.object({ items: z.array(z.object({ id: z.string(), area: z.string(), use: z.enum(USES) })) });

const SYSTEM = `You organize one organization's documents and work items into areas, so a search index can group them.
area: where in the org the item lives and is used: the team, product surface, or workstream. 2 to 4 lowercase words, for example "voice frontend code", "paid search ads", "enterprise renewals". Name it after the work, not the document type.
Reuse an existing area name whenever the item fits it. Create a new area only when none fits. Keep the total number of areas near the target you are given.
use: how people use the item. Pick the one that fits each item best; most orgs use all of them:
- status update: reports progress or the current state of ongoing work
- plan: future work, dates, roadmaps, launch plans
- decision: records a choice someone made
- customer record: a deal, account, customer contact, or customer conversation
- code change: a commit, diff, or engineering task in code
- metrics: numbers, dashboards, reports, budgets, costs
- reference: specs, docs, people and supplier profiles, background
Answer with JSON only: one entry per item id you were given.`;

export const normalizeArea = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, AREA_MAX);

type Item = { kind: Facet["itemKind"]; id: string; hash: string; line: string };

function items(store: Store): Item[] {
  const users = store.listUsers();
  const role = (u: { role: string } | undefined) => (u ? ` | by: ${u.role.slice(0, 120)}` : "");
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, EXCERPT);
  const node = (n: StoredNode): Item => ({
    kind: "node",
    id: n.id,
    hash: textHash(n.label, n.summary),
    line: `${n.id} [${n.type}, ${n.domain}] ${n.label}: ${n.summary}${role(users.find((u) => ownerMatches(n.owner, u)))}`,
  });
  const source = (s: StoredSource): Item => ({
    kind: "source",
    id: s.id,
    hash: textHash(s.title, s.text.slice(0, 2000), s.ocrText.slice(0, 500)),
    line: `${s.id} [${s.kind} document] ${s.title}${role(users.find((u) => u.id === s.authorId))} | ${flat(s.text || s.ocrText)}`,
  });
  return [...store.listNodes().map(node), ...store.listSources().map(source)];
}

/** Target area count: grows with the square root of the corpus, so clusters stay meaningful at any size. */
export const targetAreas = (n: number) => Math.max(3, Math.round(Math.sqrt(n)));

/**
 * Labels every node and source that has no facet yet, or whose text changed since it was labeled.
 * Batches go in order and each sees the areas named so far, so the vocabulary stays small and shared.
 */
export async function labelFacets(store: Store, llm: LlmClient, model: string): Promise<{ labeled: number; areas: number }> {
  const all = items(store);
  const have = new Map(store.listFacets().map((f) => [`${f.itemKind}:${f.itemId}`, f]));
  const todo = all.filter((it) => have.get(`${it.kind}:${it.id}`)?.textHash !== it.hash);
  const roles = store.listUsers().map((u) => `- ${u.name}: ${u.role.slice(0, 160)}`);
  const org = store.getOrg();
  const orgLine = org ? `Organization: ${org.name}. What it does: ${org.description}${org.context ? ` ${org.context}` : ""}` : "";
  let labeled = 0;

  for (let b = 0; b < todo.length; b += BATCH) {
    const batch = todo.slice(b, b + BATCH);
    const counts = new Map<string, number>();
    for (const f of have.values()) counts.set(f.area, (counts.get(f.area) ?? 0) + 1);
    const existing = [...counts].sort((x, y) => y[1] - x[1]).map(([a, c]) => `- ${a} (${c})`);
    const raw = await completeJson(llm, {
      model,
      name: "facets",
      schema: SCHEMA,
      maxTokens: 4000,
      system: SYSTEM,
      user: [
        ...(orgLine ? [orgLine] : []),
        `People in the org:\n${roles.join("\n") || "- none listed"}`,
        `Existing areas:\n${existing.join("\n") || "- none yet"}`,
        `Target number of areas overall: about ${targetAreas(all.length)}`,
        `Items (id, kind, title, author role, text):\n${batch.map((it) => it.line).join("\n")}`,
      ].join("\n\n"),
    });
    const byId = new Map(batch.map((it) => [it.id, it]));
    const facets: Facet[] = answer.parse(raw).items.flatMap((a) => {
      const it = byId.get(a.id);
      const area = normalizeArea(a.area);
      return it && area ? [{ itemKind: it.kind, itemId: it.id, area, use: a.use, textHash: it.hash }] : [];
    });
    store.saveFacets(facets);
    for (const f of facets) have.set(`${f.itemKind}:${f.itemId}`, f);
    labeled += facets.length;
  }
  return { labeled, areas: new Set([...have.values()].map((f) => f.area)).size };
}
