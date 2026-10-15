import { z } from "zod";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { v1Route } from "@/mac/http";
import { acceptConsent } from "@/mac/policy";

export const runtime = "nodejs";

const body = z.object({ version: z.number().int() });

export const POST = v1Route(async (req, _ctx, p) => acceptConsent(getAuthDb(), getStore(p.orgId), p, body.parse(await readJson(req)).version));

export const OPTIONS = preflight;
