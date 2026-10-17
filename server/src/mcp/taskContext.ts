import type { Edge, Gap, PublicNode, Source, SourceChange, Status } from "@/contract/types";
import { toPublicNode, type Store } from "@/db/store";
import { ripple } from "@/graph/ripple";
import { readGraph } from "@/graph/view";
import type { Embedder } from "@/llm/embed";
import { hiddenSourceIds, type Viewer } from "@/orgs/visibility";
import { buildContext, type ContextItem } from "@/retrieval/context";
import { ownerMatches } from "@/orgs/people";

/** Where a coding agent should save the file, relative to the repo root. */
export const WRITE_TO = ".orion/context.md";
/** Hard cap on the markdown, so the file stays cheap to load into a coding agent's context. */
export const MAX_CHARS = 12_000;

export type TaskChange = {
  sourceId: string;
  at: string;
  who: string | null;
  title: string;
  ref: string;
  /** What it did to the items in this context, e.g. "Voice latency fix: on track -> blocked". */
  effects: string[];
  flip: boolean;
};

export type TaskContext = {
  markdown: string;
  writeTo: string;
  itemIds: string[];
  sourceIds: string[];
  changes: TaskChange[];
  truncated: boolean;
};

const words = (s: Status) => s.replace("_", " ");
const TROUBLE: ReadonlySet<Status> = new Set(["blocked", "at_risk"]);
const one = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

function when(at: string, now: number): string {
  const h = Math.max(0, now - Date.parse(at)) / 3_600_000;
  const rel = h < 1 ? "just now" : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
  return `${at.slice(0, 16).replace("T", " ")}Z, ${rel}`;
}

function effect(c: SourceChange): { text: string; flip: boolean } {
  if (c.statusFrom && c.statusFrom !== c.statusTo) return { text: `${c.label}: ${words(c.statusFrom)} -> **${words(c.statusTo)}**`, flip: true };
  if (c.change === "created") return { text: `${c.label}: created (${words(c.statusTo)})`, flip: false };
  return { text: `${c.label}: updated (${words(c.statusTo)})`, flip: false };
}

/**
 * One markdown context file for a coding agent's task. Deterministic: the only model call is embedding the task.
 * Sections, most useful first: situation, work items (with blockers and feeders), recent changes touching them
 * (newest first), key documents (excerpts with ids for read_document), open gaps, and what to do next.
 */
