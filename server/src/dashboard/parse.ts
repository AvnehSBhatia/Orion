// Reads common dashboard requests (domain, status, owner, recency, source, "only", "add") with no model, so the
// board changes the moment the person hits enter. Whatever words it cannot place are left for the model (ask.ts).
import type { Domain, GraphResponse, Status, User, Widget, WidgetFilter } from "@/contract/types";

export type AskIntent = {
  groups: WidgetFilter[]; // one per thing asked for ("blocked marketing" and "Google Ads changes today")
  kinds: Widget["kind"][]; // widgets named outright ("the constellation", "who is active")
  sellable: boolean;
  only: boolean; // "only X" / "just X": nothing unrelated stays
  add: boolean; // "also show X" / "add X": keep the current board and put X first
  role: string | null; // "I am a growth marketer": reshape for the role
  leftover: string[]; // words the parser did not use; when empty, the draft is final and the model is skipped
};

const DOMAIN_WORDS: [Domain, RegExp][] = [
  ["marketing", /\b(marketing|campaigns?|growth|brand|seo)\b/g],
  ["sales", /\b(sales|deals?|pipeline|accounts?|customers?|prospects?|renewals?)\b/g],
  ["engineering", /\b(engineering|eng|dev|backend|frontend|infra|bugs?)\b/g],
  ["ops", /\b(ops|operations|finance|legal|hiring|vendors?|suppliers?|procurement)\b/g],
];

// Where work was captured from. The value is what the UI matches against a page URL or title.
const SOURCE_WORDS: [string, RegExp][] = [
  ["google ads", /\b(google ads?|adwords)\b/g],
  ["meta ads", /\b(meta|facebook|instagram) ads?\b/g],
  ["linkedin", /\blinked ?in\b/g],
  ["hubspot", /\bhub ?spot\b/g],
  ["salesforce", /\bsalesforce\b/g],
  ["crm", /\bcrm\b/g],
  ["code", /\b(github|git|commits?|pull requests?|prs?|code changes?|code)\b/g],
  ["jira", /\bjira\b/g],
  ["linear", /\blinear\b/g],
  ["figma", /\bfigma\b/g],
  ["notion", /\bnotion\b/g],
  ["slack", /\bslack\b/g],
  ["stripe", /\bstripe\b/g],
  ["google docs", /\bgoogle docs?\b/g],
];

const STATUS_WORDS: [Status[], RegExp][] = [
  [["blocked", "at_risk"], /\b(needs? attention|in trouble|problems?|risks|trouble)\b/g],
  [["blocked"], /\b(blocked|blockers?|blocking|stuck)\b/g],
  [["at_risk"], /\b(at[- ]risk|risky|slipping|behind)\b/g],
  [["on_track"], /\b(on[- ]track|healthy)\b/g],
  [["done"], /\b(done|shipped|completed?|finished)\b/g],
];

