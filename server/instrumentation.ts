/** Runs once when the server starts. Refuses to boot in production with unsafe settings (see src/http/configCheck.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateConfig } = await import("./src/http/configCheck");
  validateConfig();
}
