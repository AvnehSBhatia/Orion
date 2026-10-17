// The codebase agent (codebase-agent/, bundled into one file by its `npm run build`) for a customer's GitHub
// Actions workflow to download and run on every push: their repo needs no copy of it, only Node and a token.
import { promises as fs } from "node:fs";
import { config } from "@/config";
import { HttpError } from "@/http/error";

export async function agentBundle(): Promise<Response> {
  const body = await fs.readFile(config.agentBundle).catch(() => null);
  if (!body) throw new HttpError(404, "the codebase agent is not built on this server");
  return new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
}

