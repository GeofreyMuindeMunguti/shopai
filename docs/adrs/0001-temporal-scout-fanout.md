# ADR-0001: Scout runs are Temporal workflows that fan out per retailer

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
A scout run makes many slow, unreliable calls: LLM turns, web searches, and page fetches across 4–5 retailers, some of which actively block automation (Temu, sometimes Takealot). A run can take a minute or more, so it must survive worker restarts, retry transient failures, and keep partial results when one retailer fails. The template already ships a Temporal worker (`temporal/src/worker.py`).

## Decision
We run each scout as a `ScoutItemWorkflow` that starts one `ScoutRetailerWorkflow` child per selected retailer in parallel, then merges and ranks the results in a `merge_and_rank` activity. Every LLM call, search, fetch, verification, and DB write is a separate activity.

## Consequences
- A slow or blocked retailer can't stall or fail the run. The run ends as `partial` and records per-retailer status in `scout_runs.retailer_results`.
- Temporal history makes runs replayable and debuggable, and retries are declared as activity retry policies rather than hand-written loops.
- Cost grows with the number of retailers selected, so per-run budgets (`SCOUT_MAX_*`) are split across children.
- Workflow code must stay deterministic. All I/O, including time and randomness, goes through activities.
- LLM responses are stored in workflow history, so watch the history size limit. Keep tool outputs truncated.

## Alternatives considered
- **One workflow with all retailers in a single agent loop**: simpler, but one retailer's failure or slowness hurts the whole run, and there's no per-retailer progress.
- **Supabase Edge Function / queue + cron**: no durable state, retries, or visibility. Edge Function time limits are too short for agent loops.
- **Agent framework without an orchestrator (e.g. a long-running process)**: loses durability across restarts.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Architecture, Workflow fan-out
- Existing worker: `temporal/src/worker.py`
