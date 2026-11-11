# Admin portal

`/admin` is visible to users whose JWT `app_metadata.role` is `admin`. Grant it with `make make-admin EMAIL=…` (there is no UI path), then sign in again. Every admin change is recorded in **Audit log**.

| Page | What you can do |
|------|-----------------|
| **AI models** | Add Bedrock models by model or inference-profile ID. Saving runs a test (a Converse call plus a tool-use round trip) against `BEDROCK_ENDPOINT_URL`; a model can only be enabled after it passes. Exactly one enabled model is the default. Disabling a model notifies users who chose it, and their searches fall back to their default, then the platform default. |
| **Background tasks** | Send category inference, discovery queries, attribute extraction, preference summaries and re-ranking to a cheaper model, or leave them on "Use wishlist model". |
| **Retailers** | Enable or disable retailers and edit their domain per country (KE/US/ZA) and rate limits. |
| **Shopify stores** | Review stores the agent discovered, block bad ones (never used again), or mark trusted ones as `seed` (checked first). |
| **Limits & rollout** | Feature flag for new searches, beta allowlist, daily searches per user, and a manual FX refresh. |
| **Usage** | Runs, tokens and failures by model, retailer and background task. |
| **Jobs** | Recent `workflow_jobs` with status and errors. A job stuck in `queued` usually means the worker or Temporal is down; it is dispatched once they recover. |
