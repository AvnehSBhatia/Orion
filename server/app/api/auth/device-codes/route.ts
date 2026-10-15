import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { createDeviceCode } from "@/mac/devices";
import { preflight, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** A one-time code (15 minutes) for "Connect your Mac". The Mac trades it at POST /v1/devices/register. */
export const POST = route(async (req: NextRequest) => createDeviceCode(getAuthDb(), requirePrincipal(req)), { public: true, limit: "account" });

export const OPTIONS = preflight;
