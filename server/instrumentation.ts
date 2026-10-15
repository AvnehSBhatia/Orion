// Runs once when the Next server starts: refuses to boot in production with unsafe settings (src/http/configCheck.ts),
// then starts background jobs (retention, extraction retries) and the embedder warm-up.
// BACKGROUND_JOBS=off disables the jobs; EMBED_WARM=false skips loading the local model at boot.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateConfig } = await import("./src/http/configCheck");
  try {
    validateConfig();
  } catch (err) {
    // Next would keep listening and answer 500 to everything; stop the process so the supervisor shows the reason.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const { startBackgroundJobs } = await import("./src/jobs/start");
  startBackgroundJobs();
}
