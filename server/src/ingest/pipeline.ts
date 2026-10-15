import type { CaptureResponse, CodeIngestResponse, ImageStatus, SourceKind } from "@/contract/types";
import { SOURCE_TEXT_MAX, sourceId, type GraphUpdate, type Store } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import { cardLines, cardsToUpdate, domainForRole, type CaptureInput, type CodeInput, type ExtractContext, type Extractor, type KnownNode } from "@/llm/extract";
import type { LlmClient } from "@/llm/openrouter";
import { htmlToText, slugify } from "@/lib/text";
import { HttpError } from "@/http/error";
import { maintainInBackground } from "@/orgspace/maintain";
import { recomputeUserVectors, refreshInBackground } from "@/orgspace/personVectors";
import { config } from "@/config";
import { logJson } from "@/jobs/log";
import { getOrgSettings, isExcludedUrl } from "@/orgs/settings";
import { withUsage } from "@/usage";
import { pageDiff, pageOf, samePage, withChanges } from "./diff";
import { markExtractionFailed } from "./extraction";
import { prepareScreenshot, pruneImage, shrinkImage, type OcrFn } from "./image";

export type IngestDeps = {
  store: Store;
  embedder: Embedder;
  extractor: Extractor;
  /** Org maintenance (labels, retrain, clusters, digests) and screenshot pruning after each ingest. Off when absent. */
  background?: { llm: LlmClient; model: string } | null;
  ocr?: OcrFn;
};

/** Paths that never go to the model, whatever the sender filtered. */
const ALWAYS_EXCLUDE = [
  /(^|\/)\.env[^/]*$/,
  /\.(pem|key)$/,
  /(^|\/)node_modules\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$/,
];

/** Visible page text sent to the extractor. */
const MAX_PAGE_TEXT = 30_000;
/** Page text sent alongside a change block: the change carries the news, the page only context. */
export const MAX_PAGE_TEXT_WITH_DIFF = 8_000;
/** The extension sends every 5 seconds; a repeat of the sender's last capture of a URL within this window is skipped. */
export const CAPTURE_REPEAT_MS = 30 * 60_000;

export function isAlwaysExcluded(path: string): boolean {
  return ALWAYS_EXCLUDE.some((re) => re.test(path));
}

const NOTHING: GraphUpdate = { nodes: [], edges: [] };

/**
 * `update` is null when the model is unavailable (provider error, timeout, budget spent): the document is then
 * stored unjudged, since it may well be useful context, and `error` says why so the source can be retried later.
 */
async function extractOrNull(run: () => Promise<GraphUpdate>): Promise<{ update: GraphUpdate | null; error?: HttpError }> {
  try {
    return { update: await run() };
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    logJson("warn", "extraction skipped, storing the source without graph changes", { status: err.status, error: err.message });
    return { update: null, error: err };
  }
}

/** The URL as stored and sent to the model: query string and fragment removed (they carry tokens, ids, searches). */
export function cleanCaptureUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

const isEmpty = (u: GraphUpdate) => !u.nodes.length && !u.edges.length;

/**
 * Pages the model found no work in, per store, so an open inbox is not re-sent to the model every few seconds.
 * In memory only: after a restart a page is judged once more.
 */
const notWork = new WeakMap<Store, Map<string, { words: Set<string>; at: number }>>();
/** Share of words two captures of a not-work page must have in common to count as the same page. */
export const NOT_WORK_SAME_PAGE = 0.8;

const wordSet = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

function seenAsNotWork(store: Store, key: string, words: Set<string>, now: number): boolean {
  const hit = notWork.get(store)?.get(key);
  return !!hit && now - hit.at <= CAPTURE_REPEAT_MS && jaccard(hit.words, words) >= NOT_WORK_SAME_PAGE;
}

function rememberNotWork(store: Store, key: string, words: Set<string>, now: number): void {
  let seen = notWork.get(store);
  if (!seen) notWork.set(store, (seen = new Map()));
  seen.set(key, { words, at: now });
  if (seen.size > 500) for (const [k, v] of seen) if (now - v.at > CAPTURE_REPEAT_MS) seen.delete(k);
}

