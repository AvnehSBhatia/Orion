import type { NextRequest } from "next/server";
import { forgotPassword, forgotRequest } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { forgotLimiter } from "@/auth/ratelimit";
import { preflight, readJson, route } from "@/http/route";

export const runtime = "nodejs";

/**
 * Public: emails a one-time reset link (24h) to the account with this email. Always 200 with the same answer
 * whether or not the account exists; `sent: "not_configured"` when this server cannot send email.
 */
export const POST = route(
  async (req: NextRequest) => {
    const { answer, delivery } = forgotPassword(getAuthDb(), forgotLimiter(), forgotRequest.parse(await readJson(req)));
    // Not awaited: waiting on SMTP only for real accounts would tell them apart by response time.
    void delivery;
    return answer;
  },
  { public: true, limit: "account" },
);

export const OPTIONS = preflight;
