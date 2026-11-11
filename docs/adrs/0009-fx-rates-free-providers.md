# ADR-0009: Daily FX rates from free providers with fallback, display-only conversion

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
Results span KES, USD, and ZAR (e.g. amazon.com results for Kenyan users). The product owner wants a free FX service and doesn't mind which. ECB-based services such as Frankfurter don't publish KES.

## Decision
A daily `RefreshFxRatesWorkflow` fetches USD-based rates from **ExchangeRate-API open access** (`open.er-api.com`, no key, attribution required) and falls back to **fawazahmed0 currency-api** (jsDelivr + Cloudflare mirror). Rates are stored in `fx_rates`. Conversions are display-only, apart from `max_price` filtering with a 3% tolerance. Stored prices are never converted.

## Consequences
- No cost and no key. Both providers were confirmed to return KES and ZAR on 2026-11-11.
- Rates are daily, so they're approximate. The UI shows "≈", the date, and attribution, and hides conversions older than 72 h.
- Provider names are config (`FX_RATES_PROVIDER`, `FX_RATES_FALLBACK_PROVIDER`), so we can swap to a paid source later.

## Alternatives considered
- **Frankfurter/ECB**: no KES.
- **Paid FX APIs**: unnecessary at this accuracy level.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → FX rates, FR-11b
