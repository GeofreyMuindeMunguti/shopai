# ADR-0005: Web search through a provider registry, Tavily first

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The LLM can't browse. Every retailer without a public product API (Takealot, Jumia, Temu) and all Shopify store discovery depend on a web search API. The product owner wants a free option now and the ability to switch later. Options checked on 2026-11-11: Tavily (1,000 credits/month, no card), Brave ($5 credit/month, card required), SerpAPI (250/month), and self-hosted SearXNG (free, but CAPTCHA-blocked under load).

## Decision
We define a `SearchProvider` interface with shared error kinds (`auth`, `bad_request`, `quota`, `rate_limited`, `unavailable`) and select the implementation by name with `SEARCH_PROVIDER`. An optional `SEARCH_FALLBACK_PROVIDER` is tried on any failure except a bad request. **Tavily is the launch provider** (free Researcher plan). Searches run as the `web_search` Temporal activity: rate limits and outages are retried, while auth, quota, and bad-request errors fail immediately.

## Consequences
- Switching provider means changing an env var. Adding one means writing one module, adding its settings, and adding one registry entry, with no workflow changes.
- The free tier (about 1,000 searches/month ≈ 65–100 scout runs) is enough for development only. Revisit before beta.
- The worker boots even without `TAVILY_API_KEY` (it logs a warning), so the rest of the stack keeps working. `web_search` fails non-retryably until the key is set.
- Tavily-specific details (country names, `include_domains` for site scoping) stay inside the adapter.

## Alternatives considered
- **Brave**: good country support, but needs a card. Its terms also restrict storing results.
- **SerpAPI**: best for Google Shopping results, but the smallest free tier and expensive after that. A candidate future provider.
- **SearXNG**: free with no limit, but unreliable under load. A candidate fallback provider later.

## Evidence
- `temporal/src/search/` (`base.py`, `tavily.py`, `registry.py`)
- `temporal/src/activities/search.py`, registered in `temporal/src/worker.py`
- Settings: `temporal/src/config.py`. Env: `.env.example`, `docker-compose.yml`
- Tests: `temporal/tests/test_search.py`
