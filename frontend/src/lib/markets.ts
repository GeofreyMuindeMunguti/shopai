import type { CountryCode, CurrencyCode } from '@/data/types';

export const COUNTRIES: { code: CountryCode; name: string; currency: CurrencyCode }[] = [
  { code: 'KE', name: 'Kenya', currency: 'KES' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR' },
];

export const CURRENCIES: { code: CurrencyCode; name: string }[] = [
  { code: 'KES', name: 'Kenyan shilling (KSh)' },
  { code: 'USD', name: 'US dollar (US$)' },
  { code: 'ZAR', name: 'South African rand (R)' },
];

export function countryName(code: string | null | undefined): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code ?? '';
}

/** Best guess at the user's market from the browser locale (e.g. "en-KE"). */
export function guessCountry(): CountryCode {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const lang of langs) {
    const region = lang.split('-')[1]?.toUpperCase();
    const match = COUNTRIES.find((c) => c.code === region);
    if (match) return match.code;
  }
  return 'US';
}

export function defaultCurrency(country: CountryCode | null | undefined): CurrencyCode {
  return COUNTRIES.find((c) => c.code === country)?.currency ?? 'USD';
}

/** Retailer codes that serve a country, from `retailers.country_domains`. */
export function retailersForCountry<T extends { code: string; is_enabled: boolean; country_domains: Record<string, string> }>(
  retailers: T[],
  country: string | null | undefined
): T[] {
  if (!country) return retailers.filter((r) => r.is_enabled);
  return retailers.filter((r) => r.is_enabled && country in (r.country_domains ?? {}));
}

export const TASK_LABELS: Record<string, string> = {
  category_inference: 'Category inference',
  discovery_queries: 'Discovery queries',
  attribute_extraction: 'Attribute extraction',
  preference_summary: 'Preference summary',
  cross_retailer_rerank: 'Cross-retailer rerank',
};
