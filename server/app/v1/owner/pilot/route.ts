import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { dayRange, ownerPilot } from "@/mac/drafts";
import { assertOwner, v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** Admin: review counts and active days per person, no snippets or titles. */
export const GET = v1Route(async (req, _ctx, p) => {
  assertOwner(p);
  const q = req.nextUrl.searchParams;
  const { from, to } = dayRange(q.get("from"), q.get("to"), 30);
  return ownerPilot(getStore(p.orgId), from, to);
});

export const OPTIONS = preflight;
