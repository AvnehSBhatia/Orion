import { agentBundle } from "@/downloads/agent";
import { preflight, route } from "@/http/route";

export const runtime = "nodejs";

/** Public: the codebase agent for GitHub Actions. Sending anything with it still takes an Orion token. */
export const GET = route(async () => agentBundle(), { public: true });

export const OPTIONS = preflight;
