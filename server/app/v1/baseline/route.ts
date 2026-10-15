import { getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { baselineRequest, saveBaseline } from "@/mac/drafts";
import { v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** The person's own timesheet for a day; replaces that day. */
export const POST = v1Route(async (req, _ctx, p) => saveBaseline(getStore(p.orgId), p.userId, baselineRequest.parse(await readJson(req))));

export const OPTIONS = preflight;
