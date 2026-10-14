import { config } from "@/config";
import type { BriefResponse, Source, User } from "@/contract/types";
import type { Store } from "@/db/store";
import { plain } from "@/lib/text";
import { capCitations, FAST_MODEL, firstName, Handles } from "@/llm/chat";
import type { Embedder } from "@/llm/embed";
import type { LlmClient } from "@/llm/openrouter";
import { feedFor } from "./feed";

export const BRIEF_HOURS = 2;
export const BRIEF_TTL_MS = 60_000;
export const BRIEF_TIMEOUT_MS = 2_000;
const BRIEF_ITEMS = 5;

type Why = { why: string };
type Moved = Source & Why;

export type BriefDeps = { llm?: LlmClient | null; now?: number; timeoutMs?: number };

const greeting = (now: number) => {
  const h = new Date(now).getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
};

/** What moved for the person in the window: their ranked feed, then documents that flipped work to blocked or at risk. */
export async function whatMoved(store: Store, embedder: Embedder, userId: string, now: number): Promise<Moved[]> {
  const feed = await feedFor(store, embedder, { userId, sinceHours: BRIEF_HOURS, limit: BRIEF_ITEMS, now });
  const since = new Date(now - BRIEF_HOURS * 3_600_000).toISOString();
  const flips: Moved[] = store
    .listSources(since, 200)
    .map((s) => store.toPublicSource(s))
    .flatMap((s) => {
      const c = s.changes.find((c) => (c.statusTo === "blocked" || c.statusTo === "at_risk") && c.statusFrom !== c.statusTo);
      return c ? [{ ...s, why: `${c.label} is now ${c.statusTo.replace("_", " ")}` }] : [];
    });
  const out: Moved[] = [];
  // Two commits to the same item read the same, so skip anything whose clause is already in the brief.
  for (const s of [...feed, ...flips]) if (!out.some((o) => o.id === s.id || phrase(o) === phrase(s))) out.push(s);
  return out.slice(0, BRIEF_ITEMS);
}

/** One clause per document: who changed what, else what flipped, else its title. */
function phrase(s: Moved): string {
  if (s.why.startsWith("changed ")) return `${s.authorName ? firstName(s.authorName) : "someone"} ${s.why}`;
  if (s.why === "close to your work") return `${s.authorName ? firstName(s.authorName) : "someone"} posted ${s.title}`;
  return s.why;
}

/** No model: the same brief from a template, citing each item. */
export function templateBrief(user: Pick<User, "name">, moved: Moved[], now: number): BriefResponse {
  const hi = `${greeting(now)} ${firstName(user.name)}`;
  if (!moved.length) return { text: `${hi}, nothing new for you in the last ${BRIEF_HOURS} hours.`, sources: [] };
  const top = moved.slice(0, 3);
  const n = moved.length;
  const parts = top.map((s, i) => `${phrase(s)} [${i + 1}]`);
  return { text: plain(`${hi}, ${n} ${n === 1 ? "thing" : "things"} moved for you: ${parts.join("; ")}.`), sources: top };
}

const BRIEF_PROMPT = (first: string, role: string) =>
  `You are ${first}'s personal chief of staff. ${first}'s role, in their words: "${role}".
Write ${first} a one or two sentence briefing of what changed for them, from the documents below, most important to their role first.
Start with "<greeting> ${first}, <n> things moved for you:" using the greeting and count you are given. Second person, warm, direct, no filler.
Then name the 2 or 3 that matter most to their role, each as its own short clause with its own handle right after it, like "Voice latency fix is now blocked [S1]; the Acme renewal slipped [S3]". At most 3 handles. Plain words, no em dashes, no exclamation marks, at most 45 words.`;

/** One fast model call over what moved; the template when there is no key, nothing moved, or the model takes over 2s. */
export async function briefFor(store: Store, embedder: Embedder, user: User, deps: BriefDeps = {}): Promise<BriefResponse> {
  const now = deps.now ?? Date.now();
  const moved = await whatMoved(store, embedder, user.id, now);
  const fallback = templateBrief(user, moved, now);
  const llm = deps.llm;
  if (!llm || !moved.length) return fallback;

  const handles = new Handles();
  const docs = moved.map((s) => ({ ...handles.brief(s), excerpt: s.excerpt.slice(0, 160) }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completion = await Promise.race([
      llm.complete({
        model: FAST_MODEL,
        max_tokens: 120,
        temperature: 0,
        messages: [
          { role: "system", content: BRIEF_PROMPT(firstName(user.name), user.role.slice(0, 300)) },
          { role: "user", content: `Greeting: ${greeting(now)}\nCount: ${moved.length}\n\nDocuments:\n${JSON.stringify(docs)}` },
        ],
      }),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("brief timed out")), deps.timeoutMs ?? BRIEF_TIMEOUT_MS))),
    ]);
    const text = plain(completion.choices[0]?.message.content ?? "");
    if (!text) return fallback;
    const cited = handles.cite(text);
    if (!cited.sources.length) return fallback;
    const capped = capCitations(cited.reply, cited.sources);
    return { text: capped.reply, sources: capped.sources };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// Per person, survives dev hot reloads.
const g = globalThis as typeof globalThis & { __orionBriefs?: Map<string, { at: number; value: Promise<BriefResponse> }> };
const cache = (g.__orionBriefs ??= new Map());

/** briefFor, cached per org and person for 60s (concurrent callers share one call). */
export function cachedBrief(key: string, make: () => Promise<BriefResponse>, now = Date.now()): Promise<BriefResponse> {
  const hit = cache.get(key);
  if (hit && now - hit.at < BRIEF_TTL_MS) return hit.value;
  const value = make();
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}

/** True when the backend can call the model. */
export const hasModelKey = () => !!config.openRouterKey;
