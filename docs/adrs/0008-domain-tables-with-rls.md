# ADR-0008: Dedicated domain tables with per-user RLS. Reuse the analytics foundation for price history and events.

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The template provides a generic SCD2 entity model (`entities`, `entity_versions`, `relationships_v2`) and an analytics foundation (`fact_types`, `entity_facts`, `time_series_points`). Wishlist data is user-owned, changes often, is queried by user, and must be isolated with RLS. `AGENTS.md` requires new domain tables in new migration files.

## Decision
We create dedicated tables in a new migration (`wishlists`, `wishlist_items`, `scout_runs`, `product_matches`, `merchant_accounts`, `user_profiles`, `llm_models`, `llm_task_models`, `retailers`, `shopify_stores`, `fx_rates`, `workflow_jobs`). Each has a UUID PK, `created_at`/`updated_at`, and RLS: `user_id = auth.uid()` for user tables, `is_admin()` for admin tables. Price observations go into `time_series_points`, and audit events go through the existing `append_event` activity pattern.

## Consequences
- Simple RLS policies and indexes, and readable queries for the frontend's PostgREST access.
- No SCD2 history on item specs by default. We can mirror into `entity_versions` later if needed.
- `user_id` is denormalised onto child tables so RLS doesn't need joins.
- State-machine rules (item/match status) are enforced in one place, the decision endpoint plus DB check constraints, not scattered across clients.

## Alternatives considered
- **Model everything as `entities` + `entity_versions.data` jsonb**: generic, but RLS on jsonb ownership is awkward, typing is weak, and queries are slow.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Database Schema
- Existing foundation: `supabase/migrations/20251202090000_core_entity_model.sql`, `supabase/migrations/20251203090000_analytics_foundation.sql`