export async function buildTaskContext(
  store: Store,
  embedder: Embedder,
  { userId, task, k = 10, sinceHours = 168, viewer = null, now = Date.now() }: { userId: string; task: string; k?: number; sinceHours?: number; viewer?: Viewer; now?: number },
): Promise<TaskContext> {
  // Task first: at most one "for you" slot (none for a specific task, see SPECIFIC in steer/context), the rest on
  // the task, plus room for the blockers and feeders of the leaders.
  const ctx = await buildContext(store, embedder, { userId, q: task, k: k + 3, forYou: 1, hits: Math.max(2, k - 4), viewer, now });
  const hidden = hiddenSourceIds(store, viewer);
  const user = store.getUser(userId);
  const graph = readGraph(store);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // The task's matches lead and the person's own item follows: "the closest work item" in the situation is items[0],
  // and on a vague task the for-you item ("Usage export API" for "speed up voice replies") took that place.
  const forYou = (n: ContextItem) => n.why.startsWith("for you");
  const items = [...ctx.items.filter((n) => !forYou(n)), ...ctx.items.filter(forYou)];
  const ids = new Set(items.map((n) => n.id));

  // Ripple: why an item is at risk although nobody marked it so.
  const raw = store.listNodes().map(toPublicNode);
  const rippleCause = new Map(ripple(raw, graph.edges).map((r) => [r.nodeId, r.causeId]));
  const rawStatus = new Map(raw.map((n) => [n.id, n.status]));

  const upstream = (id: string) => graph.edges.filter((e) => e.target === id && (e.relation === "blocks" || e.relation === "feeds"));
  const downstream = (id: string) => graph.edges.filter((e) => e.source === id && (e.relation === "blocks" || e.relation === "feeds"));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const tag = (id: string) => {
    const n = byId.get(id);
    return n ? `${n.label} (\`${n.id}\`, ${words(n.status)})` : id;
  };

  // Recent changes that touched any item here, newest first.
  const since = now - sinceHours * 3_600_000;
  const changes: TaskChange[] = [];
  for (const [sid, list] of store.changesBySource()) {
    const hits = list.filter((c) => ids.has(c.nodeId));
    if (!hits.length) continue;
    const s = hidden.has(sid) ? null : store.getSource(sid);
    if (!s || Date.parse(s.createdAt) < since) continue;
    const eff = hits.map(effect);
    changes.push({
      sourceId: sid,
      at: s.createdAt,
      who: store.toPublicSource(s).authorName,
      title: s.title,
      ref: s.ref,
      effects: eff.map((e) => e.text),
      flip: eff.some((e) => e.flip),
    });
  }
  changes.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // Documents: matches and the newest behind each item, then the sources of the changes above.
  const docs: (Source & { why: string })[] = [...ctx.sources];
  for (const c of changes) {
    if (docs.length >= 8) break;
    if (docs.some((d) => d.id === c.sourceId)) continue;
    const s = hidden.has(c.sourceId) ? null : store.getSource(c.sourceId);
    if (s) docs.push({ ...store.toPublicSource(s), why: `changed ${c.effects.map((e) => e.split(":")[0]).join(", ")}` });
  }

  const gaps: Gap[] = graph.gaps.filter((g) => ids.has(g.nodeId));

  // ---- markdown ----
  const sections: string[] = [];
  sections.push(
    `# Orion context: ${one(task, 100)}\n\n` +
      `_Generated ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}Z for ${user?.name ?? userId}. ` +
      `Save as \`${WRITE_TO}\`. Read full documents with \`read_document\`, expand items with \`graph_neighborhood\`._`,
  );

  sections.push(`## Situation\n\n${situation(items, changes, gaps, rippleCause, label, user ? (o) => ownerMatches(o, user) : () => false)}`);

  if (items.length) {
    const blocks = items.map((n, i) => {
      const lines = [`### ${i + 1}. ${n.label} (\`${n.id}\`)`];
      const status =
        rippleCause.has(n.id) && rawStatus.get(n.id) !== n.status
          ? `**${words(n.status)}** (marked ${words(rawStatus.get(n.id)!)}, at risk because ${tag(rippleCause.get(n.id)!)} is upstream)`
          : TROUBLE.has(n.status)
            ? `**${words(n.status)}**`
            : words(n.status);
      lines.push(`- ${n.type}, ${n.domain} · status: ${status} · owner: ${n.owner ?? "**none**"} · updated ${when(n.updatedAt, now)}`);
      lines.push(`- ${one(n.summary, 200)}`);
      if (n.todo) lines.push(`- Todo: ${one(n.todo, 200)}`);
      const up = upstream(n.id);
      if (up.length) lines.push(`- Upstream: ${up.map((e) => `${e.relation === "blocks" ? "blocked by" : "fed by"} ${tag(e.source)}`).join("; ")}`);
      const down = downstream(n.id);
      if (down.length) lines.push(`- Downstream: ${down.map((e) => `${e.relation} ${tag(e.target)}`).join("; ")}`);
      const parent = graph.edges.filter((e) => e.source === n.id && e.relation === "part_of");
      if (parent.length) lines.push(`- Part of: ${parent.map((e) => tag(e.target)).join("; ")}`);
      if (n.readLinks.length) lines.push(`- Read: ${n.readLinks.slice(0, 3).map((l) => `[${l.title}](${l.url})`).join(", ")}`);
      lines.push(`- Why here: ${n.why}`);
      return lines.join("\n");
    });
    sections.push(`## Work items (most relevant first)\n\n${blocks.join("\n\n")}`);
  } else {
    sections.push("## Work items\n\nNothing in the graph matches this task yet.");
  }

  sections.push(
    `## What changed recently (last ${sinceHours}h, newest first)\n\n` +
      (changes.length
        ? changes
            .slice(0, 12)
            .map(
              (c) =>
                `- ${when(c.at, now)} · ${c.who ?? "unknown"} · [${one(c.title, 80)}](${c.ref}) (\`${c.sourceId}\`)\n  ${c.effects.join("; ")}`,
            )
            .join("\n")
        : "No captured changes touched these items in this window."),
  );

  if (docs.length) {
    sections.push(
      `## Key documents\n\n` +
        docs
          .map(
            (d) =>
              `- **${one(d.title, 90)}** (\`${d.id}\`, ${d.kind}, ${d.authorName ?? "unknown"}, ${when(d.createdAt, now)})\n` +
              `  ${d.ref}\n  > ${one(d.excerpt, 280)}\n  _${d.why}_`,
          )
          .join("\n"),
    );
  }

  sections.push(`## Open gaps\n\n${gaps.length ? gaps.map((g) => `- ${g.message} (\`${g.nodeId}\`, ${g.kind})`).join("\n") : "None on these items."}`);

  sections.push(`## What to do next\n\n${nextSteps(items, gaps, docs, upstream, rippleCause, label).map((s, i) => `${i + 1}. ${s}`).join("\n")}`);

  // Gaps and next steps are short and always kept; the middle sections are trimmed if needed.
  const tail = sections.splice(-2).join("\n\n");
  const head = fit(sections, MAX_CHARS - tail.length - 2);
  const markdown = `${head.markdown}\n\n${tail}`;
  const truncated = head.truncated;
  return { markdown, writeTo: WRITE_TO, itemIds: items.map((n) => n.id), sourceIds: docs.map((d) => d.id), changes, truncated };
}

