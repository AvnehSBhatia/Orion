import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { v1Route } from "@/mac/http";
import { macPolicy } from "@/mac/policy";

export const runtime = "nodejs";

export const GET = v1Route(async (_req, _ctx, p) => macPolicy(getStore(p.orgId), p));

export const OPTIONS = preflight;
