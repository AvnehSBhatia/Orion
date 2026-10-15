/**
 * Streaming responses. `run` writes events and the stream closes when it returns or throws; a throw becomes a
 * final error event (the message of an HttpError, else `fallbackError`), since the status line is already sent.
 */
import { HttpError } from "./error";

const enc = new TextEncoder();
const message = (err: unknown, fallback: string) => (err instanceof HttpError ? err.message : fallback);

/** Server-sent events: `event: <name>\ndata: <json>\n\n`. A comment line goes out first so headers flush at once. */
export function sseResponse(run: (send: (event: string, data: unknown) => void) => Promise<void>, { fallbackError = "request failed" } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      controller.enqueue(enc.encode(": open\n\n"));
      try {
        await run(send);
      } catch (err) {
        send("error", { error: message(err, fallbackError) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}

/** Newline-delimited JSON: one object per line. A throw becomes `onError(message)` as the last line. */
export function ndjsonResponse(
  run: (send: (value: unknown) => void) => Promise<void>,
  { onError = (error: string) => ({ error }) as unknown }: { onError?: (error: string) => unknown } = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (v: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(v)}\n`));
      try {
        await run(send);
      } catch (err) {
        send(onError(err instanceof Error ? err.message : String(err)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
