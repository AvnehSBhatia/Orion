import { config } from "@/config";

export type ConfigReport = { errors: string[]; warnings: string[] };

const isLocal = (origin: string) => {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return true;
  }
};

/** What is wrong with the environment for this NODE_ENV. Production refuses unsafe settings; dev only warns. */
export function checkConfig(env: NodeJS.ProcessEnv = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";
  const problem = (msg: string) => (production ? errors : warnings).push(msg);

  if (config.authDisabled) problem("AUTH_DISABLED=true turns off sign-in on every route");
  if (!config.cookieSecure) problem("COOKIE_SECURE must be true (serve the API over HTTPS)");
  if (config.extensionIds.length === 0) problem("EXTENSION_IDS must list the Chrome extension ids allowed to call the API");
  if (config.uiOrigins.length === 0 || config.uiOrigins.some(isLocal)) problem(`UI_ORIGIN must be the web app's public origin, not ${config.uiOrigins.join(",") || "empty"}`);
  if (!config.openRouterKey) {
    // With Gemma the server still embeds and stores captures (extraction and chat fail), so that only warns.
    if (config.embedProvider === "gemma") warnings.push("OPENROUTER_API_KEY is not set: extraction and chat will fail (embeddings still run on Gemma)");
    else problem(`OPENROUTER_API_KEY is required (EMBED_PROVIDER=${config.embedProvider}, extraction, and chat)`);
  }
  return { errors, warnings };
}

/** Runs at boot from instrumentation.ts. Throws in production when a setting is unsafe, so the server never starts. */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigReport {
  const report = checkConfig(env);
  for (const w of report.warnings) console.warn(`[config] ${w}`);
  if (report.errors.length) throw new Error(`Refusing to start in production:\n- ${report.errors.join("\n- ")}`);
  return report;
}
