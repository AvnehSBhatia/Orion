import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { createAccountIn, newAccountRequest } from "@/auth/service";
import { getEmbedder, getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, requirePrincipal, route } from "@/http/route";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const runtime = "nodejs";

/** An org admin adds an account to their org; the person is added to the org if missing. */
export const POST = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can create accounts");
    const body = newAccountRequest.parse(await req.json());
    const store = getStore(p.orgId);
    const { account, created } = await createAccountIn(getAuthDb(), store, p.orgId, body);
    if (created) await recomputeUserVectors(store, getEmbedder());
    return { account };
  },
  { public: true },
);

export const OPTIONS = preflight;