function situation(
  items: ContextItem[],
  changes: TaskChange[],
  gaps: Gap[],
  rippleCause: Map<string, string>,
  label: (id: string) => string,
  mine: (owner: string | null) => boolean,
): string {
  if (!items.length) return "Orion has no work items related to this task. Proceed from the code and ask the team if something seems to be missing.";
  const top = items[0];
  const blocked = items.filter((n) => n.status === "blocked");
  const atRisk = items.filter((n) => n.status === "at_risk");
  const parts = [
    `The closest work item is **${top.label}** (${words(top.status)}, owner ${top.owner ?? "none"}${mine(top.owner) ? ", that is you" : ""}).`,
  ];
  if (blocked.length || atRisk.length) {
    const b = blocked.length ? `${blocked.length} blocked (${blocked.map((n) => n.label).join(", ")})` : "";
    const r = atRisk.length
      ? `${atRisk.length} at risk (${atRisk.map((n) => (rippleCause.has(n.id) ? `${n.label}, via ${label(rippleCause.get(n.id)!)}` : n.label)).join("; ")})`
      : "";
    parts.push(`Of ${items.length} related items, ${[b, r].filter(Boolean).join(" and ")}.`);
  } else {
    parts.push(`All ${items.length} related items are on track or done.`);
  }
  const flip = changes.find((c) => c.flip);
  // Prefer the newest change to one of the leading items over unrelated news.
  const lead = items.slice(0, 3).map((n) => `${n.label}:`);
  const latest = changes.find((c) => c.effects.some((e) => lead.some((l) => e.startsWith(l)))) ?? changes[0];
  if (latest) {
    const e = latest.effects.find((x) => lead.some((l) => x.startsWith(l))) ?? latest.effects[0];
    parts.push(`Latest change on this work: ${latest.who ?? "someone"} captured "${one(latest.title, 60)}" (${e}).`);
  }
  if (flip && flip !== latest) parts.push(`Most recent status change: ${flip.effects.find((e) => e.includes("->"))}.`);
  if (gaps.length) parts.push(`${gaps.length} open gap${gaps.length > 1 ? "s" : ""}.`);
  return parts.join(" ");
}

function nextSteps(
  items: ContextItem[],
  gaps: Gap[],
  docs: (Source & { why: string })[],
  upstream: (id: string) => Edge[],
  rippleCause: Map<string, string>,
  label: (id: string) => string,
): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s) && steps.length < 7) {
      seen.add(s);
      steps.push(s);
    }
  };
  const top = items[0];
  if (top) {
    if (top.todo) push(`On **${top.label}**: ${one(top.todo, 160)}`);
    const blockers = upstream(top.id).filter((e) => {
      const n = items.find((i) => i.id === e.source);
      return e.relation === "blocks" || (n && TROUBLE.has(n.status));
    });
    for (const e of blockers) push(`Check **${label(e.source)}** (\`${e.source}\`) first: it ${e.relation} ${top.label}. Call \`graph_neighborhood\` on it for owners and status.`);
    if (rippleCause.has(top.id)) push(`${top.label} is at risk only because **${label(rippleCause.get(top.id)!)}** is upstream; unblocking that clears it.`);
  }
  for (const n of items.filter((n) => n.status === "blocked" && n.todo && n.id !== top?.id)) push(`On **${n.label}** (blocked): ${one(n.todo!, 160)}`);
  const doc = (top && docs.find((d) => d.why.includes(top.label))) ?? docs[0];
  if (doc) push(`Read \`${doc.id}\` in full with \`read_document\` before changing code ("${one(doc.title, 60)}").`);
  for (const g of gaps.slice(0, 2)) push(`Raise with the team: ${g.message}`);
  push("If the work changes a user-visible behavior, write a feature card and run `npm run ctx:sync` after committing (see the orion-context skill).");
  return steps;
}

/** Keeps whole sections while they fit; trims the last one that does not, then stops. */
function fit(sections: string[], max: number): { markdown: string; truncated: boolean } {
  const note = "\n\n_(trimmed to fit; call `search_context` or `read_document` for more)_";
  let out = "";
  for (const s of sections) {
    const next = out ? `${out}\n\n${s}` : s;
    if (next.length <= max) {
      out = next;
      continue;
    }
    const room = max - out.length - note.length - 2;
    if (room > 200) {
      const cut = s.slice(0, room);
      out = `${out}\n\n${cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0) || room)}`;
    }
    return { markdown: out + note, truncated: true };
  }
  return { markdown: out, truncated: false };
}