function aboutFor(store: Store, userId?: string): ExtractContext {
  const u = userId ? store.getUser(userId) : null;
  return { org: store.getOrg(), author: u ? { name: u.name, role: u.role } : null };
}

function known(store: Store): KnownNode[] {
  return store.listNodes().map(({ id, label, type, domain }) => ({ id, label, type, domain }));
}

type SourceDoc = {
  kind: SourceKind;
  ref: string;
  title: string;
  text: string;
  image: Buffer | null;
  ocrText?: string;
  imageStatus?: ImageStatus;
};

/**
 * Upsert the extracted graph, store the document with what it changed, record who touched it,
 * embed what is new (nodes as text, the document as text plus screenshot, both with their author's role),
 * project to the org space, refit every person's gravity, and schedule org maintenance.
 */
export async function applyUpdate(
  deps: IngestDeps,
  update: GraphUpdate,
  source: SourceDoc,
  userId?: string,
  now = new Date().toISOString(),
): Promise<{ nodesTouched: string[]; sourceId: string }> {
  const { store } = deps;
  const author = userId && store.getUser(userId) ? userId : null;
  const { touched, changes } = store.upsertGraph(update, { sourceKind: source.kind, sourceRef: source.ref, now });
  const id = sourceId(source.kind, source.ref, now);
  store.saveSource({ id, ...source, authorId: author, createdAt: now }, changes);
  if (author && touched.length) store.addTouches(author, touched);
  // With background work on, embedding and steering are coalesced across a burst of ingests; without it (tests), inline.
  const bg = deps.background;
  if (bg) refreshInBackground(store, deps.embedder, () => maintainInBackground(store, deps.embedder, bg.llm, bg.model));
  else await recomputeUserVectors(store, deps.embedder);
  return { nodesTouched: touched, sourceId: id };
}

let pruning: Promise<unknown> = Promise.resolve();

/** One screenshot at a time: a prune embeds 17 crops, and the embedder interleaves live queries between them. */
function pruneInBackground(deps: IngestDeps, id: string, image: Buffer): void {
  const { store, embedder, background } = deps;
  pruning = pruning.then(async () => {
    try {
      const r = await pruneImage(embedder, image);
      console.log(`screenshot ${id}: ${r.status}, dropped ${r.dropped} tiles, sim ${r.sim?.toFixed(3) ?? "n/a"}, ${r.ms}ms`);
      if (r.status !== "pruned" || !store.getSource(id)) return;
      store.replaceSourceImage(id, r.image, "pruned");
      await recomputeUserVectors(store, embedder);
      if (background) maintainInBackground(store, embedder, background.llm, background.model);
    } catch (err) {
      console.error(`screenshot prune failed for ${id}`, err);
    }
  });
}

const visual = (status: ImageStatus) => status === "kept" || status === "pruned";

/**
 * Full page text of each capture stored in this process, by source id, so the next capture of the URL is diffed against
 * the whole page rather than the stored copy (cut at SOURCE_TEXT_MAX, and topped with its own change block).
 */
const lastPages = new WeakMap<Store, Map<string, string>>();

function rememberPage(store: Store, id: string, text: string): void {
  let pages = lastPages.get(store);
  if (!pages) lastPages.set(store, (pages = new Map()));
  pages.set(id, text);
  if (pages.size > 500) pages.delete(pages.keys().next().value!);
}

type PrevSource = NonNullable<ReturnType<Store["lastSourceBy"]>>;

/** The previous capture's page text, and whether it is cut short. */
function prevPage(store: Store, prev: PrevSource): { page: string; truncated: boolean } {
  const full = lastPages.get(store)?.get(prev.id);
  if (full !== undefined) return { page: full, truncated: false };
  return { page: pageOf(prev.text), truncated: prev.text.length >= SOURCE_TEXT_MAX };
}

/** What changed on the page since the sender's previous capture of this URL. Null on a first capture or no real change. */
function changeSince(store: Store, prev: PrevSource | null, text: string): { since: string; diff: string } | null {
  if (!prev) return null;
  const { page, truncated } = prevPage(store, prev);
  const diff = pageDiff(page, truncated ? text.slice(0, SOURCE_TEXT_MAX) : text, { prevTruncated: truncated });
  return diff ? { since: prev.createdAt, diff } : null;
}

