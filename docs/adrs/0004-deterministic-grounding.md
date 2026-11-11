# ADR-0004: Prices, URLs, and availability come from deterministic extraction, never the LLM

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
LLMs invent plausible URLs, prices, and stock status. Users will act on these values, and later the automation phase will buy based on them. Fetched web pages are also untrusted and can contain prompt injections.

## Decision
The LLM only **proposes** candidates (URL + match score + rationale). A deterministic `verify_candidate` activity then re-fetches the page and takes the title, price, currency, availability, and identifiers (GTIN/MPN) from structured data: a retailer API, schema.org `Product`/`Offer` JSON-LD, or OpenGraph. Only verified values are stored in `product_matches` and shown to users. Candidates that fail verification are stored as `unverified` and hidden.

## Consequences
- Users never see a hallucinated price or a dead link, and the accuracy metric (< 2% mismatch) can be measured.
- Retailers without structured data give lower coverage, which is why we have the headless-render fallback and API adapters.
- The `attribute_extraction` background task can fill **non-price** attributes only.
- This works with ADR-0007's isolation rules to limit prompt-injection impact: the agent's text can't change displayed facts.

## Alternatives considered
- **Trust the LLM's extracted fields**: fastest, but unacceptable error rates.
- **LLM extraction with a confidence threshold**: still unverifiable, so rejected for price/URL/availability.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → FR-6, Agent Design (Grounding)
