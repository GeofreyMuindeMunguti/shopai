# Feature Specification: AI-Powered Shopping Wishlist

## Overview
Users sign in with Google and build a wishlist of items they want to buy. An LLM agent running on AWS Bedrock searches the retailers each user picks (launch set: **Takealot, Amazon, Temu (US only), Jumia, and Shopify-powered stores**), and the best candidates from each retailer are listed on the user's profile for them to review and approve. We launch in **Kenya, the United States, and South Africa**. For Shopify, the agent finds relevant independent stores by product type, country, and other filters. An admin portal controls which Bedrock models are available. Users set a default model during onboarding and can pick a model for each wishlist. A later phase adds **Bring Your Own Model (BYOM)**. Users can also link their accounts on external shopping sites; a later phase of this spec will define how approved matches are added to external wishlists or purchased automatically.

## Metadata
- **Feature Name**: AI Shopping Wishlist ("Scout")
- **Status**: Draft
- **Priority**: P1 - High
- **Target Release**: TBD
- **Owner**: TBD
- **Stakeholders**: TBD
- **Epic/Initiative**: TBD
- **Created**: 2026-11-11
- **Last Updated**: 2026-11-11

## Problem Statement

### User Problem
Finding the right product means searching several retailers, comparing near-identical listings, and checking back later for price drops or restocks. People keep wishlists in notes apps, screenshots, or per-retailer wishlists that don't talk to each other.

### Business Problem
A single cross-retailer wishlist that does the searching for the user is a sticky, high-intent product. It also sets up later monetisation through affiliate links and assisted checkout.

### Current State
Users search each retailer by hand, compare tabs, and keep a separate wishlist per site.

### Desired State
The user describes what they want once (free text, an optional link or image, a budget, constraints). The system comes back with ranked, verified product matches from multiple retailers. The user approves or rejects them, and the system keeps watching for better options.

## Goals and Non-Goals

### Goals
- Let users create and manage wishlists and wishlist items with structured constraints (budget, brand, size, colour, condition, region).
- Run an LLM agent on AWS Bedrock that searches **every retailer the user selected, in parallel** (Takealot, Amazon, Temu, Jumia, Shopify stores) and returns multiple verified candidates per item, presented side by side for comparison.
- Show candidates on the user's profile with price, retailer, link, image, and the agent's reason for the match, and let the user approve, reject, or ask for a re-scout.
- Re-scout on a schedule so users see new or cheaper matches over time.
- Let users sign in with **Google OAuth** and link their shopping-site accounts by identity (account email), ready for the automation phase. No retailer passwords are stored.
- Read the Bedrock **endpoint** from an environment variable at boot. Manage the **models** in an admin portal: admins curate the allowed models, users set a default during onboarding, and users choose a model **per wishlist** when creating it.
- Run an onboarding flow where the user chooses country/currency, retailers, and default AI model.
- Launch in **Kenya (KES), the United States (USD), and South Africa (ZAR)**, with retailer availability set per country.
- Let the agent **discover Shopify stores** by product category, the user's country (ships-to), currency, price range, and other item constraints. Discovered stores are cached and reused across users.
- Keep the model layer provider-agnostic so BYOM (all setups: own Bedrock, major hosted APIs, OpenAI-compatible/self-hosted) can be added later without changing the schema or workflows.
- Let admins assign models to **background tasks** (category inference, discovery queries, and similar) separately from the user-facing wishlist model. BYOM wishlists are the exception: they use the user's own model for everything.

