import { NextResponse } from "next/server";
import { latestMac } from "@/downloads/mac";
import { preflight, route } from "@/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: the newest Mac app release (version, file, SHA-256, size), or 404 before the first one is published. */
export const GET = route(
  async () => {
    const latest = await latestMac();
    if (!latest) return NextResponse.json({ error: "no Mac release published yet" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(latest, { headers: { "Cache-Control": "public, max-age=60" } });
  },
  { public: true },
);

export const OPTIONS = preflight;
