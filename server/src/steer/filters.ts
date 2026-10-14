import { z } from "zod";
import { DOMAINS, NODE_TYPES, STATUSES, type PublicNode } from "@/contract/types";

export const nodeFilter = z.object({
  statuses: z.array(z.enum(STATUSES)).nullish(),
  sellable: z.boolean().nullish(),
  domains: z.array(z.enum(DOMAINS)).nullish(),
  types: z.array(z.enum(NODE_TYPES)).nullish(),
  updatedWithinHours: z.number().positive().nullish(),
});
export type NodeFilter = z.infer<typeof nodeFilter>;

export function isEmptyFilter(f: NodeFilter): boolean {
  return !f.statuses?.length && f.sellable == null && !f.domains?.length && !f.types?.length && !f.updatedWithinHours;
}

/**
 * Structured filters over the graph as readers see it, so `at_risk` includes ripple from
 * blocked upstream work. Returns the ids that pass.
 */
export function matchingIds(nodes: PublicNode[], f: NodeFilter, now = Date.now()): Set<string> {
  const since = f.updatedWithinHours ? now - f.updatedWithinHours * 3_600_000 : null;
  return new Set(
    nodes
      .filter(
        (n) =>
          (!f.statuses?.length || f.statuses.includes(n.status)) &&
          (f.sellable == null || n.sellable === f.sellable) &&
          (!f.domains?.length || f.domains.includes(n.domain)) &&
          (!f.types?.length || f.types.includes(n.type)) &&
          (since === null || Date.parse(n.updatedAt) >= since),
      )
      .map((n) => n.id),
  );
}

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)));

/** Same filters as URL params: ?status=blocked,at_risk&sellable=true&domain=sales&type=deal&sinceHours=24 */
export const filterParams = z
  .object({
    status: csv(STATUSES).optional(),
    sellable: z.enum(["true", "false"]).optional(),
    domain: csv(DOMAINS).optional(),
    type: csv(NODE_TYPES).optional(),
    sinceHours: z.coerce.number().positive().optional(),
  })
  .transform(
    (p): NodeFilter => ({
      statuses: p.status,
      sellable: p.sellable === undefined ? undefined : p.sellable === "true",
      domains: p.domain,
      types: p.type,
      updatedWithinHours: p.sinceHours,
    }),
  );
