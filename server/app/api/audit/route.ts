import type { NextRequest } from "next/server";
import { z } from "zod";
import { listAudit } from "@/audit/log";
import { getAuthDb } from "@/auth/db";
import { HttpError } from "@/http/error";
import { preflight, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) });

/** The admin's org audit log, newest first. */
export const GET = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can read the audit log");
    const { limit } = auditQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    return { events: listAudit(getAuthDb(), p.orgId, limit) };
  },
  { public: true },
);

export const OPTIONS = preflight;
