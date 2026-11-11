# ADR-0002: Start workflows through a queued-jobs table (transactional outbox)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The frontend (browser) needs to start scout runs, admins need to run model tests, and later phases add re-scouts, BYOM model tests, and automation jobs. Temporal clients connect over gRPC, which neither the browser nor Supabase Edge Functions (Deno) can use reliably, and the browser must never talk to Temporal directly. The product owner chose robustness over minimal latency. Requests must not be lost if the worker or Temporal is down, and we want no new public-facing service.

## Decision
Clients never start workflows directly. A request is a row in `workflow_jobs`, written **in the same transaction** as its domain row (e.g. `scout_runs`). A dispatcher inside the Temporal worker claims queued jobs and starts the matching workflow.

**How a request is written:**
- Clients call Postgres RPC functions (`request_scout`, `request_model_test`, …) through PostgREST.
- Each RPC is `security definer`. It checks ownership or `is_admin()`, the active-run rule, and the daily caps, then inserts the domain row and the job together.
- Validation errors come back to the caller immediately as Postgres errors with stable codes:

  | Code | Meaning |
  |---|---|
  | `WL409` | A run is already active |
  | `WL429` | Daily cap reached |
  | `WL403` | Not allowed |

**How the dispatcher works:**
- It's a loop in the worker process that calls the `claim_workflow_jobs(limit)` RPC every `JOB_POLL_INTERVAL_SECONDS` (default 2 s). Only the service role can call it.
- The claim uses `FOR UPDATE SKIP LOCKED` and moves rows `queued → dispatching`.
- For each claimed row it calls `start_workflow(id=f"job-{job_id}")` and marks it `dispatched`. `WorkflowAlreadyStartedError` counts as success, so dispatch is idempotent.
- When a start fails, the job goes back to `queued`, with `attempts + 1` and an exponential `available_at` backoff. After `max_attempts` (default 5), it becomes `failed`, and the domain row is marked failed.
- A job stuck in `dispatching` longer than 60 s (dispatcher crashed mid-claim) is reclaimed.

**After dispatch:** the workflow owns the lifecycle. It updates the domain row (`scout_runs.status`, etc.), and the frontend watches those rows over Supabase Realtime.

## Consequences
- **No lost requests**: if the worker or Temporal is down, jobs wait in Postgres and are dispatched on recovery. The request and its domain row can never disagree.
- **No new public service**: the attack surface stays PostgREST + RLS. AWS and search credentials stay in the worker only.
- **Validation is still synchronous** (409/429-style errors), because the RPC rejects the request inside the insert transaction.
- **Latency**: up to one poll interval (about 2 s) before a run starts. We can add Supabase Realtime or `LISTEN/NOTIFY` later to wake the dispatcher early, with polling kept as a safety net.
- **Scales out**: several worker replicas can dispatch safely because of `SKIP LOCKED`.
- **New obligations**:
  - Keep the RPCs as the only write path (no direct client `insert` on `workflow_jobs`).
  - Prune completed jobs (e.g. after 30 days).
  - Alert on `queued` jobs older than 5 minutes.
- **Admin model tests become asynchronous**: the UI shows "Testing…" until `llm_models.last_test_ok` updates over Realtime.

## Alternatives considered
- **HTTP workflow gateway (FastAPI) next to the worker**: lower latency, but it's an extra public service, JWT verification lives in a second place, and requests are lost while the gateway or Temporal is down unless we add our own retries. Rejected in favour of robustness.
- **Temporal TypeScript client in Edge Functions**: gRPC support in Deno is unreliable, and it would need Temporal credentials at the edge.
- **Supabase DB webhooks (`pg_net`) calling the worker**: delivery is best-effort, and it still needs an HTTP endpoint on the worker.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Architecture ("Starting workflows"), API Endpoints, Database Schema (`workflow_jobs`)
- Supersedes the earlier, never-accepted draft `0002-workflow-gateway.md` (removed before acceptance).
