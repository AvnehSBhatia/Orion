import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { MB } from "@/http/body";
import { preflight } from "@/http/route";
import { importClients } from "@/mac/clients";
import { assertOwner, v1Error, v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** CSV body (`name,aliases,domains,project_codes`), as text/csv or as JSON `{ csv }`. */
export const POST = v1Route(
  async (req, _ctx, p) => {
    assertOwner(p);
    const raw = await req.text();
    let csv = raw;
    if (req.headers.get("content-type")?.includes("json")) {
      const parsed = JSON.parse(raw) as { csv?: unknown };
      if (typeof parsed.csv !== "string") throw v1Error(400, "invalid_request", "send { \"csv\": \"...\" } or a text/csv body");
      csv = parsed.csv;
    }
    return importClients(getAuthDb(), getStore(p.orgId), p, csv);
  },
  { maxBody: 2 * MB },
);

export const OPTIONS = preflight;
