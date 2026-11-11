-- AI Shopping Wishlist ("Scout") domain model
-- Created: 2026-11-11
-- Spec: docs/specs/ai-shopping-wishlist.md (Database Schema); ADR-0002, ADR-0003, ADR-0007, ADR-0008
-- Tables, RLS, guard triggers and indexes. RPCs live in 20261111120100_wishlist_rpcs.sql.

-- ============================================================================
-- Helpers
-- ============================================================================

-- Admin helper used by RLS policies. The role lives in app_metadata, which users can't edit.
create or replace function is_admin() returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- True for the worker (service-role JWT) and for direct DB sessions (migrations, seed, psql).
create or replace function is_service_context() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or coalesce(current_setting('request.jwt.claims', true), '') = ''
$$;

-- RPCs set this transaction-local flag before touching guarded columns, so the
-- guard triggers can tell "state machine in an RPC" apart from "client PATCH".
create or replace function in_trusted_rpc() returns boolean language sql stable as $$
  select coalesce(current_setting('app.trusted_rpc', true), '') = 'on'
$$;

create or replace function begin_trusted_rpc() returns void language sql volatile as $$
  select set_config('app.trusted_rpc', 'on', true)
$$;

-- ============================================================================
-- Platform configuration (admin-managed)
-- ============================================================================

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_app_settings_updated_at before update on app_settings
  for each row execute function update_updated_at();

create or replace function app_setting(p_key text, p_default jsonb default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_settings where key = p_key), p_default)
$$;

create table if not exists llm_models (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  description text,                     -- shown to users during onboarding
  provider text not null default 'bedrock' check (provider in ('bedrock')), -- BYOM migration widens this
  bedrock_model_id text not null,       -- model ID or inference-profile ID/ARN (provider-specific ref under BYOM)
  owner_user_id uuid references auth.users(id) on delete cascade, -- null = platform model; set = BYOM (future)
  connection jsonb not null default '{}'::jsonb, -- BYOM: region / role ARN / base URL / deployment; never secrets
  secret_ref text,                      -- BYOM only: pointer into SecretStore; never exposed via PostgREST
  supports_tools boolean not null default true,
  max_output_tokens int not null default 4096 check (max_output_tokens between 1 and 200000),
  supports_images boolean not null default false,
  cost_note text,
  is_enabled boolean not null default false,
  is_default boolean not null default false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_default_enabled check (not is_default or is_enabled),
  constraint chk_default_platform check (not is_default or owner_user_id is null)
);
create unique index if not exists uq_llm_models_default on llm_models((true)) where is_default;
create unique index if not exists uq_llm_models_platform_ref
  on llm_models(provider, bedrock_model_id) where owner_user_id is null;
create trigger trg_llm_models_updated_at before update on llm_models
  for each row execute function update_updated_at();

-- A model can only be enabled after a passing test (incl. tool-use round trip),
-- and changing its provider ref invalidates the previous test.
create or replace function guard_llm_models() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.bedrock_model_id is distinct from old.bedrock_model_id
                           or new.provider is distinct from old.provider) then
    if old.is_default then
      raise exception using errcode = 'WL400', message = 'Set another default model before changing the default model''s ID';
    end if;
    new.last_test_ok := null;
    new.last_test_at := null;
    new.last_test_error := null;
    new.is_enabled := false;
  end if;
  -- Only the enable transition needs a passing test; a failed re-test of an
  -- enabled model is recorded and left for the admin to act on.
  if new.is_enabled and (tg_op = 'INSERT' or not old.is_enabled) and new.last_test_ok is not true then
    raise exception using errcode = 'WL400', message = 'Model must pass a test invocation before it can be enabled';
  end if;
  if new.is_enabled and not new.supports_tools then
    raise exception using errcode = 'WL400', message = 'Scout models must support tool use';
  end if;
  return new;
end;
$$;
create trigger trg_llm_models_guard before insert or update on llm_models
  for each row execute function guard_llm_models();