/**
 * Same page text (ignoring clock times and "updated N minutes ago" stamps),
 * and same screenshot text when the screenshot carried something the page did not.
 */
function repeatOf(
  deps: IngestDeps,
  body: { url: string; userId: string },
  text: string,
  shot: { ocrText: string; status: ImageStatus },
  now: number,
) {
  const prev = deps.store.lastSourceBy("extension", body.url, body.userId);
  if (!prev || now - Date.parse(prev.createdAt) > CAPTURE_REPEAT_MS) return null;
  const { page, truncated } = prevPage(deps.store, prev);
  if (!samePage(page, truncated ? text.slice(0, page.length) : text)) return null;
  const ocr = (s: { ocrText: string; status: ImageStatus }) => (visual(s.status) ? s.ocrText.slice(0, SOURCE_TEXT_MAX) : "");
  return ocr({ ocrText: prev.ocrText, status: prev.imageStatus }) === ocr(shot) ? prev : null;
}

/**
 * The screenshot goes through OCR first. If its text is already on the page it is dropped (text only);
 * otherwise it is trimmed and shrunk, the extractor reads its OCR text, and it is pruned in the background.
 * A repeat of the sender's last capture of the same URL is answered from that capture without calling the model.
 * Otherwise, when the sender captured the URL before, the extractor gets what changed since then ahead of a shorter page,
 * and the change block is kept at the top of the stored source text.
 * A page the model finds no work in is not stored at all (`notWork`), and is not re-judged while it stays the same.
 */
export function ingestCapture(
  deps: IngestDeps,
  input: Omit<CaptureInput, "text"> & { html: string; screenshotB64: string; userId: string },
  now = Date.now(),
): Promise<CaptureResponse> {
  // Defense in depth behind the route and the extension: capture off or an excluded site means nothing is kept.
  const settings = getOrgSettings(deps.store);
  if (!settings.captureEnabled || isExcludedUrl(settings, input.url)) return Promise.resolve({ nodesTouched: [], sourceId: null, imageStatus: "none" });
  const body = { ...input, url: cleanCaptureUrl(input.url) };
  return withUsage(deps.store, () => captureInContext(deps, body, now));
}

async function captureInContext(
  deps: IngestDeps,
  body: Omit<CaptureInput, "text"> & { html: string; screenshotB64: string; userId: string },
  now: number,
): Promise<CaptureResponse> {
  const text = htmlToText(body.html).slice(0, MAX_PAGE_TEXT);
  const title = body.title || body.url;
  const raw = body.screenshotB64 ? Buffer.from(body.screenshotB64, "base64") : null;
  // Light mode (no OCR, no prune) unless a test injects its own OCR or INGEST_IMAGES=full.
  const light = !deps.ocr && config.ingestImages === "light";
  // Light mode reads no text off the screenshot, so a repeat is known before the image is decoded.
  if (light) {
    const early = repeatOf(deps, body, text, { ocrText: "", status: raw?.length ? "kept" : "none" }, now);
    if (early) return { nodesTouched: [], sourceId: early.id, imageStatus: early.imageStatus, duplicateOf: early.id };
    if (seenAsNotWork(deps.store, `${body.userId}\n${body.url}`, wordSet(text), now)) {
      return { nodesTouched: [], sourceId: null, imageStatus: raw?.length ? "kept" : "none", notWork: true };
    }
  }
  const shot = !raw?.length
    ? null
    : light
      ? { image: await shrinkImage(raw).catch(() => null), ocrText: "", status: "kept" as const, ocrSim: null }
      : await prepareScreenshot(deps.embedder, { title, pageText: text, image: raw }, deps.ocr);
  const prev = repeatOf(deps, body, text, { ocrText: shot?.ocrText ?? "", status: shot?.status ?? "none" }, now);
  if (prev) return { nodesTouched: [], sourceId: prev.id, imageStatus: prev.imageStatus, duplicateOf: prev.id };
  const seen = shot?.status === "kept" && shot.ocrText ? `${text}\n\nText in the screenshot:\n${shot.ocrText}` : text;
  const imageStatus: ImageStatus = shot?.status ?? "none";
  const key = `${body.userId}\n${body.url}`;
  const words = wordSet(seen);
  if (seenAsNotWork(deps.store, key, words, now)) return { nodesTouched: [], sourceId: null, imageStatus, notWork: true };

  const change = changeSince(deps.store, deps.store.lastSourceBy("extension", body.url, body.userId), text);
  const { update, error } = await extractOrNull(() =>
    deps.extractor.fromCapture(
      {
        url: body.url,
        title: body.title,
        text: seen.slice(0, change ? MAX_PAGE_TEXT_WITH_DIFF : MAX_PAGE_TEXT),
        ...(change && { changes: change }),
      },
      known(deps.store),
      aboutFor(deps.store, body.userId),
    ),
  );
  if (update && isEmpty(update)) {
    rememberNotWork(deps.store, key, words, now);
    return { nodesTouched: [], sourceId: null, imageStatus, notWork: true };
  }
  const res = await applyUpdate(
    deps,
    update ?? NOTHING,
    { kind: "extension", ref: body.url, title, text: withChanges(text, change?.diff ?? null, change?.since ?? ""), image: shot?.image ?? null, ocrText: shot?.ocrText ?? "", imageStatus },
    body.userId,
    new Date(now).toISOString(),
  );
  if (error) markExtractionFailed(deps.store, res.sourceId, error, now);
  rememberPage(deps.store, res.sourceId, text);
  if (shot?.image && deps.background && !light) pruneInBackground(deps, res.sourceId, shot.image);
  return { ...res, imageStatus };
}

