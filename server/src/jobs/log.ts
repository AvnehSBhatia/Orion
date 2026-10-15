/** One JSON line per event, so a log shipper can index background work without parsing prose. */
export function logJson(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, ...("status" in v ? { status: v.status } : {}), stack: v.stack?.split("\n").slice(0, 6).join("\n") } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Runs a background job so that nothing it does can take the process down: a throw or rejection is logged as
 * structured JSON and swallowed. Returns the job's result, or undefined when it failed.
 */
export async function safely<T>(job: string, run: () => Promise<T> | T, fields: Record<string, unknown> = {}): Promise<T | undefined> {
  try {
    return await run();
  } catch (err) {
    logJson("error", "background job failed", { job, ...fields, err });
    return undefined;
  }
}
