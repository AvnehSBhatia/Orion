"use client";

// Which org and person the page is on, and the live data for them: orgs, people, graph, activity.

import { api } from "@/lib/api/client";
import type { ActivityResponse, GraphResponse, OrgSummary, User } from "@/lib/api/types";
import { defaultOrg, defaultUser } from "@/lib/defaults";
import { ORG_KEY, readStored, userKey, writeStored } from "@/lib/storage";
import { usePoll } from "@/lib/usePoll";
import { useEffect, useMemo, useRef, useState } from "react";

/** Polled data tagged with the key it was loaded for, so a switch of org or person never shows the previous one's data. */
export type Tagged<T> = { key: string; value: T };

export function useWorkspace({ signedInUser }: { signedInUser?: string | null } = {}) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const orgRef = useRef(orgId);
  const userRef = useRef(userId);
  useEffect(() => {
    orgRef.current = orgId;
    userRef.current = userId;
  });

  // Org and person are picked as each poll lands (not in an effect), so the first paint after data is already right.
  const orgsPoll = usePoll(
    "orgs",
    async () => {
      const response = await api.orgs.list();
      const ids = new Set(response.orgs.map((org) => org.id));
      if (!orgRef.current || !ids.has(orgRef.current)) {
        const stored = readStored(ORG_KEY);
        const next = stored && ids.has(stored) ? stored : (defaultOrg(response.orgs)?.id ?? null);
        orgRef.current = next;
        setOrgId(next);
      }
      return response;
    },
    5000,
  );
  const orgs: OrgSummary[] = useMemo(() => orgsPoll.data?.orgs ?? [], [orgsPoll.data]);

  const usersPoll = usePoll<Tagged<User[]>>(
    orgId ? `users:${orgId}` : null,
    async () => {
      const key = orgId!;
      const { users } = await api.users(key);
      if (orgRef.current === key && !users.some((item) => item.id === userRef.current)) {
        const stored = readStored(userKey(key));
        const next = users.some((item) => item.id === stored) ? stored : (defaultUser(users, signedInUser)?.id ?? null);
        userRef.current = next;
        setUserId(next);
      }
      return { key, value: users };
    },
    5000,
  );
  const users = useMemo(() => (usersPoll.data && usersPoll.data.key === orgId ? usersPoll.data.value : []), [usersPoll.data, orgId]);
  const user = users.find((item) => item.id === userId) ?? null;

  const graphPoll = usePoll<Tagged<GraphResponse>>(
    orgId ? `graph:${orgId}` : null,
    async () => ({ key: orgId!, value: await api.graph(orgId!) }),
    3000,
  );
  const activityPoll = usePoll<Tagged<ActivityResponse>>(
    orgId ? `activity:${orgId}` : null,
    async () => ({ key: orgId!, value: await api.activity(orgId!, 120) }),
    2500,
  );
  const graph = graphPoll.data?.key === orgId ? graphPoll.data.value : null;
  const activity = activityPoll.data?.key === orgId ? activityPoll.data.value : null;

  const chooseOrg = (id: string) => {
    if (id === orgId) return;
    writeStored(ORG_KEY, id);
    orgRef.current = id;
    userRef.current = null;
    setOrgId(id);
    setUserId(null);
  };

  const chooseUser = (id: string) => {
    if (orgId) writeStored(userKey(orgId), id);
    userRef.current = id;
    setUserId(id);
  };

  // Never reached the server: nothing to show. Reached it once, then lost it: show what we have, marked stale.
  const failing = orgsPoll.error ?? activityPoll.error ?? graphPoll.error;
  const unreachable = !orgsPoll.data && !!orgsPoll.error;
  const lastOk = Math.max(activityPoll.updatedAt ?? 0, graphPoll.updatedAt ?? 0, orgsPoll.updatedAt ?? 0) || null;

  return {
    orgs,
    orgId,
    users,
    userId,
    user,
    graph,
    activity,
    chooseOrg,
    chooseUser,
    /** The first poll failed: the server is down or unreachable. */
    unreachable,
    /** A poll is failing now; `lastOk` says when data last arrived. */
    reconnecting: !unreachable && !!failing,
    lastOk,
    /** True once the first org list has arrived, even if it is empty. */
    loaded: !!orgsPoll.data,
  };
}
