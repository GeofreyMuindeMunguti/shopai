/**
 * Display-only currency conversion (ADR-0009). Rates in `fx_latest` are
 * USD-based; cross rates go through USD. Rates older than 72 h are ignored.
 */
import type { FxLatest } from '@/data/types';

export const FX_MAX_AGE_HOURS = 72;
export const FX_ATTRIBUTION = 'Rates by ExchangeRate-API';

export interface FxTable {
  /** quote currency → units per 1 USD */
  rates: Record<string, number>;
  /** oldest as_of across the rates used */
  asOf: Record<string, string>;
}

export function buildFxTable(rows: FxLatest[] | undefined, now: number = Date.now()): FxTable {
  const table: FxTable = { rates: { USD: 1 }, asOf: {} };
  for (const row of rows ?? []) {
    if (row.base_currency !== 'USD') continue;
    const ageHours = (now - new Date(`${row.as_of}T00:00:00Z`).getTime()) / 3_600_000;
    // as_of is a date, so allow the remainder of that day before counting age.
    if (ageHours - 24 > FX_MAX_AGE_HOURS) continue;
    table.rates[row.quote_currency.toUpperCase()] = Number(row.rate);
    table.asOf[row.quote_currency.toUpperCase()] = row.as_of;
  }
  return table;
}

export interface Conversion {
  amount: number;
  asOf: string | null;
}

export function convert(amount: number, from: string, to: string, fx: FxTable): Conversion | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return { amount, asOf: null };
  const fromRate = fx.rates[f];
  const toRate = fx.rates[t];
  if (!fromRate || !toRate) return null;
  const dates = [fx.asOf[f], fx.asOf[t]].filter(Boolean).sort();
  return { amount: (amount / fromRate) * toRate, asOf: dates[0] ?? null };
}
