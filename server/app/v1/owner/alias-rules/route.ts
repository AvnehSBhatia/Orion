import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { adminRules } from "@/mac/clients";
import { assertOwner, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const GET = v1Route(async (_req, _ctx, p) => {
  assertOwner(p);
  return { rules: adminRules(getStore(p.orgId)) };
});

export const OPTIONS = preflight;
