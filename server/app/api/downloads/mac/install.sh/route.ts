import type { NextRequest } from "next/server";
import { installScript, publicOrigin } from "@/downloads/mac";
import { route } from "@/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: the install and update script for `curl -fsSL .../install.sh | bash`. */
export const GET = route(
  async (req: NextRequest) =>
    new Response(installScript(publicOrigin(req)), { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } }),
  { public: true },
);
