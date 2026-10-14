"use client";

// Context polls its own data so AppShell does not have to pass anything new.
// The org follows whatever AppShell last stored, falling back to the same default it uses.

import { defaultOrg, readStored } from "@/lib/live";
import { orion, usePoll } from "@/lib/orion";
import { useState } from "react";

const ORG_KEY = "orion.org";

function useOrgId() {
  const [orgId, setOrgId] = useState<string | null>(null);
  usePoll(
    "context:orgs",
    async () => {
      const { orgs } = await orion.orgs();
      const stored = readStored(ORG_KEY);
      const next = stored && orgs.some((o) => o.id === stored) ? stored : (defaultOrg(orgs)?.id ?? null);
      setOrgId((current) => (current === next ? current : next));
      return orgs;
    },
    5000,
  );
  return orgId;
}

export function useContextData() {
  const orgId = useOrgId();
  const graph = usePoll(orgId ? `context:graph:${orgId}` : null, () => orion.graph(orgId!), 3000);
  const activity = usePoll(orgId ? `context:activity:${orgId}` : null, () => orion.activity(orgId!, 120), 3000);
  const embeddings = usePoll(orgId ? `context:emb:${orgId}` : null, () => orion.embeddings(orgId!), 6000);
  return {
    orgId,
    graph: graph.data,
    activity: activity.data,
    embeddings: embeddings.data,
    offline: !!graph.error && !graph.data,
  };
}