### Non-Goals (this phase)
- Automated checkout or adding to external wishlists. Deferred to Phase 5 (see [Deferred: External Site Automation](#deferred-external-site-automation)). We record linked accounts now but don't act on them yet.
- Storing retailer passwords or other retailer secrets.
- Bring Your Own Model. This phase only designs for it (see [Deferred: Bring Your Own Model](#deferred-bring-your-own-model-byom)).
- Countries other than KE, US, and ZA.
- Choosing a hosting/deployment target. That decision comes after the application is built (see [Deferred: Hosting](#deferred-hosting)).
- Payment processing inside this application.
- Price-comparison SEO pages, public or shared wishlists, and social features.
- Training or fine-tuning models.

### Success Metrics
- **Match precision**: ≥ 70% of items have at least one candidate the user approves.
- **Coverage**: ≥ 85% of scout runs return ≥ 2 verified candidates.
- **Latency**: p90 time from item creation to first candidates shown < 90 s.
- **Accuracy**: < 2% of shown candidates have a broken link or a price that differs by more than 5% from the live page at verification time.
- **Cost**: average Bedrock + search spend per scout run below a budget we set during beta.

## User Stories

### Primary User Stories
```
As a shopper,
I want to add an item to my wishlist by describing it (and optionally a link, image, or budget),
So that I don't have to search every retailer myself.
```
**Acceptance Criteria:**
- [ ] Item can be created with a title only. Description, reference URL, image, max price, currency, and constraints are optional.
- [ ] Saving an item starts a scout run automatically, and the item shows a "Scouting…" state.
- [ ] Item can be edited. Editing search-relevant fields offers a re-scout.

```
As a shopper,
I want to see several candidate products for each wishlist item,
So that I can compare options and pick the best one.
```
**Acceptance Criteria:**
- [ ] Each candidate shows title, retailer, price + currency, availability, image, product URL, match score, and a short "why this matches" explanation.
- [ ] Candidates are ranked by match score, then by price.
- [ ] Every candidate shown has been checked against the live product page (see FR-6).
- [ ] When fewer than 2 candidates are found, the UI says so and offers to loosen constraints.

```
As a shopper,
I want to approve or reject candidates,
So that the system learns what I want and I have a clear "chosen" product.
```
**Acceptance Criteria:**
- [ ] Each candidate can be approved, rejected (optional reason), or saved for later.
- [ ] Rejection reasons feed into the next scout run for that item.
- [ ] Approving a candidate moves the item to `approved`. Approving more than one is allowed (e.g. "either of these").
- [ ] Every decision is recorded with a timestamp and actor.

```
As a new user,
I want to sign in with my Google account and complete a short setup,
So that the app knows where I shop, which retailers to search, and which AI model to use.
```
**Acceptance Criteria:**
- [ ] Sign-in is Google OAuth only (Supabase Auth Google provider). Scopes are limited to `openid email profile`.
- [ ] First sign-in leads to onboarding: (1) country (Kenya, United States, or South Africa) + currency, (2) retailers to search (multi-select from admin-enabled retailers; defaults are all available in the user's country), (3) **default** AI model (from admin-enabled models, with the admin default pre-selected), (4) optional linked accounts.
- [ ] The user can't create wishlist items until onboarding is complete.
- [ ] All choices can be changed later in **Settings**.

```
As a shopper,
I want to choose which AI model a wishlist uses when I create it,
So that I can trade speed and cost against thoroughness for different kinds of shopping.
```
**Acceptance Criteria:**
- [ ] The **New wishlist** form has a model selector listing admin-enabled models with their descriptions. My default is pre-selected.
- [ ] Every scout run for items in that wishlist uses the wishlist's model.
- [ ] Changing a wishlist's model later affects future runs only. Past runs keep the model they ran with.
- [ ] If the wishlist's model is disabled by an admin, runs fall back to my default and then the admin default. The wishlist shows a "model unavailable, using X" notice.
- [ ] The selector is designed so that BYOM entries (any supported setup) can appear later under a "My models" group.

```
As a shopper,
I want each item searched across several retailers at once and the results shown together,
So that I can compare prices and options without visiting each site.
```
**Acceptance Criteria:**
- [ ] By default, an item searches the retailers in the user's profile. The user can override this per item.
- [ ] Results show a retailer badge and can be filtered or grouped by retailer.
- [ ] Where a retailer has a match, the best match from that retailer is always shown, even if other retailers score higher.
- [ ] Retailers that returned nothing, or failed, are listed ("No matches on Temu", "Jumia unavailable, retrying").
- [ ] When Shopify is selected, the agent finds stores relevant to the item (e.g. a Kenyan outdoor-gear store for "hiking boots" in KE) that ship to my country. Each match shows the store's domain and an "Independent store" badge.
- [ ] Prices in a currency other than my profile currency show the original price plus an approximate conversion (e.g. "US$129 ≈ KSh 16,700").

```
As a shopper,
I want to link my accounts on shopping sites,
So that the app can later add items to my external wishlists or buy them for me.
```
**Acceptance Criteria:**
- [ ] User can link one account per retailer by recording the account email. It defaults to their Google email, which covers retailers where they use "Sign in with Google".
- [ ] No retailer password, token, or other secret is collected in this phase.
- [ ] User can unlink an account at any time.
- [ ] No automated action uses linked accounts in this phase.

```
As an admin,
I want to manage which Bedrock models and retailers are available,
So that I control cost, quality, and what users can choose.
```
**Acceptance Criteria:**
- [ ] Admin portal (`/admin`, admin role only) lists models with display name, Bedrock model/inference-profile ID, enabled flag, default flag, max output tokens, and an optional cost note.
- [ ] Admin can add a model, and saving runs a test invocation against `BEDROCK_ENDPOINT_URL`. Models that fail the test can't be enabled.
- [ ] Exactly one enabled model is the default.
- [ ] If a model is disabled, users who selected it fall back to the default, and they are notified at their next login.
- [ ] Admin can enable or disable retailers per country, set their country domains, review discovered Shopify stores, block stores, and optionally pin trusted "seed" stores.
- [ ] Admin can assign a model to each **background task** (see [Background-task models](#background-task-models)). "Use wishlist model" is the default for each task.
- [ ] All admin changes are audit-logged.

### Secondary User Stories
- As a shopper, I want to be notified when a better or cheaper match appears, so that I don't miss a deal.
- As a shopper, I want to set how often an item is re-scouted (off / daily / weekly).
- As an admin, I want to see per-model usage and token spend, so that I can decide which models to keep enabled.

## Requirements

### Functional Requirements

#### Must Have (P0)
- **FR-0a Authentication**: Google OAuth through Supabase Auth is the only sign-in method. A `user_profiles` row is created on first sign-in.
- **FR-0b Onboarding**: Required flow to set country, currency, retailers, and model (see user story). `user_profiles.onboarding_completed_at` gates item creation.
- **FR-0c Admin portal**: `/admin` area, gated by the `admin` role in the user's JWT `app_metadata`, for managing `llm_models` and `retailers`. Every admin write goes through admin endpoints and is audit-logged.
- **FR-1 Wishlists**: CRUD for wishlists (name, description, default currency/region, **model**) and wishlist items. Each user can see only their own data.
- **FR-1b Model per wishlist**: `wishlists.model_id` is set at creation (pre-filled from `user_profiles.model_id`) and can be changed later. Resolution order: wishlist model → user default → admin default. The first one that is enabled wins.
- **FR-1d Background-task models**: Admins map each background task to a platform model in `llm_task_models`. For platform-model wishlists, a task uses its mapped model if one is set and enabled, and the wishlist model otherwise. For **BYOM wishlists, every LLM call (main loop and all background tasks) uses the user's model**, and admin task mappings are ignored.
- **FR-1c Markets**: Supported countries are KE, US, and ZA. Retailer availability and domains are configured per country in `retailers.country_domains`. Unsupported countries can't be selected during onboarding.
- **FR-2 Item spec**: Items store free-text intent plus structured constraints (`max_price`, `currency`, `brands[]`, `exclude_brands[]`, `condition` new/used/refurb, `attributes` jsonb such as size or colour, `ship_to_country`). `retailer_codes[]` is optional and defaults to the profile's retailers.
- **FR-3 Scout run**: Creating an item, or asking for a re-scout, starts a Temporal `ScoutItemWorkflow`, which runs one `ScoutRetailerWorkflow` child **per selected retailer, in parallel**. Each child drives a Bedrock tool-use loop (search → fetch → extract → score) scoped to its retailer and writes verified candidates to the DB. The run uses the wishlist's model, resolved as in FR-1b when the run starts.
- **FR-4 Multiple candidates**: Each retailer child aims for 1–3 candidates, and the parent merges them into a cross-retailer list. The parent dedupes by canonical URL / GTIN / MPN, keeps the best match per retailer, and ranks overall by match score, then price.
- **FR-5 Review flow**: User can approve, reject, or save each candidate. Item status follows the state machine below.
- **FR-6 Verification**: Before a candidate is stored as `proposed`, a deterministic (non-LLM) activity re-fetches the URL and confirms it resolves (HTTP 200 after redirects), that it is a product page, and that the price comes from structured data (schema.org `Product`/`Offer` JSON-LD, OpenGraph, or a retailer API). Candidates that fail are stored as `unverified` and hidden by default.
- **FR-7 Bedrock configuration**: The Bedrock runtime endpoint and region come from environment variables at boot, and the worker refuses to start if they are missing. Model IDs live in the admin-managed `llm_models` table, not in env (see [Configuration](#configuration)).
- **FR-7b Retailer adapters**: Each launch retailer has an adapter that implements a common interface (`search`, `fetch_product`, `canonicalize_url`). The strategy differs by retailer (see [Retailer coverage](#retailer-coverage)).
- **FR-7c Store discovery**: For Shopify, the agent has a `discover_stores` tool that finds candidate stores from the item's category, the user's country, currency, price range, and constraints. Stores must pass automated checks (see [Store discovery](#store-discovery)) before their products can be proposed.
- **FR-8 Linked accounts**: Users record retailer + account email + login method. No secrets are stored (see [Linked accounts](#linked-accounts)).
- **FR-9 Audit**: Every scout run, candidate decision, and credential change is logged as an event.

#### Should Have (P1)
- **FR-10 Scheduled re-scout**: Per-item Temporal Schedule (daily/weekly). New candidates and price drops create notifications.
- **FR-11 Price history**: Each verified observation of a candidate's price is recorded in `time_series_points` for price-drop detection and charts.
- **FR-11b Currency conversion**: Daily FX rates (KES/USD/ZAR plus whatever currencies candidates are priced in) from a free provider (ExchangeRate-API open access, with fawazahmed0 currency-api as fallback; see [FX rates](#fx-rates)), used to show approximate prices in the user's currency and to apply `max_price` across currencies. Stored prices are always the original amount and currency.
- **FR-12 Feedback loop**: Rejection reasons and approved candidates are added to the next run's prompt as preferences.
- **FR-13 Per-user limits**: Configurable cap on scout runs per day and on token spend per run.

#### Nice to Have (P2)
- **FR-14 Image input**: Item can be created from a photo or screenshot (multimodal Bedrock model).
- **FR-15 More retailers**: The adapter interface lets new retailers be added from the admin portal, as long as a matching adapter exists in code.
- **FR-16 Affiliate links**: Rewrite approved product URLs to affiliate links where the retailer allows it.

### Item & Candidate State Machines

```
wishlist_item.status
  draft ──▶ scouting ──▶ candidates_ready ──▶ approved ──▶ (Phase 5: queued_for_action ─▶ added_externally | purchased)
              ▲   │            │
              │   └──▶ no_matches
              └────────────────┘  (re-scout / constraints edited)
  any ──▶ archived

product_match.status
  unverified | proposed ──▶ approved | rejected | saved
  proposed ──▶ stale   (no longer available / price moved beyond tolerance on re-check)
```

### Non-Functional Requirements
- **Performance**: First candidates within 90 s at p90. Candidates are written to the DB as soon as each one is verified, so the UI fills in progressively over Supabase Realtime.
- **Security**: RLS on every user-owned table. Credentials are encrypted at rest with a key the database role can't read directly. The scouting agent never has access to credentials (see Security Considerations).
- **Reliability**: Scout runs are Temporal workflows. LLM calls, search calls, and fetches are separate activities with retries and timeouts, so a partial failure doesn't lose progress.
- **Cost control**: Hard caps on tool-loop iterations (default 12), tokens per run, and pages fetched per run.
- **Observability**: Single-line structured logs (per AGENTS.md) carrying `scout_run_id`, `wishlist_item_id`, `user_id`, `model_id`, token counts, and latency.
- **Compliance**: Respect `robots.txt` and retailer ToS for fetching. Prefer official APIs. GDPR/POPIA/Kenya DPA-style rights: users can export and delete all their data, including credentials.
- **Accessibility**: WCAG 2.1 AA for the wishlist and review screens.

### Constraints
- Must run on the existing stack: Supabase (Postgres, Auth, Realtime, Edge Functions), the Temporal Python worker, and the Vite/React JSON-driven UI engine.
- The LLM must be served from AWS Bedrock. The endpoint comes from the environment, never hard-coded.
- The LLM can't browse by itself. Web access goes only through tools we implement (search API + fetcher).
- Many retailers block automated traffic. Generic scraping coverage will be partial, which is why FR-15 exists.

## User Experience

### User Flows

#### Onboarding (first sign-in)
1. User clicks **Continue with Google** and completes the Google consent screen (email/profile only).
2. **Step 1 – Location**: country (pre-filled from locale) and currency.
3. **Step 2 – Retailers**: checkboxes for the enabled retailers that serve that country (see the [market matrix](#launch-markets)). At least one is required.
4. **Step 3 – Default AI model**: radio list of enabled models with short descriptions written by the admin (e.g. "Fast & economical", "Most thorough"). The admin default is pre-selected. Copy: "You can choose a different model for each wishlist."
5. **Step 4 – Linked accounts (optional, skippable)**: confirm or enter the account email per selected retailer.
6. User lands on an empty **My Wishlist**.

#### Happy Path
0. User clicks **New wishlist**, enters a name ("Home office"), and keeps or changes the pre-selected model.
1. User opens the wishlist and clicks **Add item**.
2. User enters "Noise-cancelling over-ear headphones, under $250, black". They can also paste a reference link.
3. System saves the item (`scouting`) and starts `ScoutItemWorkflow`, which searches every selected retailer in parallel.
4. Candidate cards appear one at a time as they are verified (Realtime subscription). Per-retailer progress chips show "Takealot ✓ 2 · Amazon ◌ · Shopify ✓ 1".
5. Run finishes. Item becomes `candidates_ready` with the merged, ranked list.
6. User approves one card. Item becomes `approved` and the card is pinned as the chosen product.

#### Alternative Paths
- **Reject all + re-scout**: User rejects each card with a reason ("too expensive", "wrong colour") and clicks **Find more**. The next run includes the rejections as negative constraints.
- **Edit constraints**: User changes the budget. The system asks whether to re-scout, and existing candidates stay visible but are marked possibly outdated.
- **Scheduled update**: A weekly re-scout finds a cheaper verified match, the user gets a notification, and a new card appears with a "New" badge.

#### Error Scenarios
- **No matches**: Item becomes `no_matches`. UI suggests loosening constraints (budget, brand, condition).
- **One retailer fails or is blocked**: That retailer's child is marked `failed`, the others carry on, and the run status is `partial` with a per-retailer note in the UI.
- **Selected model disabled by admin mid-flight**: Runs already in progress finish on their model. New runs use the admin default, and the user is notified.
- **Bedrock unavailable / throttled**: Activity retries with backoff. After the retry budget runs out, the run is marked `failed`, the item returns to its previous status, and the user sees "Search is temporarily unavailable, we'll retry automatically."
- **Run exceeds budget**: Run stops early and keeps whatever verified candidates it has. Status is `partial`.
- **Link rot on an approved candidate**: Scheduled re-check marks it `stale` and offers a re-scout.

### Wireframes

```
┌──────────────────────────────────────────────────────────┐
│  My Wishlist                               [+ Add item]  │
├──────────────────────────────────────────────────────────┤
│  ▸ Noise-cancelling headphones  ≤ R4500  ● 5 matches     │
│  [All] [Takealot 2] [Amazon 1] [Shopify 2]               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │ [img]      │ │ [img]      │ │ [img]      │            │
│  │ Sony WH-.. │ │ Bose QC .. │ │ Soundcore  │            │
│  │ R4199      │ │ R4399      │ │ R1299      │            │
│  │ Takealot   │ │ Amazon.co.za│ │ sonicza.co │            │
│  │ 92% match  │ │ 88% match  │ │ 74% match  │            │
│  │ why? ▾     │ │ why? ▾     │ │ why? ▾     │            │
│  │ [✓] [✗] [☆]│ │ [✓] [✗] [☆]│ │ [✓] [✗] [☆]│            │
│  └────────────┘ └────────────┘ └────────────┘            │
│                                    [Find more] [Edit]    │
│  ▸ Running shoes, size 10        ◌ Scouting…             │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  New wishlist                                            │
├──────────────────────────────────────────────────────────┤
│  Name        [ Home office                       ]       │
│  Description [                                   ]       │
│  AI model    [ Most thorough (default)        ▾ ]       │
│               ├ Platform models                          │
│               │   Fast & economical                      │
│               │   Most thorough ✓                        │
│               └ My models  (coming soon: BYOM)           │
│                                       [Cancel] [Create]  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Settings ▸ Linked shopping accounts                     │
├──────────────────────────────────────────────────────────┤
│  Takealot   j***@gmail.com  Google sign-in   [Unlink]    │
│  Amazon     j***@gmail.com  email            [Unlink]    │
│  Jumia      not linked                       [Link]      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Admin ▸ AI Models                          [+ Add model]│
├──────────────────────────────────────────────────────────┤
│  Name             Bedrock ID            Enabled Default  │
│  Fast & economical  <model-id-a>         [✓]     ( )      │
│  Most thorough      <model-id-b>         [✓]     (●)      │
│  Experimental       <model-id-c>         [ ]     ( )      │
│                                   [Test] [Edit] [Disable] │
├──────────────────────────────────────────────────────────┤
│  Admin ▸ Background-task models  (ignored for BYOM)      │
│  Category inference     [ Fast & economical      ▾ ]     │
│  Discovery queries      [ Fast & economical      ▾ ]     │
│  Attribute extraction   [ Use wishlist model     ▾ ]     │
│  Preference summary     [ Fast & economical      ▾ ]     │
│  Cross-retailer rerank  [ Use wishlist model     ▾ ]     │
├──────────────────────────────────────────────────────────┤
│  Admin ▸ Retailers                                       │
│  Takealot  ZA           [✓]   Amazon  US,ZA,KE*     [✓]  │
│  Temu      US           [✓]   Jumia   KE            [✓]  │
│  Shopify   discovery on · 214 stores (3 blocked) [Review]│
└──────────────────────────────────────────────────────────┘
```

### UI Components
All UI is built with **shadcn/ui** ([ADR-0010](../adrs/0010-shadcn-ui-component-system.md)) in three layers: primitives in `src/components/ui/`, domain components in `src/components/app/`, and engine wrappers in `src/components/engine/`, registered for JSON screens.

| Screen element | Domain component | shadcn primitives |
|----------------|------------------|-------------------|
| Candidate card | `CandidateCard` | `Card`, `Badge`, `Button`, `Collapsible` ("why?"), `Tooltip` |
| Retailer filter / grouping | `RetailerFilterChips` | `ToggleGroup` |
| Per-retailer progress | `RetailerProgress` | `Badge`, `Progress`, `Skeleton` |
| Model picker (wishlist form, onboarding, settings) | `ModelSelector` | `Select` or `Command` (grouped: Platform models / My models) |
| Converted prices | `PriceWithConversion` | `Tooltip` (rate date + attribution) |
| Onboarding wizard | `OnboardingStepper` | `Card`, `RadioGroup`, `Checkbox`, `Button` |
| New wishlist / add item | engine forms | `Dialog`/`Sheet`, `Input`, `Textarea`, `Select` |
| Admin portal shell | `AdminLayout` | `Sidebar`, `Breadcrumb` |
| Admin tables (models, retailers, stores, usage) | `AdminDataTable` | `Table` + TanStack Table, `Switch`, `DropdownMenu`, `Pagination` |
| Notifications / errors | — | `Sonner` toasts, `Alert` |

### Interaction Details
- **Loading**: Item row shows a spinner and a live count ("2 found so far…").
- **Empty**: First-run empty state with example items.
- **Why-this-matches**: Expandable 1–3 sentence explanation written by the agent and grounded in the extracted attributes.
- **Price shown** always includes the retailer name and "checked N min ago".

## Technical Design

### Architecture

```
┌──────────────┐ supabase-js: CRUD (RLS)  ┌────────────────────────────┐
│  Frontend    │ + RPC request_scout() ──▶│ Supabase Postgres          │
│  (Vite/React │◀── Realtime ─────────────│  wishlists, items, matches │
│   UI engine) │                          │  scout_runs ◀─┐ same txn   │
└──────────────┘                          │  workflow_jobs┘ (outbox)   │
                                          └──────▲──────────┬──────────┘
                     domain updates (service role)│          │ claim_workflow_jobs()
                                                  │          ▼ every ~2 s, SKIP LOCKED
                                   ┌──────────────┴──────────────────┐
                                   │ Temporal worker (Python)        │
                                   │  JobDispatcher ─▶ start_workflow│
                                   │  ScoutItemWorkflow              │
                                   │   ├─ bedrock_converse    │──▶ AWS Bedrock (BEDROCK_ENDPOINT_URL)
                                   │   ├─ retailer_search     │──▶ Retailer APIs / Search API
                                   │   ├─ fetch_page          │──▶ Retailer sites / APIs
                                   │   ├─ verify_candidate    │
                                   │   └─ persist_candidate   │
                                   └──────────────────────────┘
```

**Admin portal:** a route group under `/admin` in the same frontend, built with the JSON-driven UI engine. The client hides it for non-admins and the server enforces access: RLS policies and admin endpoints check `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`. The first admin is promoted by a one-off SQL/CLI step and never through the UI.

**Workflow fan-out:**
```
ScoutItemWorkflow(item, resolved_model, retailers=[takealot, amazon, temu, jumia, shopify])
  ├─ child ScoutRetailerWorkflow(takealot)  ─┐
  ├─ child ScoutRetailerWorkflow(amazon)     │ parallel, each with its own
  ├─ child ScoutRetailerWorkflow(temu)       │ budget slice and timeout
  ├─ child ScoutRetailerWorkflow(jumia)      │
  └─ child ScoutRetailerWorkflow(shopify)   ─┘
  └─ merge_and_rank activity → final statuses, notifications
```
One retailer that is slow or blocked can't stall or fail the whole run. Cost grows with the number of selected retailers, so per-run budgets are split across the children.

**Starting workflows: queued-jobs table (transactional outbox), [ADR-0002](../adrs/0002-workflow-jobs-outbox.md):**
1. The client calls an RPC (e.g. `request_scout(wishlist_item_id, reason)`). The RPC checks ownership, the active-run rule, and daily caps, then inserts `scout_runs(status='queued')` **and** `workflow_jobs(job_type='scout_item')` in one transaction. Validation failures return immediately as Postgres errors (`WL409` active run, `WL429` daily cap, `WL403` forbidden).
2. The `JobDispatcher` loop in the worker calls `claim_workflow_jobs(limit)` every `JOB_POLL_INTERVAL_SECONDS` (default 2). The claim uses `FOR UPDATE SKIP LOCKED` and moves jobs `queued → dispatching`.
3. The dispatcher starts the workflow with ID `job-<job_id>` (idempotent: an already-started workflow counts as success) and marks the job `dispatched`. If the start fails, the job is requeued with exponential backoff. After 5 attempts it becomes `failed`, and the domain row is marked failed.
4. The workflow updates domain rows as it runs, and the UI follows them over Realtime.

If the worker or Temporal is down, jobs wait in Postgres and nothing is lost. The same mechanism serves every job type: `scout_item`, `scheduled_rescout`, `model_test`, `refresh_fx_rates`, and later `byom_model_test` and automation jobs.

### Agent Design (Bedrock tool-use loop)

The Python worker calls Bedrock through `boto3` `bedrock-runtime` using the **Converse API** with tool definitions:

| Tool | Implemented as | Purpose |
|------|----------------|---------|
| `retailer_search(query, max_results)` | Activity → the child's retailer adapter (see below) | Find candidate product pages on this retailer |
| `fetch_product_page(url)` | Activity → adapter `fetch_product` (API, or HTTP fetch + JSON-LD extraction) | Get structured product data (title, price, currency, availability, GTIN, image) |
| `discover_stores(category, country, filters)` | Activity, Shopify child only (see [Store discovery](#store-discovery)) | Find and check Shopify stores relevant to the item |
| `submit_candidate(url, rationale, match_score, attributes)` | Workflow-local | Agent proposes a candidate. This triggers deterministic verification. |
| `finish(reason)` | Workflow-local | Ends the loop |

Rules:
- **Deterministic orchestration**: The loop runs in the workflow, and each Bedrock call is its own activity. Temporal history makes runs replayable and resumable.
- **Grounding**: Price, currency, availability, and URL shown to users come from `verify_candidate` (structured page data), never from LLM text. The LLM supplies only the match score and rationale.
- **Output schema**: `submit_candidate` arguments are validated with Pydantic. Invalid calls go back to the model as tool errors.
- **Prompt**: System prompt holds the item spec, constraints, user preferences (approved/rejected history), and the region. Fetched page content is wrapped in delimiters as untrusted data (see prompt-injection mitigations).
- **Budgets**: `SCOUT_MAX_ITERATIONS`, `SCOUT_MAX_FETCHES`, and `SCOUT_MAX_TOKENS` are enforced in the workflow.
- **Model resolution**: When the run starts, the parent resolves `wishlists.model_id` → `user_profiles.model_id` → admin default and takes the first model that is enabled. It passes the resolved model ID and `max_output_tokens` to the children and records them on `scout_runs.model_id` / `scout_runs.llm_model_id` so the run can be replayed exactly.
- **Provider abstraction**: Children call a `ModelProvider` interface (`converse(messages, tools, model_ref) → response`), not Bedrock directly. The only implementation in this phase is `BedrockProvider` (uses `BEDROCK_ENDPOINT_URL`). BYOM adds more implementations, chosen by `llm_models.provider`.

### Background-task models

Besides the main scout loop, a run makes smaller LLM calls. Admins can send these to cheaper or faster models:

| Task key | What it does | Typical choice |
|----------|--------------|----------------|
| `scout_agent` | Main tool-use loop: search, choose pages, score, explain | **Always the wishlist model.** Not admin-mappable. |
| `category_inference` | Map the item to the product taxonomy for discovery | Small/fast model |
| `discovery_queries` | Write Shopify store-discovery search queries | Small/fast model |
| `attribute_extraction` | Extract non-price attributes (size, colour, specs) when structured data is missing. Never price/URL/availability. | Wishlist model or mid-tier |
| `preference_summary` | Condense approve/reject history into prompt preferences | Small/fast model |
| `cross_retailer_rerank` | Final ranking and dedupe tie-breaks in `merge_and_rank` | Wishlist model |

**Resolution (per call, at run start, snapshotted in the run):**
```
if wishlist model is BYOM:            use the BYOM model for every task
elif task == scout_agent:              use the wishlist model
elif llm_task_models[task] is set and enabled: use the mapped model
else:                                  use the wishlist model
```
`scout_runs.task_models` records the resolved model per task. Token usage is recorded per task so the admin usage dashboard can show what each mapping costs.

### FX rates

Both providers are free, need no API key, and cover KES, USD, and ZAR (both checked 2026-11-11).

| Role | Provider | Endpoint | Notes |
|------|----------|----------|-------|
| Primary | ExchangeRate-API open access | `GET https://open.er-api.com/v6/latest/USD` | Updated once a day. Their terms ask for attribution ("Rates by ExchangeRate-API") and for clients not to poll more than needed. Fetch once a day. |
| Fallback | fawazahmed0 currency-api | `GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` (mirror: `https://latest.currency-api.pages.dev/v1/currencies/usd.json`) | Open-source, CDN-hosted, daily |

We considered Frankfurter (ECB rates) and rejected it because ECB reference rates don't include KES.

- A daily `RefreshFxRatesWorkflow` (Temporal Schedule, e.g. 01:17 UTC) fetches USD-based rates from the primary, falls back to the secondary on error, and upserts rows into `fx_rates`. Cross rates (e.g. ZAR→KES) are calculated through USD.
- If both providers fail, the last known rates are kept, and the UI shows "rates as of <date>". Rates older than 72 h hide the conversion.
- Conversions are display-only, apart from `max_price` filtering across currencies, which allows a 3% tolerance. Stored candidate prices are never converted.
- The UI shows an attribution line wherever converted prices appear.

### Launch markets

| Retailer | 🇰🇪 Kenya (KES) | 🇺🇸 United States (USD) | 🇿🇦 South Africa (ZAR) |
|----------|----------------|-------------------------|-------------------------|
| Takealot | — | — | `takealot.com` |
| Amazon | `amazon.com`, filtered to items that ship to KE (international shipping) | `amazon.com` | `amazon.co.za` |
| Temu | — (not available in KE) | `temu.com` | — |
| Jumia | `jumia.co.ke` | — | — |
| Shopify | Stores discovered that ship to KE | Stores discovered that ship to US | Stores discovered that ship to ZA |

The admin can change all of this through `retailers.country_domains`. The seed sets the table above. Cross-border results (e.g. amazon.com for KE) show a "Ships internationally — import duties may apply" note.

### Retailer coverage

Every adapter implements `search(query, country) → [url]`, `fetch_product(url) → ProductData`, and `canonicalize_url(url)`. Generic web search (`SEARCH_PROVIDER`) is the shared fallback, using site-scoped queries such as `site:takealot.com sony wh-1000xm5`.

**Web search layer** (already in `temporal/src/search/`):
- `SearchProvider` interface: `search(SearchQuery) → SearchResponse`. Every provider maps its failures onto shared error kinds (`auth`, `bad_request`, `quota`, `rate_limited`, `unavailable`).
- `TavilySearchProvider` is the first implementation. Site scoping uses Tavily's `include_domains` rather than `site:` operators, and the country boost maps ISO codes (KE/US/ZA) to Tavily's country names.
- `SearchClient` tries `SEARCH_PROVIDER`, then `SEARCH_FALLBACK_PROVIDER`.
- `web_search` Temporal activity: rate limits and outages are retried by Temporal. Auth, quota, and bad requests fail immediately.
- **Adding a provider**: one module implementing `SearchProvider`, its settings in `config.py`, and one entry in the registry. Then change `SEARCH_PROVIDER`.
- **Budget**: about 10–15 searches per scout run, so the free tier covers about 65–100 runs/month. That's enough for development. Revisit the plan before beta.

| Retailer | Markets / domains | Primary strategy | Fallback | Known challenges |
|----------|-------------------|------------------|----------|------------------|
| **Takealot** | ZA (`takealot.com`) | Site-scoped web search + product page fetch with JSON-LD extraction | — | No public product API we know of. Client-rendered pages may need the headless renderer. |
| **Amazon** | US + KE (`amazon.com`), ZA (`amazon.co.za`) | Amazon's official product API for affiliates (needs an Amazon Associates account; confirm the current API version and eligibility rules when we build it) | Site-scoped search + fetch | Strong anti-bot measures on direct fetch, so prefer the API. API access depends on affiliate sales thresholds. |
| **Temu** | US only (`temu.com`) | Site-scoped search + headless-rendered fetch | — | Heavy JavaScript and anti-bot measures, so expect the lowest coverage. Prices often depend on session/region. Shown as "price may vary". |
| **Jumia** | KE (`jumia.co.ke`) | Site-scoped search + product page fetch with JSON-LD extraction | — | Stock and price change often, so re-verify more often. |
| **Shopify** | Thousands of independent stores in KE/US/ZA, not one retailer | **Agent-driven store discovery** (below), then product search on each store through its public storefront endpoints (`/search/suggest.json`, `/products/<handle>.json`). Evaluate Shopify's agent-facing catalog APIs when we build this. | Generic fetch + JSON-LD | Store quality varies (handled by the checks below). Some stores turn off the JSON endpoints. |

- A **headless renderer** (Playwright in a sidecar container) is shared by adapters that need JavaScript. It is rate-limited and used only when a plain fetch returns no structured data.
- Each `retailers` row stores the adapter key, the enabled flag, supported countries → domain map, and per-retailer concurrency/rate limits, all editable from the admin portal.

### Store discovery

The Shopify child workflow gives the agent a `discover_stores` tool. Inputs come from the item and profile:

| Filter | Source | Used for |
|--------|--------|----------|
| `category` | LLM-inferred from the item (e.g. "outdoor footwear"), normalised to a fixed taxonomy (Google product taxonomy, top 2 levels) | Search queries + matching cached stores |
| `country` | `user_profiles.country_code` / item `ship_to_country` | Ships-to check, local-store queries ("hiking boots shop Nairobi") |
| `currency` | Profile currency | Prefer stores pricing in local currency |
| `price_range` | Item `max_price` | Filter out stores that are clearly out of range (sampled prices) |
| `brands` / `exclude_brands` | Item constraints | Stores carrying or not carrying the brand |
| `condition` | Item constraints | Exclude e.g. refurb-only stores when the item needs new |

**Discovery steps (deterministic activities, with the LLM only proposing queries and ranking):**
1. **Cache first**: query `shopify_stores` for non-blocked stores matching category + country, ordered by `quality_score` and recency.
2. **Search for more** if the cache returns fewer than N stores (default 8): the LLM writes 2–4 search queries, and the activity runs them through `SEARCH_PROVIDER`.
3. **Confirm it's Shopify**: the store's domain responds like a Shopify storefront (e.g. `/products.json` or Shopify response headers).
4. **Check shipping and currency**: read the store's public shop metadata where available, plus its storefront currency. If the store can't be confirmed to ship to the user's country, skip it.
5. **Quality gate**: HTTPS, products with structured data, prices present, a non-trivial catalogue, and not on the admin blocklist. The resulting `quality_score` is in 0–1.
6. **Save** the store in `shopify_stores` (`status='discovered'`) with categories, countries, currency, and score, so later runs and other users reuse it.
7. Search the **top K stores** (default 5) for the item and submit candidates through the normal verification path.

Budgets: discovery shares the Shopify child's fetch budget. Stores are re-checked at most once every 7 days. Admins can block a store (it is never used again) or pin it as `seed` (always checked first for its categories and countries).

### Configuration

New environment variables, added to `.env.example`, the `temporal-worker` service in `docker-compose.yml`, and `temporal/src/config.py`:

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `BEDROCK_ENDPOINT_URL` | yes | `https://bedrock-runtime.us-east-1.amazonaws.com` | Base runtime endpoint, passed as `endpoint_url` to the `bedrock-runtime` client. Supports VPC endpoints and proxies. Model IDs are **not** set here. |
| `AWS_REGION` | yes | `us-east-1` | Must match the endpoint |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | yes (until hosting is decided) | — | Never commit these. If we host on AWS, we may switch to an IAM role. |
| `BEDROCK_BOOTSTRAP_MODEL_ID` | no | *(a model ID enabled in the console)* | Used only by the seed to create the first `llm_models` row, so a fresh install works before an admin has configured anything |
| `SEARCH_PROVIDER` | yes | `tavily` | Web-search backend, selected by name from the provider registry (`temporal/src/search/registry.py`). Adapters use it for site-scoped queries and store discovery. |
| `SEARCH_FALLBACK_PROVIDER` | no | *(empty)* | Optional second provider, tried when the primary fails (quota, auth, outage). Not tried for bad requests. |
| `SEARCH_MAX_RESULTS` / `SEARCH_TIMEOUT_SECONDS` | no | `10` / `15` | Provider-agnostic defaults |
| `TAVILY_API_KEY` | yes (while `tavily` is configured) | `tvly-…` | Free Researcher plan: 1,000 credits/month, no card (https://app.tavily.com) |
| `TAVILY_SEARCH_DEPTH` / `TAVILY_BASE_URL` | no | `basic` / `https://api.tavily.com` | `basic` = 1 credit/search, `advanced` = 2 |
| `AMAZON_API_ACCESS_KEY` / `AMAZON_API_SECRET_KEY` / `AMAZON_PARTNER_TAG` | no | — | Turns on the Amazon API adapter. Without them, Amazon falls back to search + fetch. |
| `FX_RATES_PROVIDER` | no | `exchangerate_api_open` | Primary free FX source (`https://open.er-api.com/v6/latest/USD`). No key needed, updated daily, attribution required. |
| `FX_RATES_FALLBACK_PROVIDER` | no | `fawazahmed0` | Free fallback (`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`, mirror `https://latest.currency-api.pages.dev/v1/currencies/usd.json`). No key needed. |
| `HEADLESS_RENDERER_URL` | no | `http://renderer:3001` | Playwright sidecar for JavaScript-heavy retailers |
| `JOB_POLL_INTERVAL_SECONDS` / `JOB_CLAIM_BATCH_SIZE` | no | `2` / `10` | Dispatcher poll cadence and batch size for `workflow_jobs` |
| `SCOUT_MAX_ITERATIONS`, `SCOUT_MAX_FETCHES`, `SCOUT_MAX_TOKENS` | no | `12`, `25`, `60000` | Per-run budgets, split across retailer children |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | yes | — | Referenced from `supabase/config.toml` `[auth.external.google]` via `env()`. Never committed. |

The worker validates these at startup and exits with one clear log line if a required variable is missing. The IAM policy needs `bedrock:InvokeModel` and `bedrock:Converse` (plus the `*WithResponseStream` variants if we stream). Scope it to the model/profile ARNs admins are allowed to enable. Adding a model in the admin portal that falls outside the IAM scope fails the test invocation, which is the intended behaviour.

**Google OAuth setup**: Create an OAuth client in Google Cloud Console (type: Web). Authorized redirect URI: `<SUPABASE_URL>/auth/v1/callback`, i.e. `http://localhost:54321/auth/v1/callback` locally. Enable the provider in `supabase/config.toml`. Scopes: `openid email profile` only. These are non-sensitive scopes, so Google's app verification is light.

### API Endpoints

CRUD goes straight through supabase-js/PostgREST with RLS. Anything that starts work or enforces a state machine is a **Postgres RPC** (`supabase.rpc(...)`), `security definer` with explicit checks. No Edge Functions or extra HTTP services are needed at launch.

#### Start / restart a scout run
```ts
supabase.rpc('request_scout', { wishlist_item_id: 'uuid', reason: 'created' | 'constraints_changed' | 'manual' })
```
Returns:
```json
{ "scout_run_id": "uuid", "job_id": "uuid", "status": "queued" }
```
Errors: `WL409` if a run is already queued or running for the item, `WL429` if the user is over their daily limit, `WL403` if the item isn't theirs. Scheduled re-scouts enqueue `scheduled_rescout` jobs from a Temporal Schedule, not through this RPC.

#### Decide on a candidate
```ts
supabase.rpc('decide_match', { match_id: 'uuid', decision: 'approve' | 'reject' | 'save', reason: 'optional free text' })
```
Updates `product_matches.status` and the item status, then writes an audit event. This is an RPC rather than a raw update so the item state machine is enforced in one place.

#### Linked accounts
Plain PostgREST CRUD on `merchant_accounts` under RLS. No secrets are involved, so no custom function is needed.
```json
{ "retailer_code": "takealot", "account_email": "jane@gmail.com", "login_method": "google_sso" }
```

#### Onboarding / preferences
PostgREST `update` on the user's own `user_profiles` row. A `before update` trigger checks that `model_id` points to an enabled model and that `retailer_codes` are all enabled retailers.

#### Admin (admin role required)
Config tables are edited with PostgREST under `is_admin()` RLS policies. The calls with side effects are RPCs:

| Operation | Mechanism |
|-----------|-----------|
| List/create/update models | PostgREST on `llm_models` (admin RLS) |
| Set default model | `rpc('set_default_model', { model_id })`: clears the previous default in the same transaction |
| Test a model | `rpc('request_model_test', { model_id })`: enqueues a `model_test` job. The worker runs a Converse call plus a tool-use round trip and writes `last_test_at` / `last_test_ok`. The UI waits on Realtime. |
| Retailers | PostgREST on `retailers` (`is_enabled`, `country_domains`, `rate_limit_per_min`) |
| Shopify stores | PostgREST on `shopify_stores` (filter by status/country/category; set `seed` / `blocked`) |
| Background-task models | PostgREST on `llm_task_models` |
| Usage | `admin_usage_summary` view (runs, tokens, and failures by model, task, and retailer) |

AWS credentials stay in the worker. The admin UI never calls Bedrock.

### Database Schema

New migration file(s), e.g. `supabase/migrations/2026MMDDHHMMSS_wishlist_domain.sql`. Shipped migrations are not edited. All tables get UUID PKs, `created_at`/`updated_at`, the `update_updated_at()` trigger, and RLS `user_id = auth.uid()`.

```sql
-- Admin helper used by RLS policies
create or replace function is_admin() returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

create table if not exists llm_models (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  description text,                     -- shown to users during onboarding
  provider text not null default 'bedrock' check (provider in ('bedrock')), -- BYOM migration widens this (see BYOM section)
  bedrock_model_id text not null,       -- model ID or inference-profile ID/ARN (provider-specific ref under BYOM)
  owner_user_id uuid references auth.users(id) on delete cascade, -- null = platform model; set = BYOM (future)
  connection jsonb not null default '{}'::jsonb, -- BYOM: region / role ARN / base URL / deployment; never secrets
  secret_ref text,                      -- BYOM only: pointer into SecretStore (API key); null for platform & role-based
  supports_tools boolean not null default true,  -- required: the scout loop depends on tool use
  max_output_tokens int not null default 4096,
  supports_images boolean not null default false,
  is_enabled boolean not null default false,
  is_default boolean not null default false,
  last_test_at timestamptz,
  last_test_ok boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_default_enabled check (not is_default or is_enabled),
  constraint chk_default_platform check (not is_default or owner_user_id is null)
);
create unique index if not exists uq_llm_models_default on llm_models((true)) where is_default;
create unique index if not exists uq_llm_models_platform_ref
  on llm_models(provider, bedrock_model_id) where owner_user_id is null;
-- RLS: authenticated users SELECT platform models where is_enabled (limited columns via view),
-- plus their own rows once BYOM ships; admins full access to platform rows.

create table if not exists llm_task_models (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique
    check (task_key in ('category_inference','discovery_queries','attribute_extraction','preference_summary','cross_retailer_rerank')),
  model_id uuid references llm_models(id) on delete set null, -- null → use wishlist model
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Trigger: model_id must reference an enabled platform model (owner_user_id is null).
-- RLS: admins only; worker reads via service role.

create table if not exists fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null default 'USD',
  quote_currency text not null,
  rate numeric(20,10) not null check (rate > 0),
  as_of date not null,
  source text not null,                 -- 'exchangerate_api_open' | 'fawazahmed0'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_fx_rate unique (base_currency, quote_currency, as_of)
);
-- RLS: readable by authenticated users; written by worker only.

create table if not exists retailers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 'takealot' | 'amazon' | 'temu' | 'jumia' | 'shopify'
  display_name text not null,
  adapter_key text not null,            -- maps to a Python adapter class
  country_domains jsonb not null default '{}'::jsonb, -- {"US":"amazon.com","KE":"amazon.com","ZA":"amazon.co.za"}
  is_enabled boolean not null default true,
  rate_limit_per_min int not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shopify_stores (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  display_name text,
  ships_to text[] not null default '{}',   -- ISO country codes confirmed during discovery
  currency text,
  categories text[] not null default '{}', -- normalised taxonomy paths
  quality_score numeric(4,3) check (quality_score between 0 and 1),
  status text not null default 'discovered' check (status in ('seed','discovered','blocked')),
  discovered_by_run_id uuid,               -- soft ref to scout_runs (created later in the migration)
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_shopify_stores_lookup on shopify_stores using gin (categories, ships_to);
-- RLS: worker (service role) writes; admins read/update; shoppers no direct access.

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  country_code text check (country_code in ('KE','US','ZA')), -- launch markets; widen via new migration
  currency text,                        -- ISO 4217
  retailer_codes text[] not null default '{}',
  model_id uuid references llm_models(id) on delete set null, -- default for new wishlists; null → admin default
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Row created by an `after insert on auth.users` trigger (populated from Google profile).

create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  default_currency text not null default 'USD',
  ship_to_country text,
  model_id uuid references llm_models(id) on delete set null, -- chosen at creation; null → user default → admin default
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, -- denormalised for RLS
  title text not null,
  description text,
  reference_url text,
  image_path text,                      -- Supabase Storage path
  max_price numeric(12,2),
  currency text,
  constraints jsonb not null default '{}'::jsonb, -- brands, exclude_brands, condition, attributes
  retailer_codes text[],                -- null → use user_profiles.retailer_codes
  status text not null default 'draft'
    check (status in ('draft','scouting','candidates_ready','no_matches','approved','archived')),
  rescout_frequency text not null default 'off' check (rescout_frequency in ('off','daily','weekly')),
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scout_runs (
  id uuid primary key default gen_random_uuid(),
  wishlist_item_id uuid not null references wishlist_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workflow_id text not null,
  trigger text not null check (trigger in ('created','constraints_changed','manual','scheduled')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','no_matches','failed','cancelled')),
  llm_model_id uuid references llm_models(id) on delete set null, -- resolved model row
  model_id text,                        -- snapshot of the provider model ref at run start
  task_models jsonb not null default '{}'::jsonb, -- {"category_inference":{"llm_model_id":"…","ref":"…","input_tokens":…,"output_tokens":…}, …}
  retailer_results jsonb not null default '{}'::jsonb, -- {"takealot":{"status":"completed","matches":2}, "temu":{"status":"failed","error":"blocked"}}
  input_tokens int, output_tokens int,
  tool_calls int, pages_fetched int,
  error text,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_scout_runs_active
  on scout_runs(wishlist_item_id) where status in ('queued','running');

-- Transactional outbox for starting Temporal workflows (ADR-0002).
create table if not exists workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null
    check (job_type in ('scout_item','scheduled_rescout','model_test','refresh_fx_rates')), -- widened by later migrations
  payload jsonb not null default '{}'::jsonb,    -- e.g. {"scout_run_id": "..."}; ids only, never secrets
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','dispatching','dispatched','failed','cancelled')),
  workflow_id text,                              -- 'job-<id>' once dispatched
  attempts int not null default 0,
  max_attempts int not null default 5,
  available_at timestamptz not null default now(), -- backoff for retries
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_workflow_jobs_ready
  on workflow_jobs(available_at) where status = 'queued';
-- RLS: no client insert/update/delete. Users may SELECT their own (requested_by = auth.uid()), admins all.
-- claim_workflow_jobs(p_limit int): service_role only; also reclaims 'dispatching' rows older than 60 s.
--   update workflow_jobs set status='dispatching', claimed_at=now(), attempts=attempts+1
--    where id in (select id from workflow_jobs
--                  where (status='queued' and available_at<=now())
--                     or (status='dispatching' and claimed_at < now() - interval '60 seconds')
--                  order by available_at for update skip locked limit p_limit)
--   returning *;

create table if not exists product_matches (
  id uuid primary key default gen_random_uuid(),
  wishlist_item_id uuid not null references wishlist_items(id) on delete cascade,
  scout_run_id uuid references scout_runs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer_code text not null references retailers(code),
  store_domain text not null,          -- e.g. 'takealot.com', 'jumia.co.ke', or the Shopify store's domain
  product_url text not null,
  canonical_url text not null,
  title text not null,
  image_url text,
  price numeric(12,2),
  currency text,
  availability text,                   -- in_stock | out_of_stock | preorder | unknown
  condition text,
  gtin text, mpn text, brand text,
  match_score numeric(4,3) check (match_score between 0 and 1),
  rationale text,
  extracted jsonb not null default '{}'::jsonb, -- raw structured data from verification
  status text not null default 'proposed'
    check (status in ('unverified','proposed','approved','rejected','saved','stale')),
  decision_reason text,
  decided_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_match_per_item unique (wishlist_item_id, canonical_url)
);

create table if not exists merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer_code text not null references retailers(code),
  account_email text not null,
  login_method text not null default 'google_sso' check (login_method in ('google_sso','email')),
  status text not null default 'linked' check (status in ('linked','unlinked')),
  -- Phase 5 will add a nullable secret_ref (pointer into the chosen secret store) in a new migration.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_merchant_account unique (user_id, retailer_code)
);
-- RLS: user_id = auth.uid() for all operations.
```

Seed (`seed.sql`): the five launch `retailers` rows with the KE/US/ZA domain maps from [Launch markets](#launch-markets), and one `llm_models` row taken from `BEDROCK_BOOTSTRAP_MODEL_ID` if it is set (enabled + default). Shopify stores are not seeded. Discovery fills the table, and admins can promote stores to `seed`.

A `before insert or update` trigger on `wishlists` checks that `model_id` is an enabled platform model (or, once BYOM ships, one of the user's own).

#### Reuse of the existing analytics foundation
- **Price history**: For each verification of a match, add a `time_series_points` row (`series_type = 'product_price'`, `data = {price, currency, availability, match_id}`).
- **Events/audit**: Use the existing `append_event` activity pattern for `scout_run.started|completed`, `match.approved|rejected`, `merchant_account.added|revoked`.
- **Why not `entities`/`entity_versions` for core data**: Wishlist data is user-owned, high-churn, and needs simple RLS. Dedicated tables keep policies and queries simple. If we later need SCD2 history of item specs, we can mirror them into `entity_versions`.

### Linked accounts
- **App sign-in** is Google OAuth (Supabase Auth). The Google identity is the user's identity in our app.
- **Important limitation**: a Google OAuth token proves who the user is to *us*. It does **not** give us access to their Takealot, Amazon, Temu, or Jumia account, even when they log in to those sites with "Sign in with Google". Those retailers don't offer third-party delegated-access APIs for shopper accounts.
- So in this phase a linked account is **metadata only**: retailer, account email (defaulting to the Google email), and login method. It drives UX (e.g. "you shop at Takealot as jane@gmail.com") and prepares for Phase 5. No secrets are collected or stored.
- How we actually act on those accounts (and whether any secret store is needed) is decided in Phase 5, along with hosting. Code that needs secrets later goes through a `SecretStore` interface, so Supabase Vault vs AWS Secrets Manager stays a deployment choice.

### Security Considerations
- **AuthN/AuthZ**: Google OAuth via Supabase Auth, with the JWT checked on every endpoint. RLS `user_id = auth.uid()` on all user tables. RPCs re-check ownership (`wishlist_item_id` belongs to `auth.uid()`) inside the transaction, and clients can't insert into `workflow_jobs` directly.
- **Admin**: The role lives in `app_metadata`, which users can't change themselves. `is_admin()` is checked in RLS and in admin endpoints. Admin actions are audit-logged. There is no UI path to grant admin.
- **Google scopes**: Only `openid email profile`. We deliberately do **not** request Gmail API scopes. Those are restricted scopes and would need Google's verification plus a third-party security assessment.
- **Prompt injection from web content**: Fetched pages are untrusted. Mitigations:
  - The scouting agent has no tools with side effects beyond `submit_candidate`, and **never** sees credentials or other users' data.
  - Prices, URLs, and availability come from deterministic extraction, not from model text.
  - Page content is truncated and delimited, and the system prompt tells the model to treat it as data.
  - The future automation agent (Phase 5) runs in a separate worker/task queue with separate IAM and never reads raw web content in the same context as credentials.
- **SSRF**: `fetch_product_page` blocks private, loopback, and link-local IP ranges and non-HTTP(S) schemes, caps response size and redirects, and sets a clear User-Agent.
- **Input validation**: Pydantic models on all activity inputs. URL normalisation before dedupe.
- **Rate limiting**: Per-user daily scout cap and per-retailer fetch concurrency limits.
- **Secrets**: AWS and search keys only in env / IAM. No retailer credentials stored this phase. Nothing secret in logs (log redaction filter).
- **Data rights**: An account deletion workflow removes Storage images and all rows (and, from Phase 5, any stored secrets).

### Performance Considerations
- Indexes: `wishlist_items(user_id, status)`, `product_matches(wishlist_item_id, status, match_score desc)`, `scout_runs(wishlist_item_id, created_at desc)`.
- Fetch cache: cache page extraction results by canonical URL for 1–6 h to avoid refetching across users.
- Parallel `fetch_product_page` activities within a run, bounded by `SCOUT_MAX_FETCHES`.
- Use Bedrock prompt caching for the static system prompt where the chosen model supports it.

## Deferred: External Site Automation
*Placeholder, to be expanded in a later revision of this spec.*

Topics to decide:
- **Mechanism per retailer**: official APIs (preferred) → OAuth-delegated actions → browser automation (Playwright / Bedrock AgentCore browser / computer-use) as a last resort.
- **Actions**: add to the retailer's wishlist/cart, then purchase.
- **Human-in-the-loop**: purchases need explicit per-order confirmation, which fits Temporal signals and reuses the existing `ApprovalWorkflow` pattern. Configurable spend limits.
- **Handling MFA/CAPTCHA**: pause the workflow and ask the user. Never bypass.
- **Retailers that use "Sign in with Google"**: browser automation would have to complete Google sign-in, which Google actively blocks for automated browsers. A likely option is a user-attended session handoff, where the user logs in once in an embedded browser and we keep the session cookie. Needs design and ToS review.
- **Optional Gmail API access** (e.g. reading order confirmations or one-time codes): restricted scope with a heavy verification cost. Decide whether it's worth it.
- **Secret store**: if Phase 5 needs session cookies or tokens, choose the `SecretStore` backend together with hosting.
- **Legal/ToS review per retailer**, liability for wrong purchases, refund flows.
- **Isolation**: a separate automation worker with its own task queue, IAM role, and credential decryption rights.

## Deferred: Bring Your Own Model (BYOM)
*Planned for a later phase (Phase 5b). This phase builds the hooks. **All setups below are in scope.***

**What's already in place this phase:** the `ModelProvider` interface, `llm_models.provider` / `owner_user_id` / `connection` / `secret_ref`, model resolution that works on any `llm_models` row, BYOM precedence in background-task resolution, and a "My models" group in the wishlist model selector.

### Supported setups

| `provider` | Setup | User supplies | Secret stored? | Implementation |
|------------|-------|---------------|----------------|----------------|
| `bedrock_byo_role` | User's own AWS Bedrock, cross-account IAM role (**recommended**) | Role ARN, region, model/inference-profile ID. We generate the external ID. | **No.** We call `sts:AssumeRole` per run. | `BedrockProvider` with assumed-role credentials |
| `bedrock_byo_keys` | User's own AWS Bedrock, access keys | Access key ID + secret, region, model ID | Yes | `BedrockProvider` with user keys |
| `anthropic` | Anthropic API (Claude) | API key, model ID | Yes | `AnthropicProvider` (Messages API, tool use) |
| `openai` | OpenAI API | API key, model ID | Yes | `OpenAIProvider` (tool/function calling) |
| `google_gemini` | Google Gemini API / Vertex AI | API key (or service-account JSON for Vertex), model ID, project/region for Vertex | Yes | `GeminiProvider` |
| `azure_openai` | Azure OpenAI | Endpoint, deployment name, API version, API key | Yes | `AzureOpenAIProvider` |
| `openai_compatible` | Any OpenAI-compatible endpoint: self-hosted vLLM, Ollama, LM Studio behind a gateway, OpenRouter, Together, Groq, etc. | Base URL (public HTTPS), model name, optional API key | If a key is given | `OpenAICompatibleProvider` |

The BYOM migration widens the `llm_models.provider` check list. Each provider normalises to the same internal message/tool format, so the scout workflows don't change.

### Secrets
- API keys, AWS keys, and service-account JSON go through the `SecretStore` interface. The backend (e.g. Supabase Vault or AWS Secrets Manager) is **chosen in the hosting discussion**. BYOM code depends only on the interface.
- Secrets are write-only: after saving, the UI shows only a hint (last 4 characters). Users can rotate or delete them. Deleting a BYOM model deletes its secret, and wishlists using it fall back to the user's platform default.
- Only the worker decrypts secrets, per call, and never logs or caches them beyond the activity. `secret_ref` is never exposed through PostgREST.

### Requirements
- **Validation on save**: test invocation plus a **tool-use round trip** (the model must call a dummy tool with valid JSON arguments), because the scout loop depends on tool calling. Models that fail can't be selected. The result is stored in `last_test_at` / `last_test_ok`.
- **Self-hosted endpoints must be publicly reachable over HTTPS.** Our servers can't reach a user's `localhost`. SSRF rules (same as `fetch_product_page`) block private, loopback, and link-local addresses, so self-hosters put their model behind a public gateway or tunnel.
- **Background tasks**: BYOM wishlists use the user's model for **every** task. No platform model is used, so their prompts go only to the user's provider (FR-1d).
- **Budgets**: Per-run search/fetch budgets still apply, because those cost us even when the user pays for the LLM. Token and iteration caps become user-configurable within admin-set maximums.
- **Admin controls**: a feature toggle for BYOM as a whole, a per-provider allowlist, and a per-user BYOM model limit. Admins can see that a user has BYOM models (provider, model name, status), but never the secrets.
- **Privacy disclosure**: when adding a BYOM model, the UI explains that item details and fetched product data are sent to the user's chosen provider. Other users' data and retailer credentials are never sent.
- **Errors**: provider auth errors (401/403) mark the model `needs_attention` and notify the user. Runs fall back to failing with a clear message, **not** to platform models, so a user's data never silently goes somewhere else.

## Deferred: Hosting
To be decided after the application is built and running locally. Decisions that depend on it: IAM role vs static AWS keys, Supabase Cloud vs self-hosted, where the Temporal worker and headless renderer run, the `SecretStore` backend, and network path to Bedrock (public endpoint vs VPC endpoint). Because `BEDROCK_ENDPOINT_URL` and all credentials come from env, none of these choices need code changes.

## Implementation Plan

### Phase 1: Foundation
- [ ] Google OAuth: Google Cloud client, `supabase/config.toml` provider config, sign-in page, `user_profiles` trigger
- [ ] Migration: `llm_models`, `retailers`, `shopify_stores`, `user_profiles`, `wishlists`, `wishlist_items`, `scout_runs`, `product_matches`, `merchant_accounts` + `is_admin()` + RLS + indexes
- [ ] Migration also includes `llm_task_models`, `fx_rates`, and `workflow_jobs` (+ outbox RPCs)
- [ ] Seed: launch retailers (Temu US-only) + bootstrap model + empty task-model mappings
- [ ] Worker config: Bedrock endpoint + search env vars, startup validation, `.env.example` / compose updates
- [ ] `ModelProvider` interface + `BedrockProvider` (`converse` activity taking a per-call model ref), with retries and token accounting

### Phase 2: Admin + Onboarding
- [ ] `workflow_jobs` table + `claim_workflow_jobs` / `request_scout` / `request_model_test` / `decide_match` RPCs + `JobDispatcher` loop in the worker
- [ ] UI foundation (ADR-0010): add the missing shadcn primitives (`radio-group`, `toggle-group`, `command`, `dropdown-menu`, `collapsible`, `scroll-area`, `sidebar`, `breadcrumb`, `sonner`, `pagination`, `switch`), check CLI compatibility with `components.json`, and create the `src/components/app/` domain components + engine wrappers
- [ ] Admin portal: models (CRUD, test incl. tool-use check, default), retailers (enable per country, domains), Shopify store review/block/seed
- [ ] Onboarding wizard (country KE/US/ZA + currency → retailers → default model → linked accounts) + Settings page
- [ ] Wishlist create/edit form with model selector
- [ ] Admin background-task model mappings + per-task usage in run records

### Phase 3: Multi-retailer Scouting MVP
- [ ] Retailer adapter interface + adapters: Takealot, Jumia (fetch + JSON-LD), Amazon (API with fallback, ships-to-KE filter), Shopify, Temu (headless)
- [ ] Store discovery: `discover_stores` tool, category normalisation, Shopify confirmation, ships-to check, quality gate, `shopify_stores` cache
- [ ] FX rates: `fx_rates` table, daily `RefreshFxRatesWorkflow` (Temporal Schedule) with primary → fallback provider, approximate conversion + attribution in UI
- [ ] Headless renderer sidecar in `docker-compose.yml`
- [ ] Activities: `retailer_search`, `fetch_product_page` (SSRF guards), `verify_candidate`, `persist_candidate`, `merge_and_rank`
- [ ] `ScoutItemWorkflow` + `ScoutRetailerWorkflow` children with budgets
- [ ] `scout` and `matches/{id}/decision` endpoints
- [ ] Frontend: wishlist, item form (with retailer override), candidate cards with retailer filter chips, per-retailer progress, approve/reject

### Phase 4: Quality & Retention
- [ ] Scheduled re-scouts (Temporal Schedules), price history, notifications
- [ ] Feedback loop from decisions into prompts
- [ ] Admin usage dashboard (runs, tokens, failure rate by model × retailer)
- [ ] Eval set: ~50 golden wishlist items across the five retailers and all three markets (~15–20 per country), used to compare models/prompts

### Phase 5: External automation (separate spec revision)

### Phase 5b: Bring Your Own Model (can run in parallel with Phase 5)
- [ ] `SecretStore` backend (chosen in the hosting discussion) + BYOM migration widening `provider`
- [ ] Providers: `bedrock_byo_role`, `bedrock_byo_keys`, `anthropic`, `openai`, `google_gemini`, `azure_openai`, `openai_compatible`
- [ ] "My models" UI (add/test/rotate/delete), tool-use validation, admin BYOM toggles and allowlist
- [ ] Provider conformance tests (same tool-use fixtures run against every provider)

### Phase 6: Hosting & deployment (decided after build)

### Dependencies
- AWS account with Bedrock model access granted in the target region for every model admins plan to enable
- Google Cloud project with an OAuth client (consent screen configured)
- Tavily account + API key (free Researcher plan)
- Amazon Associates account (for the Amazon product API; optional at first because of the fallback)

### Risks and Mitigations
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Hallucinated products/prices/URLs | High | Medium | Deterministic verification. LLM never sets price/URL fields. |
| Retailers block fetching | High | High | Official APIs, caching, polite rate limits, accept partial coverage |
| Prompt injection via product pages | High | Medium | Tool isolation, no credentials in scouting context, structured extraction |
| Temu (and possibly Takealot) block automated fetching | High | High | Headless renderer, low rate limits, mark the retailer `partial` in the UI and don't fail the run |
| Amazon API access lost (affiliate eligibility rules) | Medium | Medium | Automatic fallback to search + fetch |
| Agent-discovered Shopify stores are low-quality or scams | High | Medium | Deterministic quality gate, ships-to confirmation, store domain + "Independent store" badge, admin review queue and blocklist, `seed` stores ranked first |
| Discovery cost (many fetches per run) | Medium | Medium | Cross-user store cache, 7-day re-check interval, discovery shares the Shopify fetch budget |
| Thin coverage in Kenya (fewer retailers, cross-border Amazon) | Medium | High | Jumia + local Shopify stores as primary sources, clear import/shipping notes, KE-specific eval items |
| Admin enables a costly model | Medium | Low | Per-run token caps regardless of model, usage dashboard by model |
| Users expect "Sign in with Google" to give us retailer access | Medium | High | Clear copy in onboarding: linking is informational until automation ships |
| LLM/search cost overruns | Medium | Medium | Per-run budgets, per-user caps, fetch cache, cost dashboard |
| Retailer ToS violations (scraping/automation) | High | Medium | Legal review per retailer before enabling. Robots.txt compliance. |

## Testing Strategy
- **Unit**: Extraction from saved HTML fixtures (JSON-LD, OG, malformed), URL canonicalisation/dedupe, state-machine transitions, SSRF guard, budget enforcement.
- **Workflow**: Temporal test environment with mocked Bedrock/search activities, covering happy path, no matches, Bedrock throttling, budget exhaustion, and cancellation.
- **DB**: `supabase db reset` green. RLS tests confirm user A can't read user B's items, matches, or account metadata.
- **LLM evals**: Golden-set precision/coverage on every prompt or model change.
- **Security**: Prompt-injection fixtures (pages with "ignore previous instructions…") must not change agent behaviour beyond the candidate data.

## Rollout Plan
- **Feature flag**: `wishlist_scout_enabled`, plus a per-user allowlist during beta.
- **Beta**: Internal users first, with daily scout caps set low to observe cost.
- **Monitoring**: Run success rate, verified-candidate rate, p90 latency, tokens/cost per run, Bedrock throttling rate, approval rate.
- **Rollback**: Disable the flag. Workflows can be cancelled by ID. Migrations only add tables, so no data rollback is needed.

## Open Questions
- [x] ~~Launch retailers~~: Takealot, Amazon, Temu, Jumia, Shopify. Users choose which ones to search.
- [x] ~~Bedrock endpoint format~~: base runtime endpoint in env. Models managed in the admin portal and chosen by users during onboarding.
- [x] ~~Hosting~~: deferred until after build.
- [x] ~~Passwords vs OAuth~~: Google OAuth for sign-in, no retailer secrets in this phase.
- [x] ~~Launch countries~~: Kenya, United States, South Africa.
- [x] ~~Shopify sourcing~~: agent-driven discovery by category, country, and item filters. Admin seed/blocklist as controls.
- [x] ~~Model selection granularity~~: per wishlist (with a user default). BYOM in a later phase.
- [x] ~~Temu in Kenya~~: not available. Temu is offered in the US market only.
- [x] ~~FX provider~~: ExchangeRate-API open access (free, no key), with fawazahmed0 currency-api as fallback.
- [x] ~~BYOM scope~~: all setups (see [Supported setups](#supported-setups)).
- [x] ~~Background-task models~~: yes, admin-controlled per task, except for BYOM wishlists.
- [ ] `SecretStore` backend (Supabase Vault vs AWS Secrets Manager, etc.): deferred to the hosting discussion. - Owner: Eng
- [ ] Notification channels: in-app only, or email too (we'll have the Google email)? - Owner: Product

## Decision Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-11 | LLM served via AWS Bedrock, endpoint/model from env vars at boot | Requirement. Lets us swap models/regions without code changes. |
| 2026-11-11 | Scouting runs as Temporal workflows with each LLM/tool call as an activity | Durable, retryable, observable. Matches the existing worker. |
| 2026-11-11 | Displayed price/URL/availability come from deterministic page extraction, not the LLM | Prevents hallucinated data reaching users |
| 2026-11-11 | Dedicated domain tables rather than generic `entities` | Simpler RLS and queries for user-owned data. Analytics tables reused for price history/events. |
| 2026-11-11 | Launch retailers: Takealot, Amazon, Temu, Jumia, Shopify. Users select which to search. | Product decision. Covers ZA/KE plus the US. Temu is US-only. |
| 2026-11-11 | One child workflow per retailer, merged and ranked by the parent | Isolates slow or blocked retailers. Gives per-retailer progress and a best-per-retailer guarantee. |
| 2026-11-11 | `BEDROCK_ENDPOINT_URL` = base runtime endpoint. Models in admin-managed `llm_models`, chosen by users during onboarding. | Swap or add models without redeploying. Admins control cost and quality. |
| 2026-11-11 | Google OAuth is the only sign-in method. Linked retailer accounts are metadata only, with no secrets. | Simplest secure auth. Google tokens can't access retailer accounts, so storing secrets now adds risk for no benefit. |
| 2026-11-11 | Launch markets: KE, US, ZA, with retailer availability per country | Product decision |
| 2026-11-11 | The agent discovers Shopify stores, with deterministic checks and a cross-user cache | Broad coverage without hand-curation. Checks and cache control quality and cost. |
| 2026-11-11 | Model chosen per wishlist (default from profile). `ModelProvider` abstraction + BYOM-ready columns now. | Product decision. Adding BYOM later then needs no schema reshaping. |
| 2026-11-11 | Temu offered in the US market only | Temu isn't available in Kenya. ZA is also excluded per product decision. |
| 2026-11-11 | FX: ExchangeRate-API open access (primary) + fawazahmed0 currency-api (fallback) | Free, no key, include KES. Frankfurter/ECB lacks KES. |
| 2026-11-11 | BYOM covers all setups (own Bedrock via role or keys, Anthropic, OpenAI, Gemini, Azure OpenAI, OpenAI-compatible) | Product decision. `ModelProvider` abstraction keeps workflows unchanged. |
| 2026-11-11 | Admin maps background tasks to models. BYOM wishlists use the user's model for all tasks. | Cost control on platform runs. BYOM users' data stays with their provider. |
| 2026-11-11 | Web search via Tavily (free tier) behind a provider registry, selected by `SEARCH_PROVIDER`, with optional `SEARCH_FALLBACK_PROVIDER` | Free, no card, built for agents. Swapping or adding providers is config plus one adapter module, with no workflow changes. |
| 2026-11-11 | Workflows are started through a queued-jobs table (transactional outbox) polled by the worker, not an HTTP gateway | Robustness: no lost requests when the worker or Temporal is down, and no extra public service ([ADR-0002](../adrs/0002-workflow-jobs-outbox.md)) |
| 2026-11-11 | shadcn/ui is the component system (primitives → domain components → engine wrappers) | Builds on the existing scaffolding. Radix accessibility, Tailwind v4 tokens, and code we own ([ADR-0010](../adrs/0010-shadcn-ui-component-system.md)) |
| 2026-11-11 | Hosting decided after build | Everything that depends on the environment is in env vars or behind interfaces |

## References
- `Generalisable_schema.md`, `DATABASE.md`: existing schema conventions
- `temporal/src/workflows/example/approval_workflow.py`: human-in-the-loop signal pattern
- AWS Bedrock Converse API & tool use documentation
