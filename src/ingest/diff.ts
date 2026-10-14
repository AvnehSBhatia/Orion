/**
 * What changed between two captures of the same page, as a few lines the extractor and a teammate can read:
 * `Changed: "Daily budget $900" -> "Daily budget $1,200" (900 -> 1,200)`, `Added: "..."`, `Removed: "..."`.
 * Clock times and "N minutes ago" stamps are noise: two lines that differ only in those count as the same line.
 */

/** Longest change block passed to the extractor and stored at the top of the source text. */
export const MAX_DIFF_CHARS = 3_000;
const MAX_LINE_CHARS = 240;
/** Above this many lines on either side of the changed middle, lines are matched as sets instead of by LCS. */
const MAX_LCS_LINES = 1_500;
/** When more than this share of lines changed, the page is a different view, not an edit: no diff. */
const MAX_CHANGED_SHARE = 0.6;

const HEADER = "What changed since the last capture (at ";
const PAGE_MARK = "\n\nPage now:\n";

const NOISE: RegExp[] = [
  /\b\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?\b/gi,
  /\b(\d+|a|an|one|a few)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\s+ago\b/gi,
  /\b(just now|moments? ago|seconds ago)\b/gi,
  /\blast (updated|refreshed|synced|saved)\b[^.\n]{0,40}/gi,
];

/** A line with its noise (times, relative stamps) replaced, for comparing captures. */
export function quiet(line: string): string {
  let out = line;
  for (const re of NOISE) out = out.replace(re, "#");
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Same page, ignoring timestamps and "updated N minutes ago" lines. */
export function samePage(a: string, b: string): boolean {
  if (a === b) return true;
  const la = lines(a).map(quiet).filter(Boolean);
  const lb = lines(b).map(quiet).filter(Boolean);
  return la.length === lb.length && la.every((l, i) => l === lb[i]);
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

type Op = { kind: "same" | "del" | "add"; line: string };

/** Line diff by LCS over the changed middle (common head and tail trimmed first). */
function diffLines(a: string[], b: string[]): Op[] {
  const qa = a.map(quiet);
  const qb = b.map(quiet);
  let head = 0;
  while (head < a.length && head < b.length && qa[head] === qb[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && qa[a.length - 1 - tail] === qb[b.length - 1 - tail]) tail++;
  const ma = a.slice(head, a.length - tail);
  const mb = b.slice(head, b.length - tail);
  const mqa = qa.slice(head, a.length - tail);
  const mqb = qb.slice(head, b.length - tail);
  const ops: Op[] = b.slice(0, head).map((line) => ({ kind: "same", line }));
  if (ma.length > MAX_LCS_LINES || mb.length > MAX_LCS_LINES) {
    const inB = new Set(mqb);
    const inA = new Set(mqa);
    ma.forEach((line, i) => !inB.has(mqa[i]) && ops.push({ kind: "del", line }));
    mb.forEach((line, i) => ops.push({ kind: inA.has(mqb[i]) ? "same" : "add", line }));
  } else {
    const n = ma.length;
    const m = mb.length;
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = mqa[i] === mqb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && mqa[i] === mqb[j]) {
        ops.push({ kind: "same", line: mb[j] });
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
        ops.push({ kind: "add", line: mb[j++] });
      } else {
        ops.push({ kind: "del", line: ma[i++] });
      }
    }
  }
  for (const line of b.slice(b.length - tail)) ops.push({ kind: "same", line });
  return ops;
}

const tokens = (s: string) => s.match(/[$€£]?\d[\d,.]*%?|[\p{L}]+|[^\s\p{L}\d]/gu) ?? [];

/** The values that differ between two versions of a line, e.g. "900 -> 1,200". Empty when it is not a short value edit. */
function valueChange(from: string, to: string): string {
  const a = tokens(from);
  const b = tokens(to);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const was = a.slice(head, a.length - tail).join(" ");
  const now = b.slice(head, b.length - tail).join(" ");
  if (!head && !tail) return "";
  if (was.length > 60 || now.length > 60) return "";
  return `${was || "(nothing)"} -> ${now || "(nothing)"}`;
}

/** Share of words two lines have in common, to pair a removed line with the added line that replaced it. */
function alike(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().match(/\p{L}{2,}/gu) ?? []);
  const wb = new Set(b.toLowerCase().match(/\p{L}{2,}/gu) ?? []);
  if (!wa.size && !wb.size) return 1;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
}

const q = (line: string) => `"${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 3)}...` : line}"`;

/**
 * The change block between the previous capture's page text and this one, or null when nothing meaningful changed
 * or the page is mostly different (a new view on the same URL). `prevTruncated`: the previous text was cut at the end,
 * so lines after its last match are not reported as added.
 */
export function pageDiff(prev: string, next: string, { prevTruncated = false } = {}): string | null {
  const a = lines(prev);
  const b = lines(next);
  const ops = diffLines(a, b);
  if (prevTruncated) {
    let last = ops.length - 1;
    while (last >= 0 && ops[last].kind !== "same") last--;
    ops.length = last + 1;
  }
  const changed = ops.filter((o) => o.kind !== "same");
  if (!changed.length) return null;
  const adds = changed.filter((o) => o.kind === "add").length;
  if (Math.max(adds, changed.length - adds) > MAX_CHANGED_SHARE * Math.max(a.length, b.length, 1) && Math.max(a.length, b.length) > 3) {
    return null;
  }

  // Each run of removals and additions: pair removed lines with the most alike added line as "Changed".
  const out: string[] = [];
  for (let k = 0; k < ops.length; ) {
    if (ops[k].kind === "same") {
      k++;
      continue;
    }
    const dels: string[] = [];
    const addsRun: string[] = [];
    while (k < ops.length && ops[k].kind !== "same") (ops[k].kind === "del" ? dels : addsRun).push(ops[k++].line);
    const used = new Set<number>();
    for (const d of dels) {
      let best = -1;
      let score = 0.34;
      addsRun.forEach((ad, i) => {
        const s = alike(d, ad);
        if (!used.has(i) && s >= score) [best, score] = [i, s];
      });
      if (best < 0) {
        out.push(`Removed: ${q(d)}`);
        continue;
      }
      used.add(best);
      const v = valueChange(d, addsRun[best]);
      out.push(`Changed: ${q(d)} -> ${q(addsRun[best])}${v ? ` (${v})` : ""}`);
    }
    addsRun.forEach((ad, i) => !used.has(i) && out.push(`Added: ${q(ad)}`));
  }

  let block = "";
  for (let i = 0; i < out.length; i++) {
    const more = `... and ${out.length - i} more changes`;
    if (block.length + out[i].length + 1 > MAX_DIFF_CHARS - more.length - 1) return `${block}${more}`;
    block += `${out[i]}\n`;
  }
  return block.trimEnd();
}

/** Source text with the change block on top, so feeds, search, and MCP show what changed. */
export function withChanges(page: string, diff: string | null, since: string): string {
  return diff ? `${HEADER}${since}):\n${diff}${PAGE_MARK}${page}` : page;
}

/** The page text of a stored source, without its change block. */
export function pageOf(stored: string): string {
  if (!stored.startsWith(HEADER)) return stored;
  const at = stored.indexOf(PAGE_MARK);
  return at < 0 ? "" : stored.slice(at + PAGE_MARK.length);
}
