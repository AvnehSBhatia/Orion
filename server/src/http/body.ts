import { HttpError } from "./error";

export const KB = 1024;
export const MB = 1024 * KB;
/** Every route unless it asks for more. */
export const DEFAULT_MAX_BODY = 256 * KB;

const tooLarge = (max: number) => new HttpError(413, `request body must be at most ${max >= MB ? `${max / MB}MB` : `${max / KB}KB`}`);

/** 413 when the declared Content-Length is over the cap, before anything is read. */
export function checkContentLength(req: Request, max: number): void {
  const len = req.headers.get("content-length");
  if (len !== null && Number(len) > max) throw tooLarge(max);
}

/** Reads the body as bytes, stopping with 413 the moment it passes `max` (a missing or lying Content-Length too). */
export async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  checkContentLength(req, max);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge(max);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The body parsed as JSON with a byte cap. An empty body is `fallback` when given, else a 400. */
export async function readJsonCapped(req: Request, max: number, fallback?: unknown): Promise<unknown> {
  const bytes = await readCapped(req, max);
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, "body must be valid JSON");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "body must be valid JSON");
  }
}
