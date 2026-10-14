/** An error with an HTTP status. Thrown anywhere; `route()` turns it into `{ error }` with that status. */
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
