import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { loginLimiter } from "@/auth/ratelimit";
import { clientIp } from "@/auth/request";
import { preflight, readJson } from "@/http/route";
import { registerDevice, registerRequest } from "@/mac/devices";
import { v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** Trades a one-time code for a device token. 401 for a wrong, used, or expired code; failures are rate limited per IP. */
export const POST = v1Route(async (req: NextRequest) => registerDevice(getAuthDb(), loginLimiter(), registerRequest.parse(await readJson(req)), clientIp(req)), {
  public: true,
  limit: "account",
});

export const OPTIONS = preflight;
