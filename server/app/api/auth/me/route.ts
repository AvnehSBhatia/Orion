import type { NextRequest } from "next/server";
import { consentState } from "@/auth/consent";
import { monitoringNotice } from "@/auth/notice";
import { config } from "@/config";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { optionalPrincipal, preflight, route } from "@/http/route";

export const runtime = "nodejs";

/** Who is signed in, and whether they still have to accept the monitoring notice. 401 when nobody is. */
export const GET = route(
  async (req: NextRequest) => {
    const p = optionalPrincipal(req);
    if (p) {
      return {
        username: p.username,
        orgId: p.orgId,
        userId: p.userId,
        admin: p.admin,
        kind: p.kind,
        email: p.email,
        consent: { ...consentState(p, getStore(p.orgId)), notice: monitoringNotice() },
        authDisabled: config.authDisabled,
      };
    }
    if (config.authDisabled) return { authDisabled: true };
    throw new HttpError(401, "sign in required");
  },
  { public: true },
);

export const OPTIONS = preflight;
