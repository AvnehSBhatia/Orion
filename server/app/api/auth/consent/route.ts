import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";
import { getOrgSettings } from "@/orgs/settings";

export const runtime = "nodejs";

const consentRequest = z.object({ version: z.number().int().min(1) });

/** The caller accepts the org's monitoring notice. `version` must be the current one (GET /api/auth/me shows it). */
export const POST = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    const { version } = consentRequest.parse(await readJson(req));
    const current = getOrgSettings(getStore(p.orgId)).consentVersion;
    if (version !== current) throw new HttpError(409, `the current notice is version ${current}; reload and accept that one`);
    const account = getAuthDb().setConsent(p.username, version)!;
    return { acceptedAt: account.consentAt };
  },
  { public: true },
);

export const OPTIONS = preflight;
