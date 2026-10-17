import type { NextRequest } from "next/server";
import { z } from "zod";
import { allAudit, audit, listAudit } from "@/audit/log";
import { getAuthDb } from "@/auth/db";
import { HttpError } from "@/http/error";
import { preflight, requirePrincipal, route } from "@/http/route";
import { csvLines, csvResponse } from "@/mac/csv";

export const runtime = "nodejs";

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  format: z.enum(["json", "csv"]).default("json"),
});

/** The admin's org audit log, newest first. `format=csv` downloads every event the org has (kept 400 days), oldest first. */
export const GET = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can read the audit log");
    const { limit, format } = auditQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    const db = getAuthDb();
    if (format === "json") return { events: listAudit(db, p.orgId, limit) };
    const events = allAudit(db, p.orgId);
    audit(db, { orgId: p.orgId, actor: p.username, action: "audit_exported", target: p.orgId, detail: { events: events.length } });
    const rows = events.map((e) => [e.at, e.actor, e.action, e.target, e.detail]);
    return csvResponse(csvLines(["at", "actor", "action", "target", "detail"], rows), `orion-audit-${p.orgId}-${new Date().toISOString().slice(0, 10)}.csv`);
  },
  { public: true },
);

export const OPTIONS = preflight;
