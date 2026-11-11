# ADR-0006: One adapter per retailer behind a common interface, with an agent-driven Shopify store discovery

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The launch retailers need very different access methods:

| Retailer | Markets | Access |
|---|---|---|
| Amazon | US, KE (via amazon.com), ZA | Official product API |
| Takealot | ZA | Plain pages |
| Jumia | KE | Plain pages |
| Temu | US only | JavaScript-heavy, anti-bot |
| Shopify | All markets | Thousands of independent stores, not a single site |

Users pick which retailers to search, and admins enable retailers per country.

## Decision
- Each retailer implements `search(query, country)`, `fetch_product(url)`, and `canonicalize_url(url)`. Availability and domains are stored per country in `retailers.country_domains`.
- Web search (ADR-0005) is the shared discovery fallback. Amazon uses its official API when credentials are configured.
- Shopify uses an agent-driven `discover_stores` tool. The LLM proposes queries, and deterministic checks then confirm each store: it's a Shopify storefront, ships to the user's country, and passes the quality gate. Approved stores are cached in `shopify_stores` and reused across users. Admins can mark stores `seed` or `blocked`.
- A Playwright headless-renderer sidecar (`HEADLESS_RENDERER_URL`) is used only when a plain fetch returns no structured data.

## Consequences
- Adding a retailer means writing an adapter and adding a `retailers` row, with no workflow changes.
- Coverage varies by retailer, and the UI shows per-retailer status.
- The headless renderer is an extra container with significant CPU/memory. Rate limits are per retailer.
- Scraping-based adapters need a terms-of-service review per retailer before public launch.

## Alternatives considered
- **Generic search + fetch for everything**: weak on Amazon and Temu, with no Shopify store discovery.
- **Curated Shopify stores only**: rejected by the product owner because coverage is too narrow.
- **Third-party product data aggregators**: cost, and poor coverage of KE/ZA retailers.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Launch markets, Retailer coverage, Store discovery
