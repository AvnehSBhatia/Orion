import { getLlm, getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { config } from "@/config";
import { v1Route } from "@/mac/http";
import { assertMayCapture } from "@/mac/policy";
import { summarize, summariesRequest } from "@/mac/summaries";
import { withUsage } from "@/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One to three sentences about the blocks. Stores nothing, logs nothing from the request; titles without a model.
 * The text is not approved yet, so the same gate as sending work applies: consent given, capture not paused. The call
 * counts against the org's model budget, and over it the summary is the titles.
 */
export const POST = v1Route(
  async (req, _ctx, p) => {
    const { blocks } = summariesRequest.parse(await readJson(req));
    const store = getStore(p.orgId);
    assertMayCapture(store, p);
    return { summary: await withUsage(store, () => summarize(config.openRouterKey ? getLlm() : null, blocks)) };
  },
  { limit: "ask" },
);

export const OPTIONS = preflight;
