import type { NextRequest } from "next/server";
import { macZip } from "@/downloads/mac";
import { preflight, route } from "@/http/route";

export const runtime = "nodejs";

/** Public: a Mac app release zip by the name latest.json gives. */
export const GET = route(
  async (_req: NextRequest, ctx: RouteContext<"/api/downloads/mac/[file]">) => macZip((await ctx.params).file),
  { public: true },
);

export const OPTIONS = preflight;
