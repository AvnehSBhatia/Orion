// Feature cards: short, plain-language descriptions of a user-visible change,
// written by the coding agent into .ctx-cards.json and sent with the sync.
// The backend treats them as the author's own summary of the change.

import { normalizePath, type PathFilter } from './privacy.ts';

export type CardStatus = 'shipped' | 'in_beta' | 'in_progress';

export type FeatureCard = {
  label: string;
  summary: string;
  status: CardStatus;
  paths: string[];
};

const STATUSES: CardStatus[] = ['shipped', 'in_beta', 'in_progress'];
const LABEL_MAX = 40;
const SUMMARY_MAX = 140;

export type CardResult = {
  cards: FeatureCard[];
  dropped: { index: number; reason: string }[];
};

// Collapses whitespace, swaps em dashes for commas (cards are read by sales, so
// they follow the plain-writing rules), and cuts to the backend's limit.
function clip(s: string, max: number): string {
  const t = s.replace(/\u2014/g, ', ').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '.';
}

// Accepts either an array of cards or { cards: [...] }. Invalid cards are
// reported in `dropped` rather than thrown, so one bad card does not block a
// sync. A card that names a private path is dropped whole, because its summary
// may describe private work.
export function parseCards(raw: unknown, filter: PathFilter): CardResult {
  const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown })?.cards;
  const result: CardResult = { cards: [], dropped: [] };
  if (!Array.isArray(list)) {
    result.dropped.push({ index: -1, reason: 'file is not an array of cards' });
    return result;
  }

  list.forEach((c: any, index) => {
    const drop = (reason: string) => result.dropped.push({ index, reason });
    if (!c || typeof c !== 'object') return drop('not an object');
    if (typeof c.label !== 'string' || !c.label.trim()) return drop('label missing');
    if (typeof c.summary !== 'string' || !c.summary.trim()) return drop('summary missing');
    if (!STATUSES.includes(c.status)) return drop(`status must be one of ${STATUSES.join(', ')}`);

    const paths: string[] = Array.isArray(c.paths)
      ? c.paths.filter((p: unknown): p is string => typeof p === 'string').map(normalizePath)
      : [];
    if (paths.some((p) => filter.isPrivate(p))) return drop('touches an agent private path');

    result.cards.push({
      label: clip(c.label, LABEL_MAX),
      summary: clip(c.summary, SUMMARY_MAX),
      status: c.status as CardStatus,
      paths,
    });
  });

  return result;
}
