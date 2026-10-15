import type { NextRequest } from "next/server";
import { resetPassword, resetRequest } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { preflight, readJson, route } from "@/http/route";

export const runtime = "nodejs";

/** Public: spends a reset link from an admin and sets a new password. Every session of the account is signed out. */
export const POST = route(
  async (req: NextRequest) => {
    await resetPassword(getAuthDb(), resetRequest.parse(await readJson(req)));
    return new Response(null, { status: 204 });
  },
  { public: true, limit: "account" },
);

export const OPTIONS = preflight;
