import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { config } from "@/config";
import type { ErrorResponse } from "@/contract/types";

export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** Matches by shape, so errors thrown by another copy of this module (dev reloads, bundles) still count. */
  static [Symbol.hasInstance](v: unknown): boolean {
    return v instanceof Error && v.name === "HttpError" && typeof (v as { status?: unknown }).status === "number";
  }
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.startsWith("chrome-extension://")) return origin;
  return config.uiOrigins.includes(origin) ? origin : null;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

function errorStatus(err: unknown): { status: number; error: string } {
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { status: 400, error: `${where}${issue?.message ?? "invalid request"}` };
  }
  if (err instanceof SyntaxError) return { status: 400, error: "body must be valid JSON" };
  console.error(err);
  return { status: 500, error: "internal error" };
}

/** Wraps a route handler with JSON output (or a raw Response), CORS, and contract-shaped errors. */
export function route<T, C = unknown>(handler: (req: NextRequest, ctx: C) => Promise<T>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const headers = corsHeaders(req);
    try {
      const out = await handler(req, ctx);
      if (out instanceof Response) {
        for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
        return out;
      }
      return NextResponse.json(out, { headers });
    } catch (err) {
      const { status, error } = errorStatus(err);
      return NextResponse.json<ErrorResponse>({ error }, { status, headers });
    }
  };
}
