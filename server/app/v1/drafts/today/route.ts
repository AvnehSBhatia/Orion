import { config } from "@/config";
import { getLlm, getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { todayDraft } from "@/mac/drafts";
import { v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** Today's draft for the local day in ?tz (UTC when missing or unknown). */
export const GET = v1Route(async (req, _ctx, p) => {
  const store = getStore(p.orgId);
  return todayDraft({ store, llm: config.openRouterKey ? getLlm() : null, model: config.chatModel }, p.userId, req.nextUrl.searchParams.get("tz"));
});

export const OPTIONS = preflight;
