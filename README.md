# App running locally







# Scout: AI shopping wishlist

Users sign in with Google, describe what they want to buy, and an LLM agent on AWS Bedrock searches the retailers they picked (Takealot, Amazon, Temu, Jumia and independent Shopify stores) across Kenya, the United States and South Africa. Verified candidates appear on the wishlist for the user to approve, reject or save, and items can be re-scouted daily or weekly.

- Spec: [`docs/specs/ai-shopping-wishlist.md`](docs/specs/ai-shopping-wishlist.md)
- Decisions: [`docs/adrs/`](docs/adrs/)
- Database: [`docs/DATABASE.md`](docs/DATABASE.md)
- User guide: [`docs/user-guide/README.md`](docs/user-guide/README.md)

## How it fits together
```
Browser (Vite/React)  ──supabase-js + RLS──▶  Supabase Postgres  ◀──service role──  Temporal worker (Python)
   ▲  Realtime                               request_scout() writes               JobDispatcher claims workflow_jobs,
   └──────────── product_matches, scout_runs  scout_runs + workflow_jobs          starts ScoutItemWorkflow → one
                                              in one transaction (outbox)         ScoutRetailerWorkflow per retailer
                                                                                  → Bedrock Converse tool loop,
                                                                                    web search, verified fetches
```
- `supabase/`: migrations (domain tables, RLS, RPCs), seed, config, contract test.
- `temporal/`: worker. `llm/` (ModelProvider + Bedrock), `retail/` (adapters, extraction, SSRF-safe fetcher, Shopify discovery), `scout/` (prompts, tools, ranking, verification), `fx/`, `workflows/`, `dispatcher.py`, `schedules.py`.
- `renderer/`: Playwright sidecar for JavaScript-heavy retailers (Temu).
- `frontend/`: shopper app, onboarding, settings and the `/admin` portal (shadcn/ui, TanStack Router/Query, JSON UI engine).

## Prerequisites
- Docker Desktop with Compose v2, `make`, and the **Supabase CLI**
- Node 20+ is optional (the frontend runs in Docker)

## Configuration
`cp .env.example .env`, then fill in:

| Variable | Needed for |
|----------|------------|
| `BEDROCK_ENDPOINT_URL`, `AWS_REGION` | **Required.** The worker exits at startup without them. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN`) | Bedrock calls. IAM needs `bedrock:InvokeModel` / `bedrock:Converse` on the models you enable. |
| `BEDROCK_BOOTSTRAP_MODEL_ID` | Optional. Creates the first enabled + default model on a fresh install. |
| `TAVILY_API_KEY` | Web search (free plan at https://app.tavily.com). Without it, searches fail but everything else runs. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google sign-in. Web OAuth client with redirect URI `http://localhost:54321/auth/v1/callback`. `make up` loads `.env` before `supabase start`, which reads them. |
| `AMAZON_API_*` | Optional Amazon product API. Without it, Amazon uses search + page fetch. |
| `VITE_ENABLE_DEV_LOGIN` | Dev only: shows an email/password form so you can test without Google. Never enable it where real users sign in. |

Never commit `.env`.

## Run it
```
make up                      # supabase start (migrations + seed), then Temporal, worker, renderer, frontend
USE_DEV=1 make up            # same, with live reload
```
- App: http://localhost:3000 · Temporal UI: http://localhost:8080 · Supabase API: http://localhost:54321

First admin (there is no UI path to grant admin): sign in once, then
```
make make-admin EMAIL=you@example.com     # then sign out and back in
```
In `/admin`: add or enable models (each one must pass its automatic test invocation), pick the default, map background-task models, and review retailers, Shopify stores, limits, usage, jobs and the audit log.

Other commands: `make down`, `make reset`, `make logs`, `make logs-temporal`, `make supabase-status`, `make db-reset`.

## Tests
```
make db-test     # resets the local DB, then runs the PostgREST contract test (RLS, outbox, state machines, admin)
docker run --rm -v "$PWD/temporal":/app -w /app python:3.11-slim \
  sh -c "pip install -q -e '.[dev]' && pytest -q"                     # worker unit + workflow tests
docker run --rm -v "$PWD/frontend":/app -w /app node:20 \
  sh -c "npm ci && npx tsc --noEmit && npm run build"                  # frontend type-check + build
python3 scripts/audit/run_audits.py                                    # architecture audits
```

## Not built yet
Deferred by the spec: external-site automation (Phase 5), Bring Your Own Model (Phase 5b; the `ModelProvider` interface, `llm_models` BYOM columns and the "My models" selector group are in place), and the hosting decision. Also open: image input (FR-14), affiliate links (FR-16), the golden-set eval, and email notifications (in-app only for now).
