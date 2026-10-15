import { NextResponse } from "next/server";
import { getAuthDb } from "@/auth/db";
import { checkHealth } from "@/health";
import { getEmbedder } from "@/http/deps";
import { preflight, route } from "@/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness and readiness for uptime monitors and load balancers: 200 when ready, 503 with the same body when not. */
export const GET = route(
  async () => {
    const health = checkHealth({
      authDb: () => void getAuthDb().db.prepare("SELECT 1").get(),
      embedder: () => getEmbedder().status?.() ?? "ready",
    });
    return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  },
  { public: true },
);

export const OPTIONS = preflight;
