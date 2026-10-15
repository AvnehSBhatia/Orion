import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, requirePrincipal, route } from "@/http/route";
import { deleteMyCaptures } from "@/orgs/deletion";

export const runtime = "nodejs";

/** Deletes every document and screenshot the caller captured or committed. Graph nodes stay. */
export const DELETE = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    return deleteMyCaptures(getAuthDb(), getStore(p.orgId), p);
  },
  { public: true },
);

export const OPTIONS = preflight;
