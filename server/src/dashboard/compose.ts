import { config } from "@/config";
import { MAX_WIDGETS } from "@/contract/schemas";
import type { DashboardSpec, GraphResponse, Org, User } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { completeJson, type LlmClient } from "@/llm/openrouter";
import { heuristicDashboard } from "./heuristic";
import { DASHBOARD_JSON_SCHEMA, WIDGET_GUIDE, sanitizeDashboard, withLiveWidgets } from "./widgets";

const ROLE_PROMPT = `You design the home dashboard for one person in an organization, from their role in their own words.
${WIDGET_GUIDE}
Pick what this person checks every morning. Examples: sales sees sellable features, deals, and what is at risk with customers; an engineer sees blocked and at risk engineering work, recent commits, and the map; a founder sees KPIs across every domain, the constellation, live activity, gaps, and who is active; ops sees ops risks, gaps, and owners.
Always include one activity widget and one constellation or map widget. Use 6 to ${MAX_WIDGETS} widgets. Do not use nodeIds; use domains, statuses, owner, or query so the dashboard stays live.
Titles are a few plain words in sentence case. Never use em dashes or exclamation marks.`;

function graphBrief(graph: GraphResponse): string {
  const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const owners = Object.entries(count(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : []))))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([o]) => o);
  return [
    `Nodes: ${graph.nodes.length}. By domain: ${JSON.stringify(count(graph.nodes.map((n) => n.domain)))}. By status: ${JSON.stringify(count(graph.nodes.map((n) => n.status)))}.`,
    `Sellable: ${graph.nodes.filter((n) => n.sellable).length}. Gaps: ${graph.gaps.length}. Owners: ${owners.join(", ") || "none yet"}.`,
  ].join("\n");
}

const ROLE_TIMEOUT_MS = 20_000;

export type ComposeDeps = { llm: LlmClient; model?: string; now?: Date };

/**
 * The person's default dashboard, designed by the chat model from their free-text role. Falls back to
 * `heuristicDashboard` on any model failure (no key, bad output), so it always returns something good.
 */
export async function composeRoleDashboard(
  user: User,
  org: Pick<Org, "name" | "description" | "context"> | null,
  graph: GraphResponse,
  { llm, model = config.chatModel, now = new Date() }: ComposeDeps,
): Promise<DashboardSpec> {
  try {
    // A slow provider must not hold the first page load hostage; the heuristic is good enough.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ROLE_TIMEOUT_MS}ms`)), ROLE_TIMEOUT_MS);
    });
    const raw = await Promise.race([completeJson(llm, {
      model,
      name: "dashboard",
      schema: DASHBOARD_JSON_SCHEMA,
      system: ROLE_PROMPT,
      user: [
        ...(org ? [`Organization: ${org.name}. What it does: ${org.description}${org.context ? ` ${org.context}` : ""}`] : []),
        `Person: ${user.name}. Their role, in their words: ${user.role}${user.teamDescription ? ` ${user.teamDescription}` : ""}`,
        `The work map now:\n${graphBrief(graph)}`,
      ].join("\n\n"),
      maxTokens: 2000,
    }), timeout]).finally(() => clearTimeout(timer));
    const spec = sanitizeDashboard(raw, { origin: "role", allowedIds: new Set(), now });
    if (spec && spec.widgets.length >= 3) return withLiveWidgets(spec);
    console.error(`Role dashboard for ${user.id} came back unusable, using the heuristic`);
  } catch (err) {
    console.error(`Role dashboard for ${user.id} failed, using the heuristic:`, err instanceof Error ? err.message : err);
  }
  return heuristicDashboard(user, graph, now);
}

// Concurrent polls for a person with no dashboard yet share one composition.
const inflight = new Map<string, Promise<DashboardSpec>>();

/** The saved dashboard, else one composed from the person's role (and saved). */
export async function resolveDashboard(store: Store, user: User, deps: ComposeDeps): Promise<DashboardSpec> {
  const saved = store.getDashboard(user.id);
  if (saved) return saved;
  const key = `${store.getOrg()?.id ?? ""}:${user.id}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = composeRoleDashboard(user, store.getOrg(), readGraph(store), deps)
      .then((spec) => {
        // A chat rebuild may have saved one while the model was composing; never overwrite it.
        const now = store.getDashboard(user.id);
        if (now) return now;
        store.saveDashboard(user.id, spec);
        return spec;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
