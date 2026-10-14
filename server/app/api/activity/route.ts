import type { NextRequest } from "next/server";
import { activityQuery } from "@/contract/schemas";
import type { ActivityPerson, ActivityResponse } from "@/contract/types";
import { getStore } from "@/http/deps";
import { preflight, route, scopedQuery } from "@/http/route";

export const runtime = "nodejs";

const HOUR = 3_600_000;

/** What people are capturing and committing right now. Cheap enough to poll every couple of seconds. */
export const GET = route(async (req: NextRequest): Promise<ActivityResponse> => {
  const { orgId, limit } = activityQuery.parse(scopedQuery(req));
  const store = getStore(orgId);
  const now = Date.now();
  const lastHourAt = new Date(now - HOUR).toISOString();
  const recent = store.sourceAuthorsSince(new Date(now - 24 * HOUR).toISOString());
  const names = new Map(store.listUsers().map((u) => [u.id, u.name]));

  // Newest first, so the first row seen per author is their latest.
  const byAuthor = new Map<string, ActivityPerson>();
  for (const s of recent) {
    const key = s.authorId ?? "";
    const p = byAuthor.get(key);
    if (p) p.count++;
    else byAuthor.set(key, { authorId: s.authorId, name: s.authorId ? (names.get(s.authorId) ?? s.authorId) : "Unknown", count: 1, lastAt: s.createdAt });
  }
  const people = [...byAuthor.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));

  return {
    sources: store.listSources(undefined, limit).map((s) => store.toPublicSource(s)),
    people,
    counts: { ...store.counts(), lastHour: recent.filter((s) => s.createdAt >= lastHourAt).length, people: people.length },
  };
});

export const OPTIONS = preflight;
