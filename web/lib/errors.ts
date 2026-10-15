// Friendly copy for failed calls. Never shows the server's internal error text, except for 400s the user caused.

import { ApiError } from "@/lib/api/client";

export function friendlyError(error: unknown, action = "do that"): string {
  if (!(error instanceof ApiError)) return `Something went wrong. Try again.`;
  if (error.status === 0) return "Can't reach Orion right now. Check your connection and try again.";
  if (error.status === 402) return "Your org has used this month's model budget. An admin can raise it in Admin, Capture policy.";
  if (error.status === 429) {
    const wait = error.retryAfterSec;
    return wait ? `Too many requests. Try again in ${wait < 60 ? `${wait}s` : `${Math.ceil(wait / 60)} min`}.` : "Too many requests. Wait a moment and try again.";
  }
  if (error.status === 403) return `You don't have permission to ${action}.`;
  if (error.status === 404) return "That isn't available any more.";
  if (error.status === 400 || error.status === 409 || error.status === 422) return sentence(error.message);
  if (error.status === 502 || error.status === 503 || error.status === 504) return "The AI model didn't answer. Try again.";
  return "Orion hit a problem on its side. Try again in a moment.";
}

/** "wrong username or password" → "Wrong username or password." */
export function sentence(text: string) {
  const t = text.trim();
  if (!t) return "Something went wrong.";
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