create table if not exists llm_task_models (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique
    check (task_key in ('category_inference','discovery_queries','attribute_extraction','preference_summary','cross_retailer_rerank')),
  model_id uuid references llm_models(id) on delete set null, -- null -> use wishlist model
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_llm_task_models_updated_at before update on llm_task_models
  for each row execute function update_updated_at();

create or replace function guard_llm_task_models() returns trigger language plpgsql as $$
begin
  if new.model_id is not null and not exists (
    select 1 from llm_models m where m.id = new.model_id and m.is_enabled and m.owner_user_id is null
  ) then
    raise exception using errcode = 'WL400', message = 'Background tasks can only use enabled platform models';
  end if;
  return new;
end;
$$;
create trigger trg_llm_task_models_guard before insert or update of model_id on llm_task_models
  for each row execute function guard_llm_task_models();

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
create trigger trg_fx_rates_updated_at before update on fx_rates
  for each row execute function update_updated_at();

create table if not exists retailers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 'takealot' | 'amazon' | 'temu' | 'jumia' | 'shopify'
  display_name text not null,
  adapter_key text not null,            -- maps to a Python adapter class
  country_domains jsonb not null default '{}'::jsonb, -- {"US":"amazon.com","KE":"amazon.com","ZA":"amazon.co.za"}
  cross_border_countries text[] not null default '{}', -- markets served from another country's domain (import note)
  is_enabled boolean not null default true,
  rate_limit_per_min int not null default 30 check (rate_limit_per_min > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_country_domains_object check (jsonb_typeof(country_domains) = 'object')
);
create trigger trg_retailers_updated_at before update on retailers
  for each row execute function update_updated_at();

-- Retailer codes that are enabled and serve the given country.
create or replace function retailers_for_country(p_country text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(code order by code), '{}')
  from retailers
  where is_enabled and country_domains ? upper(p_country)
$$;

create table if not exists shopify_stores (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  display_name text,
  ships_to text[] not null default '{}',   -- ISO country codes confirmed during discovery
  currency text,
  categories text[] not null default '{}', -- normalised taxonomy paths
  quality_score numeric(4,3) check (quality_score between 0 and 1),
  status text not null default 'discovered' check (status in ('seed','discovered','blocked')),
  discovered_by_run_id uuid,               -- soft ref to scout_runs
  last_checked_at timestamptz,
  check_details jsonb not null default '{}'::jsonb, -- quality-gate breakdown from discovery
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_shopify_stores_categories on shopify_stores using gin (categories);
create index if not exists ix_shopify_stores_ships_to on shopify_stores using gin (ships_to);
create trigger trg_shopify_stores_updated_at before update on shopify_stores
  for each row execute function update_updated_at();

-- ============================================================================
-- User-owned data
-- ============================================================================

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  email text,                           -- copied from the Google identity; default for linked accounts
  avatar_url text,
  country_code text check (country_code in ('KE','US','ZA')), -- launch markets; widen via new migration
  currency text check (currency in ('KES','USD','ZAR')),
  retailer_codes text[] not null default '{}',
  model_id uuid references llm_models(id) on delete set null, -- default for new wishlists; null -> admin default
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_user_profiles_updated_at before update on user_profiles
  for each row execute function update_updated_at();

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into user_profiles (user_id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_auth_users_profile on auth.users;
create trigger trg_auth_users_profile after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Validates onboarding/settings writes (spec: Onboarding / preferences).
create or replace function guard_user_profiles() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_bad text[];
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception using errcode = 'WL403', message = 'user_id cannot be changed';
  end if;
  if not is_service_context() and tg_op = 'UPDATE' and new.email is distinct from old.email then
    new.email := old.email;  -- identity email is owned by auth
  end if;

  if new.model_id is not null and (tg_op = 'INSERT' or new.model_id is distinct from old.model_id) then
    if not exists (select 1 from llm_models m where m.id = new.model_id and m.is_enabled
                   and (m.owner_user_id is null or m.owner_user_id = new.user_id)) then
      raise exception using errcode = 'WL400', message = 'Selected model is not available';
    end if;
  end if;

  if tg_op = 'INSERT' or new.retailer_codes is distinct from old.retailer_codes
     or new.country_code is distinct from old.country_code then
    select array_agg(c) into v_bad
    from unnest(new.retailer_codes) c
    where c <> all (case when new.country_code is null
                         then (select coalesce(array_agg(code), '{}') from retailers where is_enabled)
                         else retailers_for_country(new.country_code) end);
    if v_bad is not null then
      raise exception using errcode = 'WL400',
        message = format('Retailers not available in %s: %s', coalesce(new.country_code, 'any market'), array_to_string(v_bad, ', '));
    end if;
  end if;

  if new.onboarding_completed_at is not null then
    if new.country_code is null or new.currency is null then
      raise exception using errcode = 'WL400', message = 'Choose a country and currency to finish onboarding';
    end if;
    if cardinality(new.retailer_codes) = 0 then
      raise exception using errcode = 'WL400', message = 'Choose at least one retailer';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_user_profiles_guard before insert or update on user_profiles
  for each row execute function guard_user_profiles();

create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  default_currency text not null default 'USD',
  ship_to_country text check (ship_to_country in ('KE','US','ZA')),
  model_id uuid references llm_models(id) on delete set null, -- chosen at creation; null -> user default -> admin default
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_wishlists_user on wishlists(user_id, created_at desc);
create trigger trg_wishlists_updated_at before update on wishlists
  for each row execute function update_updated_at();

create or replace function guard_wishlists() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception using errcode = 'WL403', message = 'user_id cannot be changed';
  end if;
  if new.model_id is not null and (tg_op = 'INSERT' or new.model_id is distinct from old.model_id) then
    if not exists (select 1 from llm_models m where m.id = new.model_id and m.is_enabled
                   and (m.owner_user_id is null or m.owner_user_id = new.user_id)) then
      raise exception using errcode = 'WL400', message = 'Selected model is not available';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_wishlists_guard before insert or update on wishlists
  for each row execute function guard_wishlists();

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, -- denormalised for RLS
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  reference_url text check (reference_url is null or reference_url ~* '^https?://'),
  image_path text,                      -- Supabase Storage path (FR-14, later)
  max_price numeric(12,2) check (max_price is null or max_price > 0),
  currency text,
  constraints jsonb not null default '{}'::jsonb, -- brands[], exclude_brands[], condition, attributes{}, ship_to_country
  retailer_codes text[],                -- null -> use user_profiles.retailer_codes
  status text not null default 'draft'
    check (status in ('draft','scouting','candidates_ready','no_matches','approved','archived')),
  rescout_frequency text not null default 'off' check (rescout_frequency in ('off','daily','weekly')),
  last_scouted_at timestamptz,
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_constraints_object check (jsonb_typeof(constraints) = 'object'),
  constraint chk_condition check (constraints ->> 'condition' is null
                                  or constraints ->> 'condition' in ('new','used','refurb','any'))
);
create index if not exists ix_wishlist_items_user_status on wishlist_items(user_id, status);
create index if not exists ix_wishlist_items_wishlist on wishlist_items(wishlist_id, created_at desc);
create index if not exists ix_wishlist_items_rescout on wishlist_items(rescout_frequency, last_scouted_at)
  where rescout_frequency <> 'off' and status <> 'archived';
create trigger trg_wishlist_items_updated_at before update on wishlist_items
  for each row execute function update_updated_at();

-- Clients may create drafts, edit fields and archive/unarchive. Every other
-- status change goes through request_scout / decide_match / the worker.
create or replace function guard_wishlist_items() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from wishlists where id = new.wishlist_id;
  if v_owner is null or v_owner <> new.user_id then
    raise exception using errcode = 'WL403', message = 'Wishlist not found';
  end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception using errcode = 'WL403', message = 'user_id cannot be changed';
  end if;

  if in_trusted_rpc() or is_service_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from user_profiles p where p.user_id = new.user_id and p.onboarding_completed_at is not null) then
      raise exception using errcode = 'WL403', message = 'Finish onboarding before adding items';
    end if;
    if new.status <> 'draft' then
      raise exception using errcode = 'WL400', message = 'New items start as draft';
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'archived' then
      null;
    elsif old.status = 'archived' and new.status = 'draft' then
      null;
    else
      raise exception using errcode = 'WL400', message = format('Item status cannot be changed from %s to %s directly', old.status, new.status);
    end if;
  end if;

  if new.retailer_codes is not null and (tg_op = 'INSERT' or new.retailer_codes is distinct from old.retailer_codes) then
    if exists (select 1 from unnest(new.retailer_codes) c
               where not exists (select 1 from retailers r where r.code = c and r.is_enabled)) then
      raise exception using errcode = 'WL400', message = 'One or more retailers are not available';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_wishlist_items_guard before insert or update on wishlist_items
  for each row execute function guard_wishlist_items();

create table if not exists scout_runs (
  id uuid primary key default gen_random_uuid(),
  wishlist_item_id uuid not null references wishlist_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workflow_id text not null,
  trigger text not null check (trigger in ('created','constraints_changed','manual','scheduled')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','no_matches','failed','cancelled')),
  previous_item_status text,            -- restored if the run fails
  llm_model_id uuid references llm_models(id) on delete set null, -- resolved model row
  model_id text,                        -- snapshot of the provider model ref at run start
  model_fallback_reason text,           -- set when the wishlist model was unavailable
  task_models jsonb not null default '{}'::jsonb,
  retailer_codes text[] not null default '{}',
  retailer_results jsonb not null default '{}'::jsonb,
  input_tokens int, output_tokens int,
  tool_calls int, pages_fetched int,
  error text,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_scout_runs_active
  on scout_runs(wishlist_item_id) where status in ('queued','running');
create index if not exists ix_scout_runs_item on scout_runs(wishlist_item_id, created_at desc);
create index if not exists ix_scout_runs_user_day on scout_runs(user_id, created_at);
create trigger trg_scout_runs_updated_at before update on scout_runs
  for each row execute function update_updated_at();

-- Transactional outbox for starting Temporal workflows (ADR-0002).
create table if not exists workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null
    check (job_type in ('scout_item','scheduled_rescout','model_test','refresh_fx_rates')), -- widened by later migrations
  payload jsonb not null default '{}'::jsonb,    -- ids only, never secrets
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','dispatching','dispatched','failed','cancelled')),
  workflow_id text,                              -- 'job-<id>' once dispatched
  attempts int not null default 0,
  max_attempts int not null default 5,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_workflow_jobs_ready on workflow_jobs(available_at) where status = 'queued';
create index if not exists ix_workflow_jobs_dispatching on workflow_jobs(claimed_at) where status = 'dispatching';
create trigger trg_workflow_jobs_updated_at before update on workflow_jobs
  for each row execute function update_updated_at();

create table if not exists product_matches (
  id uuid primary key default gen_random_uuid(),
  wishlist_item_id uuid not null references wishlist_items(id) on delete cascade,
  scout_run_id uuid references scout_runs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer_code text not null references retailers(code),
  store_domain text not null,
  product_url text not null,
  canonical_url text not null,
  title text not null,
  image_url text,
  price numeric(12,2),
  currency text,
  availability text check (availability is null or availability in ('in_stock','out_of_stock','preorder','unknown')),
  condition text,
  gtin text, mpn text, brand text,
  match_score numeric(4,3) check (match_score between 0 and 1),
  rationale text,
  price_source text,                   -- 'json_ld' | 'opengraph' | 'shopify_json' | 'retailer_api'
  is_cross_border boolean not null default false,
  price_may_vary boolean not null default false,
  extracted jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('unverified','proposed','approved','rejected','saved','stale')),
  decision_reason text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  first_seen_run_id uuid,              -- run that first proposed this URL ("New" badge)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_match_per_item unique (wishlist_item_id, canonical_url)
);
create index if not exists ix_product_matches_item on product_matches(wishlist_item_id, status, match_score desc);
create index if not exists ix_product_matches_user on product_matches(user_id);
create trigger trg_product_matches_updated_at before update on product_matches
  for each row execute function update_updated_at();

create table if not exists merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  retailer_code text not null references retailers(code),
  account_email text not null check (account_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  login_method text not null default 'google_sso' check (login_method in ('google_sso','email')),
  status text not null default 'linked' check (status in ('linked','unlinked')),
  -- Phase 5 will add a nullable secret_ref in a new migration.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_merchant_account unique (user_id, retailer_code)
);
create trigger trg_merchant_accounts_updated_at before update on merchant_accounts
  for each row execute function update_updated_at();

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('new_match','price_drop','model_fallback','run_failed','match_stale','info')),
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,  -- e.g. {"wishlist_item_id": "...", "match_id": "..."}
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_notifications_user on notifications(user_id, created_at desc);
create trigger trg_notifications_updated_at before update on notifications
  for each row execute function update_updated_at();

-- Audit log for admin changes, scout runs, decisions and linked accounts (FR-0c, FR-9).
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,                         -- null = system/worker
  subject_user_id uuid references auth.users(id) on delete cascade, -- owner of the data, for user-visible history
  entity_type text not null,
  entity_id uuid,
  event_type text not null,              -- e.g. 'scout_run.started', 'match.approved', 'llm_models.update'
  data jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_audit_events_entity on audit_events(entity_type, entity_id, created_at desc);
create index if not exists ix_audit_events_subject on audit_events(subject_user_id, created_at desc);
create index if not exists ix_audit_events_type on audit_events(event_type, created_at desc);

create or replace function log_audit_event(
  p_entity_type text, p_entity_id uuid, p_event_type text, p_data jsonb default '{}'::jsonb,
  p_subject_user_id uuid default null, p_correlation_id text default null
) returns void language sql security definer set search_path = public as $$
  insert into audit_events (actor_id, subject_user_id, entity_type, entity_id, event_type, data, correlation_id)
  values (auth.uid(), p_subject_user_id, p_entity_type, p_entity_id, p_event_type, coalesce(p_data, '{}'::jsonb), p_correlation_id)
$$;

-- Admin-table audit trigger: logs every write made with an admin JWT.
create or replace function audit_admin_change() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - 'secret_ref' end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - 'secret_ref' end;
begin
  if is_admin() then
    insert into audit_events (actor_id, entity_type, entity_id, event_type, data)
    values (auth.uid(), tg_table_name, coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
            tg_table_name || '.' || lower(tg_op), jsonb_build_object('old', v_old, 'new', v_new));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_audit_llm_models after insert or update or delete on llm_models
  for each row execute function audit_admin_change();
create trigger trg_audit_llm_task_models after insert or update or delete on llm_task_models
  for each row execute function audit_admin_change();
create trigger trg_audit_retailers after insert or update or delete on retailers
  for each row execute function audit_admin_change();
create trigger trg_audit_shopify_stores after insert or update or delete on shopify_stores
  for each row execute function audit_admin_change();
create trigger trg_audit_app_settings after insert or update or delete on app_settings
  for each row execute function audit_admin_change();

-- Linked-account audit (FR-9: credential changes).
create or replace function audit_merchant_account() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_row merchant_accounts := coalesce(new, old);
  v_event text;
begin
  v_event := case
    when tg_op = 'INSERT' then 'merchant_account.added'
    when tg_op = 'DELETE' then 'merchant_account.revoked'
    when new.status = 'unlinked' and old.status = 'linked' then 'merchant_account.revoked'
    when new.status = 'linked' and old.status = 'unlinked' then 'merchant_account.added'
    else 'merchant_account.updated' end;
  insert into audit_events (actor_id, subject_user_id, entity_type, entity_id, event_type, data)
  values (auth.uid(), v_row.user_id, 'merchant_account', v_row.id, v_event,
          jsonb_build_object('retailer_code', v_row.retailer_code, 'login_method', v_row.login_method));
  return v_row;
end;
$$;
create trigger trg_audit_merchant_accounts after insert or update or delete on merchant_accounts
  for each row execute function audit_merchant_account();

-- When an admin disables a model, tell affected users (shown at next login).
create or replace function notify_model_disabled() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if old.is_enabled and not new.is_enabled then
    insert into notifications (user_id, kind, title, body, data)
    select u.user_id, 'model_fallback',
           'An AI model you use is no longer available',
           format('"%s" was disabled. Searches will use your default model or the platform default instead.', new.display_name),
           jsonb_build_object('llm_model_id', new.id)
    from (
      select user_id from user_profiles where model_id = new.id
      union
      select user_id from wishlists where model_id = new.id and not is_archived
    ) u;
  end if;
  return new;
end;
$$;
create trigger trg_llm_models_disabled after update of is_enabled on llm_models
  for each row execute function notify_model_disabled();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table app_settings enable row level security;
alter table llm_models enable row level security;
alter table llm_task_models enable row level security;
alter table fx_rates enable row level security;
alter table retailers enable row level security;
alter table shopify_stores enable row level security;
alter table user_profiles enable row level security;
alter table wishlists enable row level security;
alter table wishlist_items enable row level security;
alter table scout_runs enable row level security;
alter table workflow_jobs enable row level security;
alter table product_matches enable row level security;
alter table merchant_accounts enable row level security;
alter table notifications enable row level security;
alter table audit_events enable row level security;

-- app_settings: admins only (users read limits through RPCs).
create policy app_settings_admin_all on app_settings for all to authenticated
  using (is_admin()) with check (is_admin());

-- llm_models: users see enabled platform models (and their own BYOM rows later); admins manage platform rows.
create policy llm_models_select on llm_models for select to authenticated
  using ((owner_user_id is null and is_enabled) or owner_user_id = auth.uid() or is_admin());
create policy llm_models_admin_insert on llm_models for insert to authenticated
  with check (is_admin() and owner_user_id is null);
create policy llm_models_admin_update on llm_models for update to authenticated
  using (is_admin() and owner_user_id is null) with check (is_admin() and owner_user_id is null);
create policy llm_models_admin_delete on llm_models for delete to authenticated
  using (is_admin() and owner_user_id is null and not is_default);
-- secret_ref is never readable through PostgREST; clients must select explicit columns.
revoke select on llm_models from anon, authenticated;
grant select (id, display_name, description, provider, bedrock_model_id, owner_user_id, connection,
              supports_tools, max_output_tokens, supports_images, cost_note, is_enabled, is_default,
              last_test_at, last_test_ok, last_test_error, created_at, updated_at)
  on llm_models to authenticated;
-- Test results and the default flag are written only by the worker / set_default_model().
revoke insert, update on llm_models from anon, authenticated;
grant insert (display_name, description, provider, bedrock_model_id, connection, supports_tools,
              max_output_tokens, supports_images, cost_note, is_enabled)
  on llm_models to authenticated;
grant update (display_name, description, bedrock_model_id, connection, supports_tools,
              max_output_tokens, supports_images, cost_note, is_enabled)
  on llm_models to authenticated;

create policy llm_task_models_admin_all on llm_task_models for all to authenticated
  using (is_admin()) with check (is_admin());

create policy fx_rates_read on fx_rates for select to authenticated using (true);

create policy retailers_read on retailers for select to authenticated using (is_enabled or is_admin());
create policy retailers_admin_insert on retailers for insert to authenticated with check (is_admin());
create policy retailers_admin_update on retailers for update to authenticated using (is_admin()) with check (is_admin());
create policy retailers_admin_delete on retailers for delete to authenticated using (is_admin());

create policy shopify_stores_admin_read on shopify_stores for select to authenticated using (is_admin());
create policy shopify_stores_admin_update on shopify_stores for update to authenticated using (is_admin()) with check (is_admin());

create policy user_profiles_own_select on user_profiles for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy user_profiles_own_update on user_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy wishlists_own_all on wishlists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy wishlist_items_own_all on wishlist_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy scout_runs_own_select on scout_runs for select to authenticated
  using (user_id = auth.uid() or is_admin());

create policy workflow_jobs_select on workflow_jobs for select to authenticated
  using (requested_by = auth.uid() or is_admin());

create policy product_matches_own_select on product_matches for select to authenticated
  using (user_id = auth.uid());

create policy merchant_accounts_own_all on merchant_accounts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_own_select on notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on notifications for delete to authenticated
  using (user_id = auth.uid());
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;

create policy audit_events_select on audit_events for select to authenticated
  using (is_admin() or subject_user_id = auth.uid());

-- Status/ownership rules on user tables are enforced by the guard_* triggers above;
-- tables written only by RPCs or the worker get no client write privileges.
revoke insert, update, delete on scout_runs, workflow_jobs, product_matches, audit_events from anon, authenticated;
revoke insert, delete on user_profiles from anon, authenticated;
revoke all on app_settings, llm_task_models, shopify_stores, retailers, fx_rates from anon;

-- Harden the template's generic tables, which shipped without RLS. Only the
-- worker (service role) and security-definer RPCs touch them now.
alter table entities enable row level security;
alter table entity_versions enable row level security;
alter table relationships_v2 enable row level security;
alter table fact_types enable row level security;
alter table entity_facts enable row level security;
alter table time_series_points enable row level security;
create policy fact_types_read on fact_types for select to authenticated using (true);

-- ============================================================================
-- Views (security_invoker so RLS of the caller applies)
-- ============================================================================

-- Model catalogue for pickers: safe columns only.
create or replace view available_models with (security_invoker = true) as
  select id, display_name, description, provider, owner_user_id, max_output_tokens,
         supports_images, is_default,
         case when owner_user_id is null then 'platform' else 'mine' end as model_group
  from llm_models
  where is_enabled and (owner_user_id is null or owner_user_id = auth.uid());

-- Latest USD-based rate per currency (FX display).
create or replace view fx_latest with (security_invoker = true) as
  select distinct on (quote_currency) base_currency, quote_currency, rate, as_of, source
  from fx_rates
  order by quote_currency, as_of desc;

-- Admin usage dashboard: runs, tokens and failures by model and day.
create or replace view admin_usage_summary with (security_invoker = true) as
  select date_trunc('day', r.created_at)::date as day,
         r.llm_model_id,
         coalesce(m.display_name, r.model_id, 'unknown') as model_name,
         count(*) as runs,
         count(*) filter (where r.status = 'completed') as completed,
         count(*) filter (where r.status = 'partial') as partial,
         count(*) filter (where r.status = 'no_matches') as no_matches,
         count(*) filter (where r.status = 'failed') as failed,
         coalesce(sum(r.input_tokens), 0) as input_tokens,
         coalesce(sum(r.output_tokens), 0) as output_tokens,
         coalesce(sum(r.pages_fetched), 0) as pages_fetched,
         round(avg(extract(epoch from (r.finished_at - r.started_at)))::numeric, 1) as avg_duration_s
  from scout_runs r
  left join llm_models m on m.id = r.llm_model_id
  group by 1, 2, 3;

-- Per-retailer outcome of each child workflow.
create or replace view admin_retailer_usage with (security_invoker = true) as
  select date_trunc('day', r.created_at)::date as day,
         rr.key as retailer_code,
         coalesce(m.display_name, r.model_id, 'unknown') as model_name,
         count(*) as runs,
         count(*) filter (where rr.value ->> 'status' = 'completed') as completed,
         count(*) filter (where rr.value ->> 'status' = 'no_matches') as no_matches,
         count(*) filter (where rr.value ->> 'status' = 'failed') as failed,
         coalesce(sum((rr.value ->> 'matches')::int), 0) as matches,
         coalesce(sum((rr.value ->> 'input_tokens')::int), 0) as input_tokens,
         coalesce(sum((rr.value ->> 'output_tokens')::int), 0) as output_tokens
  from scout_runs r
  cross join lateral jsonb_each(r.retailer_results) rr
  left join llm_models m on m.id = r.llm_model_id
  group by 1, 2, 3;

-- Per-task token usage (background-task models).
create or replace view admin_task_usage with (security_invoker = true) as
  select date_trunc('day', r.created_at)::date as day,
         tm.key as task_key,
         tm.value ->> 'ref' as model_ref,
         count(*) as runs,
         coalesce(sum((tm.value ->> 'input_tokens')::int), 0) as input_tokens,
         coalesce(sum((tm.value ->> 'output_tokens')::int), 0) as output_tokens
  from scout_runs r
  cross join lateral jsonb_each(r.task_models) tm
  group by 1, 2, 3;

grant select on available_models, fx_latest, admin_usage_summary, admin_retailer_usage, admin_task_usage to authenticated;

-- ============================================================================
-- Realtime: the UI follows run progress live. llm_models is left out because its
-- column-level grants (secret_ref hidden) break Realtime's RLS check; the admin
-- UI polls while a model test is pending.
-- ============================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['wishlist_items','product_matches','scout_runs','notifications'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
