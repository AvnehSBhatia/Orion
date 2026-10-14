import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/http/error";
import { saveOrgSettings } from "@/orgs/settings";
import { memoryStore } from "@/test/helpers";
import { BudgetExceededError, monthUsage, recordUsage, withUsage } from "@/usage";
import { chunkByBytes, doc, OpenRouterEmbedder } from "./embed";
import { backoffMs, isRetryableNetworkError, retryAfterMs, timing } from "./http";
import { OpenRouterClient, streamCompletion } from "./openrouter";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const completion = (content: string, usage: Record<string, number> = { prompt_tokens: 10, completion_tokens: 5 }) =>
  ok({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage });
const req = { model: "google/gemini-2.5-flash-lite", messages: [{ role: "user" as const, content: "hi" }] };

let fetchMock: ReturnType<typeof vi.fn>;
let sleeps: number[];

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sleeps = [];
  vi.spyOn(timing, "sleep").mockImplementation(async (ms) => void sleeps.push(ms));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.OPENROUTER_PROVIDERS;
  delete process.env.OPENROUTER_IGNORE_PROVIDERS;
  delete process.env.OPENROUTER_TIMEOUT_CHAT_MS;
});

const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

describe("OpenRouterClient", () => {
  it("denies data collection, requires parameters, and keeps internal fields off the wire", async () => {
    fetchMock.mockResolvedValue(completion("hello"));
    await new OpenRouterClient().complete({ ...req, purpose: "extract" });
    const body = sentBody();
    expect(body.provider).toEqual({ data_collection: "deny", require_parameters: true });
    expect(body.purpose).toBeUndefined();
    expect(body.usage).toEqual({ include: true });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the provider allow and deny lists", async () => {
    process.env.OPENROUTER_PROVIDERS = "google-vertex, openai";
    process.env.OPENROUTER_IGNORE_PROVIDERS = "deepinfra";
    fetchMock.mockResolvedValue(completion("hello"));
    await new OpenRouterClient().complete(req);
    expect(sentBody().provider).toEqual({ data_collection: "deny", require_parameters: true, only: ["google-vertex", "openai"], ignore: ["deepinfra"] });
  });

  it("retries 429 and 5xx with backoff, honoring Retry-After", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(completion("third time"));
    const res = await new OpenRouterClient().complete(req);
    expect(res.choices[0].message.content).toBe("third time");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeGreaterThanOrEqual(1000); // 500 * 2^1, plus jitter
  });

  it("retries HTTP/2 stream resets and connection errors", async () => {
    const h2 = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM"), { code: "ERR_HTTP2_STREAM_ERROR" }) });
    fetchMock.mockRejectedValueOnce(h2).mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })).mockResolvedValueOnce(completion("ok"));
    await expect(new OpenRouterClient().complete(req)).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 retries with a 502", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(new OpenRouterClient().complete(req)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a 400", async () => {
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(new OpenRouterClient().complete(req)).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails a call that runs past its timeout with a 504, without retrying", async () => {
    process.env.OPENROUTER_TIMEOUT_CHAT_MS = "20";
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    await expect(new OpenRouterClient().complete(req)).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records usage per org, preferring OpenRouter's cost", async () => {
    const store = memoryStore();
    fetchMock.mockResolvedValueOnce(completion("a", { prompt_tokens: 100, completion_tokens: 20, cost: 0.5 }));
    fetchMock.mockResolvedValueOnce(completion("b", { prompt_tokens: 1_000_000, completion_tokens: 0 }));
    await withUsage(store, () => new OpenRouterClient().complete(req));
    await withUsage(store, () => new OpenRouterClient().complete(req));
    // 0.5 returned + 1M input tokens at 0.10 per million from the price table.
    expect(monthUsage(store)).toEqual({ calls: 2, inputTokens: 1_000_100, outputTokens: 20, costUsd: 0.6 });
  });

  it("refuses a call once the org's monthly budget is spent, with a 402", async () => {
    const store = memoryStore();
    saveOrgSettings(store, { llmMonthlyBudgetUsd: 1 });
    recordUsage(store, { model: "x", kind: "chat", inputTokens: 0, outputTokens: 0, costUsd: 1.2 });
    const err = await withUsage(store, () => new OpenRouterClient().complete(req)).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 402, message: "monthly model budget reached" });
    expect(fetchMock).not.toHaveBeenCalled();
    // 0 means no cap.
    saveOrgSettings(store, { llmMonthlyBudgetUsd: 0 });
    fetchMock.mockResolvedValue(completion("ok"));
    await expect(withUsage(store, () => new OpenRouterClient().complete(req))).resolves.toBeTruthy();
  });

  it("a plain HttpError is not a BudgetExceededError", () => {
    expect(new HttpError(402, "x")).not.toBeInstanceOf(BudgetExceededError);
  });
});