/** The person behind a commit: the given userId if known, else the person whose id or name matches the git author. */
export function commitAuthor(store: Store, userId?: string, author?: { name: string; email?: string }): string | undefined {
  if (userId && store.getUser(userId)) return userId;
  if (!author) return undefined;
  const name = author.name.trim().toLowerCase();
  const local = author.email?.split("@")[0]?.toLowerCase();
  return store
    .listUsers()
    .find((u) => u.name.toLowerCase() === name || u.id === slugify(author.name) || (!!local && u.id === slugify(local)))?.id;
}

export function ingestCode(
  deps: IngestDeps,
  body: CodeInput & { userId?: string; author?: { name: string; email?: string } },
  maxDiffChars: number,
): Promise<CodeIngestResponse> {
  return withUsage(deps.store, () => codeInContext(deps, body, maxDiffChars));
}

async function codeInContext(
  deps: IngestDeps,
  body: CodeInput & { userId?: string; author?: { name: string; email?: string } },
  maxDiffChars: number,
): Promise<CodeIngestResponse> {
  const files = body.files
    .filter((f) => !isAlwaysExcluded(f.path))
    .map((f) => ({ path: f.path, diff: f.diff.slice(0, maxDiffChars) }));
  const cards = (body.cards ?? []).filter((c) => !c.paths.some(isAlwaysExcluded));
  if (!files.length && !cards.length) return { nodesTouched: [], sourceId: null };

  const userId = commitAuthor(deps.store, body.userId, body.author);
  const about = aboutFor(deps.store, userId);
  const { update, error } = await extractOrNull(() =>
    deps.extractor.fromCode({ repo: body.repo, commitSha: body.commitSha, files, cards }, known(deps.store), about),
  );
  const short = body.commitSha.slice(0, 7);
  const names = files.length ? files.map((f) => f.path) : cards.map((c) => c.label);
  const text = [
    cards.length ? `Feature cards:\n${cardLines(cards)}` : "",
    ...files.map((f) => `--- ${f.path}\n${f.diff}`),
  ].filter(Boolean);
  const fromCards = cards.length && (!update || isEmpty(update)) ? cardsToUpdate(cards, domainForRole(about.author?.role) ?? "engineering") : null;
  const res = await applyUpdate(
    deps,
    fromCards ?? update ?? NOTHING,
    {
      kind: "code",
      ref: `${body.repo}@${body.commitSha}`,
      title: `${body.repo} ${short}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`,
      text: text.join("\n\n"),
      image: null,
    },
    userId,
  );
  // Cards already gave the graph its changes; otherwise a provider failure is retried in the background.
  if (error && !fromCards) markExtractionFailed(deps.store, res.sourceId, error);
  return res;
}
