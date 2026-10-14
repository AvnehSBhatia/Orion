// Citations: every document the model sees gets a handle (S1, S2, ...); cited handles become [1], [2] in the reply.
import type { Source } from "@/contract/types";
import { clamp } from "@/lib/text";

const EXCERPT_CHARS = 300;
const MAX_CITATIONS = 3;

/** Gives every document the model sees a short stable handle (S1, S2, ...) for citations. */
export class Handles {
  private byId = new Map<string, string>();
  readonly sources = new Map<string, Source>();

  add(s: Source): string {
    let h = this.byId.get(s.id);
    if (!h) {
      h = `S${this.byId.size + 1}`;
      this.byId.set(s.id, h);
      this.sources.set(h, s);
    }
    return h;
  }

  /** The compact form of a document the model reads, under its handle. */
  brief(s: Source & { why?: string }) {
    return {
      handle: this.add(s),
      title: s.title,
      author: s.authorName,
      createdAt: s.createdAt,
      why: s.why,
      excerpt: clamp(s.excerpt ?? "", EXCERPT_CHARS),
      changes: s.changes.slice(0, 4).map((c) => `${c.label}: ${c.change}${c.statusFrom && c.statusFrom !== c.statusTo ? `, ${c.statusFrom} to ${c.statusTo}` : ""}`),
    };
  }

  /** Renumbers cited handles in order of first use: [S4] then [S2] become [1] and [2]. */
  cite(reply: string): { reply: string; sources: Source[] } {
    const order: string[] = [];
    const text = reply.replace(/(\s*)\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_m, space: string, list: string) => {
      const nums = list.split(/\s*,\s*/).flatMap((h) => {
        if (!this.sources.has(h)) return [];
        if (!order.includes(h)) order.push(h);
        return [order.indexOf(h) + 1];
      });
      return nums.length ? `${space}[${nums.join(", ")}]` : "";
    });
    // Models sometimes cite node ids instead of handles; drop any other bracketed tag.
    // Item ids and labels too, even with spaces, like [general-release] or [launch announcement].
    return { reply: text.replace(/\s*\[(?!\d)[^[\]\n]{1,60}\]/g, ""), sources: order.map((h) => this.sources.get(h)!) };
  }
}

/** At most 3 cited sources: citations past the third distinct source are dropped. */
export function capCitations(reply: string, cited: Source[], max = MAX_CITATIONS): { reply: string; sources: Source[] } {
  const sources = cited.slice(0, max);
  const text = reply.replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, list: string) => {
    const keep = list.split(/\s*,\s*/).filter((n) => Number(n) <= sources.length);
    return keep.length ? ` [${keep.join(", ")}]` : "";
  });
  return { reply: text, sources };
}

/** Drops the citation chips' numbers from an earlier answer, so they are not mistaken for this turn's handles. */
export const uncite = (text: string) => text.replace(/\s*\[\s*S?\d+(?:\s*,\s*S?\d+)*\s*\]/g, "").trim();
