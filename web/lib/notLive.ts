import { statusOf } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";

/**
 * Friendly copy for admin and settings calls. A 404 or 405 from these endpoints means the server predates them
 * (docs/api-additions.md), so say that rather than "not found".
 */
export function settingsError(error: unknown, action: string) {
  const status = statusOf(error);
  if (status === 404 || status === 405) return "Your Orion server doesn't support this yet. Update the server and try again.";
  return friendlyError(error, action);
}
