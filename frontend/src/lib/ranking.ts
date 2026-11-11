/**
 * Candidate ordering (spec FR-4 / user story "searched across several retailers"):
 *  - approved matches are pinned first;
 *  - then by server rank (asc, nulls last), match score (desc), price (asc, in the profile currency);
 *  - cross-retailer duplicates (duplicate_of set) are filtered out by the caller;
 *  - when the list is truncated, the best match from every retailer is still shown.
 */
import type { MatchStatus, ProductMatch } from '@/data/types';
import { convert, type FxTable } from './fx';

export const VISIBLE_STATUSES: MatchStatus[] = ['approved', 'proposed', 'saved', 'stale'];

function comparablePrice(m: ProductMatch, currency: string, fx: FxTable): number {
  if (m.price === null || m.price === undefined) return Number.POSITIVE_INFINITY;
  if (!m.currency) return Number(m.price);
  return convert(Number(m.price), m.currency, currency, fx)?.amount ?? Number(m.price);
}

export function compareMatches(a: ProductMatch, b: ProductMatch, currency: string, fx: FxTable): number {
  const pin = Number(b.status === 'approved') - Number(a.status === 'approved');
  if (pin !== 0) return pin;
  const stale = Number(a.status === 'stale') - Number(b.status === 'stale');
  if (stale !== 0) return stale;
  // Server-side rank from merge_and_rank wins; client ordering is the fallback while a run is in progress.
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  const score = Number(b.match_score ?? 0) - Number(a.match_score ?? 0);
  if (Math.abs(score) > 1e-9) return score;
  return comparablePrice(a, currency, fx) - comparablePrice(b, currency, fx);
}

export function rankMatches(
  matches: ProductMatch[],
  opts: { currency: string; fx: FxTable; limit?: number }
): { shown: ProductMatch[]; hiddenCount: number } {
  const sorted = [...matches].sort((a, b) => compareMatches(a, b, opts.currency, opts.fx));
  if (!opts.limit || sorted.length <= opts.limit) return { shown: sorted, hiddenCount: 0 };

  const shown = sorted.slice(0, opts.limit);
  const shownRetailers = new Set(shown.map((m) => m.retailer_code));
  // Best-per-retailer guarantee: append each missing retailer's top match.
  for (const m of sorted.slice(opts.limit)) {
    if (!shownRetailers.has(m.retailer_code)) {
      shown.push(m);
      shownRetailers.add(m.retailer_code);
    }
  }
  shown.sort((a, b) => compareMatches(a, b, opts.currency, opts.fx));
  return { shown, hiddenCount: sorted.length - shown.length };
}
