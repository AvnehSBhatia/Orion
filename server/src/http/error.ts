/** An error with an HTTP status. Thrown anywhere; `route()` turns it into `{ error }` with that status. */
export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields for the JSON body, like `{ retryAfterSec }` on a 429. */
    readonly extra?: Record<string, unknown>,
    /** Extra response headers, like `Retry-After`. */
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }

  /** Matches by shape, so errors thrown by another copy of this module (dev reloads, bundles) still count. */
  static [Symbol.hasInstance](v: unknown): boolean {
    return v instanceof Error && v.name === "HttpError" && typeof (v as { status?: unknown }).status === "number";
  }
}

/** 429 with `{ error, retryAfterSec }` and a Retry-After header. */
export const tooManyRequests = (retryAfterSec: number, message = "too many requests, slow down") =>
  new HttpError(429, message, { retryAfterSec }, { "Retry-After": String(retryAfterSec) });