const KIND_WORDS: [Widget["kind"], RegExp][] = [
  ["constellation", /\b(constellation|clusters?|by meaning)\b/g],
  ["map", /\b(star ?map|map)\b/g],
  ["people", /\b(who is active|who's active|people|teammates)\b/g],
  ["gaps", /\b(gaps?|unowned|no owner|nobody owns)\b/g],
  ["activity", /\b(activity|live feed|feed|captures)\b/g],
  ["status_breakdown", /\b(status breakdown|by status)\b/g],
  ["domain_breakdown", /\b(by domain|per domain|domain breakdown)\b/g],
];

// Words that carry no filter: request verbs, fillers, and nouns that just mean "things".
const FILLER = new Set(
  ("a an the and or of in on for to from with by at about is are was be this that these those it its all every any " +
    "show me my see view display give get put pull up bring want need would like please can could you i we us our let " +
    "dashboard board page screen widget widgets card cards thing things stuff work items item tasks task everything " +
    "changes change changed updates updated update happening happened going new latest recent recently what whats " +
    "which there here now just only also add plus focus track watch monitor keep make set switch rebuild into " +
    "being been has have had owned owns own s").split(" "),
);

const TIME_WORDS: [number, RegExp][] = [
  [1, /\b(last|past|this) hour\b/g],
  [24, /\b(today'?s?|this morning|this afternoon|tonight|last 24 hours|past 24 hours|past day|last day)\b/g],
  [48, /\byesterday\b/g],
  [168, /\b(this|last|past) week\b/g],
  [720, /\b(this|last|past) month\b/g],
];

type Clause = { f: WidgetFilter; subject: boolean };

const emptyFilter = (): WidgetFilter => ({ domains: null, statuses: null, nodeIds: null, owner: null, query: null, sinceHours: null, source: null });
const hasAny = (f: WidgetFilter) => Object.values(f).some((v) => v !== null && v !== undefined);
export const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads one clause, blanking every span it used so whatever is left over is visible. */
function parseClause(text: string, owners: string[], user: User): { f: WidgetFilter; rest: string } {
  let t = ` ${text} `;
  const f = emptyFilter();
  const take = (re: RegExp, on: (m: string[]) => void) => {
    t = t.replace(re, (...args: unknown[]) => {
      on(args.filter((a): a is string => typeof a === "string" || a === undefined) as string[]);
      return " ";
    });
  };
  // Quoted phrases and "about X" are a text query, read first so their words are not reused.
  take(/"([^"]{2,60})"|“([^”]{2,60})”/g, (m) => (f.query = (m[1] ?? m[2] ?? "").trim() || null));
  take(/\b(?:about|mentioning|related to|regarding|containing|named|called)\s+([a-z0-9][a-z0-9 .\-]{1,58}?)\s*$/g, (m) => (f.query ??= m[1].trim()));
  const n = t.match(/\b(?:last|past)\s+(\d{1,3})\s*(hours?|hrs?|h|days?|d|weeks?|w)\b/);
  if (n) {
    const unit = n[2][0];
    f.sinceHours = Number(n[1]) * (unit === "h" ? 1 : unit === "d" ? 24 : 168);
    t = t.replace(n[0], " ");
  }
  for (const [hours, re] of TIME_WORDS) take(re, () => (f.sinceHours ??= hours));
  for (const [source, re] of SOURCE_WORDS) take(re, () => (f.source ??= source));
  take(/\b(mine|assigned to me|i own|my (?:work|stuff|tasks|things|items|projects|deals|campaigns|tickets))\b/g, () => (f.owner = user.name));
  for (const owner of owners) {
    const parts = owner.toLowerCase().split(/\s+/);
    const names = uniq([parts.join(" "), parts[0]].filter((p) => p.length >= 3));
    for (const name of names) take(new RegExp(`\\b${escapeRe(name)}(?:'s)?\\b`, "g"), () => (f.owner ??= owner));
  }
  const statuses: Status[] = [];
  for (const [ss, re] of STATUS_WORDS) take(re, () => statuses.push(...ss));
  if (statuses.length) f.statuses = uniq(statuses);
  const domains: Domain[] = [];
  for (const [d, re] of DOMAIN_WORDS) take(re, () => domains.push(d));
  if (domains.length) f.domains = uniq(domains);
  return { f, rest: t };
}

/** Deterministic read of a dashboard ask. Never calls a model. */
export function parseAsk(message: string, user: User, graph: Pick<GraphResponse, "nodes">): AskIntent {
  const owners = uniq(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : [])));
  if (user.name && !owners.includes(user.name)) owners.push(user.name);
  let text = message.toLowerCase().replace(/’/g, "'").replace(/[!?.]+\s*$/, "");
  const intent: AskIntent = { groups: [], kinds: [], sellable: false, only: false, add: false, role: null, leftover: [] };

  const role = text.match(/\b(?:i am|i'm|im|my role is|i work as)\s+(?:a|an|the)\s+(.{3,})$/);
  if (role) {
    intent.role = message.slice(message.length - role[1].length).trim();
    // The role heuristic is a fair instant board, but only the model reads "deep ML researcher" well.
    intent.leftover = [intent.role];
    return intent;
  }
  const flag = (re: RegExp, set: () => void) => {
    text = text.replace(re, () => {
      set();
      return " ";
    });
  };
  flag(/\b(only|just|nothing but|exclusively)\b/g, () => (intent.only = true));
  flag(/^\s*(?:also|add|plus|and)\b|\b(?:also|add|include)\b/g, () => (intent.add = true));
  flag(/\b(sellable|ready to sell|can sell|ready to announce)\b/g, () => (intent.sellable = true));
  for (const [kind, re] of KIND_WORDS) flag(re, () => intent.kinds.includes(kind) || intent.kinds.push(kind));

  const clauses: Clause[] = [];
  const leftover: string[] = [];
  for (const part of text.split(/\s*(?:,|;|&|\band\b|\bplus\b|\balong with\b|\bas well as\b)\s*/)) {
    const { f, rest } = parseClause(part, owners, user);
    leftover.push(...rest.split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !FILLER.has(w)));
    if (hasAny(f)) clauses.push({ f, subject: !!(f.domains || f.owner || f.source || f.query) });
  }
  // "blocked and at risk sales": a clause with only statuses joins the next clause when that one has statuses too.
  for (let i = 0; i < clauses.length - 1; i++) {
    const a = clauses[i];
    const b = clauses[i + 1];
    if (!a.subject && a.f.statuses && !a.f.sinceHours && b.f.statuses) {
      b.f.statuses = uniq([...a.f.statuses, ...b.f.statuses]);
      clauses.splice(i--, 1);
    }
  }
  const seen = new Set<string>();
  for (const c of clauses) {
    const key = JSON.stringify(c.f);
    if (!seen.has(key)) {
      seen.add(key);
      intent.groups.push(c.f);
    }
  }
  intent.groups = intent.groups.slice(0, 4);
  intent.leftover = uniq(leftover);
  return intent;
}

// Titles

export const STATUS_TITLE: Record<Status, string> = { blocked: "blocked", at_risk: "at risk", on_track: "on track", done: "done", unknown: "unknown" };
const SOURCE_TITLE: Record<string, string> = {
  "google ads": "Google Ads",
  "meta ads": "Meta Ads",
  linkedin: "LinkedIn",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  crm: "CRM",
  code: "code",
  jira: "Jira",
  linear: "Linear",
  figma: "Figma",
  notion: "Notion",
  slack: "Slack",
  stripe: "Stripe",
  "google docs": "Google Docs",
};

function sinceTitle(h: number): string {
  if (h === 1) return "this hour";
  if (h === 24) return "today";
  if (h === 48) return "since yesterday";
  if (h === 168) return "this week";
  if (h === 720) return "this month";
  return h % 24 === 0 ? `last ${h / 24} days` : `last ${h} hours`;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Google|Meta|LinkedIn|HubSpot|Salesforce|CRM|Jira|Linear|Figma|Notion|Slack|Stripe)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "Blocked marketing work", "Google Ads changes today", "Priya Shah's work". */
export function filterTitle(f: WidgetFilter): string {
  const words: string[] = [];
  if (f.owner) words.push(`${f.owner}'s`);
  if (f.statuses) words.push(f.statuses.map((s) => STATUS_TITLE[s]).join(" and "));
  if (f.domains) words.push(f.domains.join(" and "));
  if (f.source) words.push(SOURCE_TITLE[f.source] ?? f.source);
  words.push(f.source || f.sinceHours ? "changes" : "work");
  if (f.query) words.push(`about ${f.query}`);
  if (f.sinceHours) words.push(sinceTitle(f.sinceHours));
  return cap(words.join(" ")).slice(0, 60);
}
