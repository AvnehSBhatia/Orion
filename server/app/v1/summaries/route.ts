import { getLlm } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { config } from "@/config";
import { v1Route } from "@/mac/http";
import { summarize, summariesRequest } from "@/mac/summaries";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One to three sentences about the blocks. Stores nothing, logs nothing from the request; titles without a model. */
export const POST = v1Route(
  async (req) => {
    const { blocks } = summariesRequest.parse(await readJson(req));
    return { summary: await summarize(config.openRouterKey ? getLlm() : null, blocks) };
  },
  { limit: "ask" },
);

export const OPTIONS = preflight;
