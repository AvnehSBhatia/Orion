import type { Edge, Gap, NodeType, PublicNode } from "@/contract/types";

/** Types that are people or outside parties, so they never need an internal owner. */
const OWNERLESS_OK: ReadonlySet<NodeType> = new Set(["stakeholder", "supplier"]);

/**
 * Deterministic gap rules, mapped from the original spec onto the new domains:
 * - no_owner: open work with nobody responsible.
 * - single_threaded_deal: an open deal linked to fewer than two stakeholders.
 */
export function findGaps(nodes: PublicNode[], edges: Edge[]): Gap[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gaps: Gap[] = [];

  for (const node of nodes) {
    if (node.status === "done") continue;

    if (!node.owner && !OWNERLESS_OK.has(node.type)) {
      gaps.push({ nodeId: node.id, kind: "no_owner", message: `${node.label} has no owner.` });
    }

    if (node.type === "deal") {
      const stakeholders = new Set<string>();
      for (const e of edges) {
        const other = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
        if (other && byId.get(other)?.type === "stakeholder") stakeholders.add(other);
      }
      if (stakeholders.size < 2) {
        const who = stakeholders.size === 0 ? "no stakeholder" : "only one stakeholder";
        gaps.push({
          nodeId: node.id,
          kind: "single_threaded_deal",
          message: `${node.label} has ${who}. Add a second contact.`,
        });
      }
    }
  }
  return gaps;
}

/** Fills empty "what to do" fields from gaps so the click panel always has an action. */
export function applyGapTodos(nodes: PublicNode[], gaps: Gap[]): PublicNode[] {
  const first = new Map<string, Gap>();
  for (const g of gaps) if (!first.has(g.nodeId)) first.set(g.nodeId, g);
  return nodes.map((n) => {
    const gap = first.get(n.id);
    if (n.todo || !gap) return n;
    const todo = gap.kind === "no_owner" ? "Pick an owner for this." : "Find a second contact on this deal.";
    return { ...n, todo };
  });
}
