# ADR-0007: Google-only sign-in, admin role in `app_metadata`, and no retailer secrets

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Product owner; drafted by Claude Code
- **Supersedes / Superseded by:** —

## Context
The product owner chose OAuth via Google. Users want to "link" their retailer accounts so we can automate purchases later. A Google token authenticates users to *us*. It gives no access to Takealot, Amazon, Temu, or Jumia accounts, even when a user signs in to those sites with Google. The scouting agent also reads untrusted web content (prompt-injection risk).

## Decision
- **Sign-in**: Supabase Auth with Google as the only provider, scopes `openid email profile`. No Gmail API scopes.
- **Admin**: the `role: admin` claim in `app_metadata`, which users can't change themselves. It's checked by `is_admin()` in RLS and in admin RPC functions. Admin is granted only through SQL/CLI.
- **Linked accounts** in this phase are metadata only (retailer, account email, login method). **No retailer passwords, tokens, or cookies are stored.**
- **Agent isolation**: the scouting agent has no tools with side effects other than `submit_candidate`, and it never sees credentials or other users' data. The future automation agent runs in a separate worker/task queue with its own IAM role.

## Consequences
- The smallest possible secret-handling surface at launch. Google's verification for non-sensitive scopes is light.
- Users who expect "Sign in with Google" to give us retailer access need clear onboarding copy.
- Phase 5 automation must design its own retailer access (APIs, user-attended sessions) and choose a secret store, together with hosting.
- BYOM API keys (Phase 5b) are the first secrets we store. They go through a `SecretStore` interface whose backend is chosen during the hosting discussion.

## Alternatives considered
- **Collect retailer passwords now (encrypted)**: high risk, with no use until Phase 5. Rejected.
- **Email/password or magic-link sign-in as well**: more support and abuse surface. Not requested.
- **Gmail API access for OTPs and order emails**: a restricted scope that needs Google's security assessment. Deferred to the Phase 5 discussion.

## Evidence
- Spec: `docs/specs/ai-shopping-wishlist.md` → Linked accounts, Security Considerations, Deferred: External Site Automation
