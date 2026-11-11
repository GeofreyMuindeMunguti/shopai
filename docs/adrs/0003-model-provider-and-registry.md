# ADR-0003: Model access via a `ModelProvider` abstraction and an admin-managed model registry

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The LLM runs on AWS Bedrock, and the endpoint must come from an environment variable supplied at boot. Admins must control which models users can pick. Users choose a model per wishlist, with a default set during onboarding. Admins also assign cheaper models to background tasks. A later phase adds Bring Your Own Model (BYOM) across many providers (own Bedrock, Anthropic, OpenAI, Gemini, Azure OpenAI, OpenAI-compatible).

## Decision
- `BEDROCK_ENDPOINT_URL` + `AWS_REGION` come from env. **Model IDs do not.** They live in the `llm_models` table, managed in the admin portal.
- All LLM calls go through a `ModelProvider` interface (`converse(messages, tools, model_ref)`). `BedrockProvider` is the only implementation at launch, and `llm_models.provider` selects the implementation.
- **Model resolution** at run start, snapshotted into `scout_runs`:
  - **Main loop:** wishlist model → user default → admin default. The first enabled one wins.
  - **Background tasks:** mapped through `llm_task_models`.
  - **BYOM wishlists:** use the user's model for every task.
- New models must pass a test invocation that includes a tool-use round trip before they can be enabled.

## Consequences
- Admins can add, swap, or retire models without a redeploy. IAM must still allow any model admins enable, and the test invocation catches gaps.
- BYOM needs new provider classes and a widened `provider` check constraint. Workflows and the schema stay as they are.
- Each provider has to normalise to one internal message/tool format, and we keep conformance tests per provider.
- Runs stay reproducible, because the resolved model refs are recorded per run and per task.

## Alternatives considered
- **Model ID in env**: rejected because every change needs a redeploy and users can't choose.
- **Calling `boto3` directly in workflows/activities**: rejected because it locks us into Bedrock and blocks BYOM.
- **A third-party gateway (e.g. LiteLLM)**: could be a later `ModelProvider` implementation, but it adds a dependency and service we don't need at launch.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Agent Design, Background-task models, Configuration, Deferred: BYOM