function sse(events: string[], { failAfter }: { failAfter?: number } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (failAfter !== undefined && i === failAfter) return c.error(Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } }));
        if (i >= events.length) return c.close();
        c.enqueue(enc.encode(`data: ${events[i++]}\n\n`));
      },
    }),
    { status: 200 },
  );
}
const delta = (t: string) => JSON.stringify({ choices: [{ delta: { content: t } }] });

describe("streamCompletion", () => {
  it("retries a stream that fails before any text, and records usage from the last chunk", async () => {
    const store = memoryStore();
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(sse([], { failAfter: 0 }))
      .mockResolvedValueOnce(sse([delta("Hel"), delta("lo"), JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, cost: 0.01 } }), "[DONE]"]));
    const seen: string[] = [];
    const text = await withUsage(store, () => streamCompletion(req, (d) => seen.push(d)));
    expect(text).toBe("Hello");
    expect(seen).toEqual(["Hel", "lo"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentBody(2)).toMatchObject({ stream: true, provider: { data_collection: "deny" } });
    expect(monthUsage(store)).toMatchObject({ calls: 1, inputTokens: 7, outputTokens: 2, costUsd: 0.01 });
  });

  it("does not retry once text was passed on", async () => {
    fetchMock.mockResolvedValue(sse([delta("partial")], { failAfter: 1 }));
    const seen: string[] = [];
    await expect(streamCompletion(req, (d) => seen.push(d))).rejects.toMatchObject({ status: 502 });
    expect(seen).toEqual(["partial"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retry helpers", () => {
  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("soon")).toBeNull();
  });

  it("backs off exponentially with jitter", () => {
    expect(backoffMs(0, 500, () => 0)).toBe(500);
    expect(backoffMs(2, 500, () => 0)).toBe(2000);
    expect(backoffMs(2, 500, () => 1)).toBe(4000);
  });

  it("tells network errors from timeouts", () => {
    expect(isRetryableNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(false);
    expect(isRetryableNetworkError(new Error("invalid json"))).toBe(false);
  });
});

describe("embedding batches", () => {
  it("splits by count", () => {
    const batches = chunkByBytes(Array.from({ length: 130 }, (_, i) => `t${i}`));
    expect(batches.map((b) => b.length)).toEqual([64, 64, 2]);
  });

  it("splits by bytes, keeping every request under the cap", () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const batches = chunkByBytes([big, big, big, big, "small"]);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const b of batches) expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(6 * 1024 * 1024);
    expect(batches.flat()).toHaveLength(5);
  });

  it("cuts a single input larger than the cap", () => {
    const [[only]] = chunkByBytes(["é".repeat(4 * 1024 * 1024)], 64, 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(only))).toBeLessThan(1024 * 1024);
  });

  it("sends each batch with retries, provider settings, and records usage", async () => {
    const store = memoryStore();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(init.body as string) as { input: string[] };
      return ok({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: input.length, total_tokens: input.length } });
    });
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 429 }));
    const embedder = new OpenRouterEmbedder("k", "google/gemini-embedding-2", 3);
    const vecs = await withUsage(store, () => embedder.embed(Array.from({ length: 70 }, (_, i) => doc(null, `text ${i}`))));
    expect(vecs).toHaveLength(70);
    expect(fetchMock).toHaveBeenCalledTimes(3); // one 429, then 64 + 6
    expect(sentBody(1).provider).toMatchObject({ data_collection: "deny" });
    expect(monthUsage(store)).toMatchObject({ calls: 2, inputTokens: 70 });
  });
});
