"use client";

// Context polls its own graph, activity, and topics for the org the shell is on.

import { api } from "@/lib/api/client";
import { usePoll } from "@/lib/usePoll";

export function useContextData(orgId: string | null) {
  const graph = usePoll(orgId ? `context:graph:${orgId}` : null, () => api.graph(orgId!), 3000);
  const activity = usePoll(orgId ? `context:activity:${orgId}` : null, () => api.activity(orgId!, 120), 3000);
  const embeddings = usePoll(orgId ? `context:emb:${orgId}` : null, () => api.embeddings(orgId!), 6000);
  return {
    graph: graph.data,
    activity: activity.data,
    embeddings: embeddings.data,
    offline: !!graph.error && !graph.data,
  };
}
