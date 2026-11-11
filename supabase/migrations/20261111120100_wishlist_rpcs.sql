-- AI Shopping Wishlist ("Scout") RPCs
-- Created: 2026-11-11
-- Spec: docs/specs/ai-shopping-wishlist.md (API Endpoints); ADR-0002 (outbox)
--
-- Three groups, each with explicit EXECUTE grants (Supabase grants new functions
-- to anon/authenticated by default, so every function below is revoked first):
--   * shopper RPCs   -> authenticated  (request_scout, decide_match, ...)
--   * admin RPCs     -> authenticated, re-checked with is_admin()
--   * worker RPCs    -> service_role only (claim_workflow_jobs, begin_scout_run, ...)
-- Error codes: WL400 invalid, WL403 forbidden, WL404 not found, WL409 active run, WL429 daily cap.

-- ============================================================================
-- Internal helpers
-- ============================================================================

-- Model resolution (FR-1b): wishlist model -> user default -> admin default; first enabled wins.
create or replace function resolve_model_for(p_wishlist_model_id uuid, p_user_id uuid)
returns table (llm_model_id uuid, fallback_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile_model uuid;
  v_wishlist llm_models;
  v_candidate uuid;
begin
  select model_id into v_profile_model from user_profiles where user_id = p_user_id;

  if p_wishlist_model_id is not null then
    select * into v_wishlist from llm_models where id = p_wishlist_model_id;
    if found and v_wishlist.is_enabled and (v_wishlist.owner_user_id is null or v_wishlist.owner_user_id = p_user_id) then
      return query select v_wishlist.id, null::text;
      return;
    end if;
  end if;

  select m.id into v_candidate from llm_models m
   where m.id = v_profile_model and m.is_enabled
     and (m.owner_user_id is null or m.owner_user_id = p_user_id);
  if v_candidate is null then
    select m.id into v_candidate from llm_models m where m.is_default and m.is_enabled;
  end if;

  return query select v_candidate,
    case when p_wishlist_model_id is not null and v_candidate is not null
         then format('%s is unavailable, using %s',
                     coalesce(v_wishlist.display_name, 'The selected model'),
                     (select display_name from llm_models where id = v_candidate))
         when v_candidate is null then 'No AI model is configured'
    end;
end;
$$;

create or replace function model_ref_json(p_model_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('llm_model_id', m.id, 'provider', m.provider, 'ref', m.bedrock_model_id,
                            'display_name', m.display_name, 'max_output_tokens', m.max_output_tokens,
                            'supports_images', m.supports_images, 'is_byom', m.owner_user_id is not null,
                            'connection', m.connection)
  from llm_models m where m.id = p_model_id
$$;

-- Recompute an item's status from its matches after a decision/run/stale check.
create or replace function recompute_item_status(p_item_id uuid, p_fallback text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_item wishlist_items;
  v_status text;
begin
  select * into v_item from wishlist_items where id = p_item_id for update;
  if not found then return null; end if;
  if v_item.status = 'archived' then return 'archived'; end if;

  if exists (select 1 from product_matches where wishlist_item_id = p_item_id and status = 'approved') then
    v_status := 'approved';
  elsif exists (select 1 from scout_runs where wishlist_item_id = p_item_id and status in ('queued','running')
                and trigger <> 'scheduled') then
    v_status := 'scouting';
  elsif exists (select 1 from product_matches where wishlist_item_id = p_item_id and status in ('proposed','saved')) then
    v_status := 'candidates_ready';
  elsif p_fallback is not null then
    v_status := p_fallback;
  elsif exists (select 1 from scout_runs where wishlist_item_id = p_item_id and status in ('completed','partial','no_matches')) then
    v_status := 'no_matches';
  else
    v_status := case when v_item.status = 'scouting' then 'draft' else v_item.status end;
  end if;

  if v_status is distinct from v_item.status then
    perform begin_trusted_rpc();
    update wishlist_items set status = v_status where id = p_item_id;
  end if;
  return v_status;
end;
$$;

-- Creates a scout run + outbox job in the caller's transaction (ADR-0002).
create or replace function enqueue_scout_run(
  p_item wishlist_items, p_trigger text, p_requested_by uuid, p_available_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile user_profiles;
  v_wishlist wishlists;
  v_country text;
  v_codes text[];
  v_run_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
begin
  select * into v_profile from user_profiles where user_id = p_item.user_id;
  select * into v_wishlist from wishlists where id = p_item.wishlist_id;
  v_country := upper(coalesce(p_item.constraints ->> 'ship_to_country', v_wishlist.ship_to_country, v_profile.country_code));
  select coalesce(array_agg(c order by c), '{}') into v_codes
    from unnest(coalesce(p_item.retailer_codes, v_profile.retailer_codes)) c
   where c = any(retailers_for_country(v_country));
  if cardinality(v_codes) = 0 then
    raise exception using errcode = 'WL400', message = 'None of the selected retailers are available for this country';
  end if;

  begin
    insert into scout_runs (id, wishlist_item_id, user_id, workflow_id, trigger, status, previous_item_status, retailer_codes)
    values (v_run_id, p_item.id, p_item.user_id, 'job-' || v_job_id, p_trigger, 'queued', p_item.status, v_codes);
  exception when unique_violation then
    raise exception using errcode = 'WL409', message = 'A search is already running for this item';
  end;

  insert into workflow_jobs (id, job_type, payload, requested_by, available_at)
  values (v_job_id, case when p_trigger = 'scheduled' then 'scheduled_rescout' else 'scout_item' end,
          jsonb_build_object('scout_run_id', v_run_id), p_requested_by, p_available_at);

  if p_trigger <> 'scheduled' and p_item.status <> 'approved' then
    perform begin_trusted_rpc();
    update wishlist_items set status = 'scouting' where id = p_item.id;
  end if;

  perform log_audit_event('scout_run', v_run_id, 'scout_run.requested',
    jsonb_build_object('trigger', p_trigger, 'retailers', v_codes, 'wishlist_item_id', p_item.id),
    p_item.user_id, 'job-' || v_job_id);

  return jsonb_build_object('scout_run_id', v_run_id, 'job_id', v_job_id, 'status', 'queued');
end;
$$;

-- ============================================================================
-- Shopper RPCs
-- ============================================================================

create or replace function request_scout(wishlist_item_id uuid, reason text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_item_id uuid := request_scout.wishlist_item_id;
  v_reason text := coalesce(request_scout.reason, 'manual');
  v_item wishlist_items;
  v_email text;
  v_used int;
  v_cap int;
begin
  if auth.uid() is null then
    raise exception using errcode = 'WL403', message = 'Sign in required';
  end if;
  if v_reason not in ('created','constraints_changed','manual') then
    raise exception using errcode = 'WL400', message = 'reason must be created, constraints_changed or manual';
  end if;

  select * into v_item from wishlist_items i where i.id = v_item_id for update;
  if not found or v_item.user_id <> auth.uid() then
    raise exception using errcode = 'WL403', message = 'Item not found';
  end if;
  if v_item.status = 'archived' then
    raise exception using errcode = 'WL400', message = 'Unarchive the item before searching';
  end if;
  if not exists (select 1 from user_profiles p where p.user_id = auth.uid() and p.onboarding_completed_at is not null) then
    raise exception using errcode = 'WL403', message = 'Finish onboarding first';
  end if;

  -- Rollout controls: feature flag + optional beta allowlist (by email).
  if app_setting('wishlist_scout_enabled', 'true'::jsonb) <> 'true'::jsonb then
    raise exception using errcode = 'WL403', message = 'Scouting is currently disabled';
  end if;
  if app_setting('scout_beta_allowlist_enabled', 'false'::jsonb) = 'true'::jsonb then
    select lower(email) into v_email from auth.users where id = auth.uid();
    if not (app_setting('scout_beta_allowlist', '[]'::jsonb) ? v_email) then
      raise exception using errcode = 'WL403', message = 'Scouting is in private beta';
    end if;
  end if;

  if exists (select 1 from scout_runs r where r.wishlist_item_id = v_item_id and r.status in ('queued','running')) then
    raise exception using errcode = 'WL409', message = 'A search is already running for this item';
  end if;

  v_cap := (app_setting('scout_daily_cap', '20'::jsonb))::text::int;
  select count(*) into v_used from scout_runs r
   where r.user_id = auth.uid() and r.trigger <> 'scheduled' and r.created_at >= date_trunc('day', now());
  if v_used >= v_cap then
    raise exception using errcode = 'WL429', message = format('Daily search limit reached (%s per day)', v_cap);
  end if;

  return enqueue_scout_run(v_item, v_reason, auth.uid());
end;
$$;

create or replace function decide_match(match_id uuid, decision text, reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_match product_matches;
  v_new_status text;
  v_item_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'WL403', message = 'Sign in required';
  end if;
  v_new_status := case decide_match.decision when 'approve' then 'approved' when 'reject' then 'rejected'
                                             when 'save' then 'saved' end;
  if v_new_status is null then
    raise exception using errcode = 'WL400', message = 'decision must be approve, reject or save';
  end if;

  select * into v_match from product_matches m where m.id = decide_match.match_id for update;
  if not found or v_match.user_id <> auth.uid() then
    raise exception using errcode = 'WL403', message = 'Match not found';
  end if;
  if v_match.status = 'unverified' then
    raise exception using errcode = 'WL400', message = 'Unverified matches cannot be reviewed';
  end if;
  if v_match.status = 'stale' and v_new_status = 'approved' then
    raise exception using errcode = 'WL400', message = 'This product is no longer available at the checked price';
  end if;

  update product_matches
     set status = v_new_status,
         decision_reason = nullif(trim(decide_match.reason), ''),
         decided_at = now(),
         decided_by = auth.uid()
   where id = v_match.id;

  v_item_status := recompute_item_status(v_match.wishlist_item_id);

  perform log_audit_event('product_match', v_match.id, 'match.' || v_new_status,
    jsonb_build_object('previous_status', v_match.status, 'reason', nullif(trim(decide_match.reason), ''),
                       'wishlist_item_id', v_match.wishlist_item_id),
    v_match.user_id);

  return jsonb_build_object('match_id', v_match.id, 'match_status', v_new_status, 'item_status', v_item_status);
end;
$$;

-- Model the wishlist will actually use, for the "model unavailable, using X" notice.
create or replace function resolve_wishlist_model(p_wishlist_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_model uuid;
  v_wishlist_model uuid;
  v_reason text;
begin
  if p_wishlist_id is not null then
    select model_id into v_wishlist_model from wishlists where id = p_wishlist_id and user_id = auth.uid();
    if not found then
      raise exception using errcode = 'WL403', message = 'Wishlist not found';
    end if;
  end if;
  select r.llm_model_id, r.fallback_reason into v_model, v_reason from resolve_model_for(v_wishlist_model, auth.uid()) r;
  return jsonb_build_object(
    'llm_model_id', v_model,
    'display_name', (select display_name from llm_models where id = v_model),
    'requested_model_id', v_wishlist_model,
    'fallback_reason', v_reason);
end;
$$;

create or replace function my_scout_quota() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', (select count(*) from scout_runs where user_id = auth.uid() and trigger <> 'scheduled'
             and created_at >= date_trunc('day', now())),
    'cap', (app_setting('scout_daily_cap', '20'::jsonb))::text::int,
    'enabled', app_setting('wishlist_scout_enabled', 'true'::jsonb) = 'true'::jsonb)
$$;

-- Creates the profile row if the auth trigger missed it (users created before the migration).
create or replace function ensure_my_profile() returns user_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_profile user_profiles;
  v_user auth.users;
begin
  if auth.uid() is null then
    raise exception using errcode = 'WL403', message = 'Sign in required';
  end if;
  select * into v_profile from user_profiles where user_id = auth.uid();
  if found then return v_profile; end if;
  select * into v_user from auth.users where id = auth.uid();
  insert into user_profiles (user_id, display_name, email, avatar_url)
  values (v_user.id,
          coalesce(v_user.raw_user_meta_data ->> 'full_name', v_user.raw_user_meta_data ->> 'name', split_part(v_user.email, '@', 1)),
          v_user.email, v_user.raw_user_meta_data ->> 'avatar_url')
  on conflict (user_id) do nothing
  returning * into v_profile;
  if v_profile.id is null then
    select * into v_profile from user_profiles where user_id = auth.uid();
  end if;
  return v_profile;
end;
$$;

create or replace function match_price_history(p_match_id uuid)
returns table (observed_at timestamptz, price numeric, currency text, availability text)
language sql stable security definer set search_path = public as $$
  select t.observed_at, (t.data_payload ->> 'price')::numeric, t.data_payload ->> 'currency', t.data_payload ->> 'availability'
  from product_matches m
  join entities e on e.entity_type = 'product_match' and e.source_record_id = m.id::text
  join time_series_points t on t.entity_id = e.id
  join fact_types f on f.id = t.fact_type_id and f.key = 'product_price'
  where m.id = p_match_id and m.user_id = auth.uid()
  order by t.observed_at
$$;

create or replace function mark_all_notifications_read() returns int
language sql security definer set search_path = public as $$
  with u as (update notifications set read_at = now() where user_id = auth.uid() and read_at is null returning 1)
  select count(*)::int from u
$$;

-- Data rights (GDPR/POPIA/Kenya DPA): export and delete everything we hold.
create or replace function export_my_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from user_profiles p where p.user_id = auth.uid()),
    'wishlists', coalesce((select jsonb_agg(to_jsonb(w)) from wishlists w where w.user_id = auth.uid()), '[]'),
    'wishlist_items', coalesce((select jsonb_agg(to_jsonb(i)) from wishlist_items i where i.user_id = auth.uid()), '[]'),
    'product_matches', coalesce((select jsonb_agg(to_jsonb(m)) from product_matches m where m.user_id = auth.uid()), '[]'),
    'scout_runs', coalesce((select jsonb_agg(to_jsonb(r)) from scout_runs r where r.user_id = auth.uid()), '[]'),
    'merchant_accounts', coalesce((select jsonb_agg(to_jsonb(a)) from merchant_accounts a where a.user_id = auth.uid()), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from notifications n where n.user_id = auth.uid()), '[]'),
    'audit_events', coalesce((select jsonb_agg(to_jsonb(e)) from audit_events e where e.subject_user_id = auth.uid()), '[]'))
$$;

create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'WL403', message = 'Sign in required';
  end if;
  -- Cascades to every user-owned table. Storage images and Phase 5 secrets join this path later.
  delete from auth.users where id = auth.uid();
end;
$$;

-- ============================================================================
-- Admin RPCs
-- ============================================================================

create or replace function require_admin() returns void language plpgsql stable as $$
begin
  if not is_admin() then
    raise exception using errcode = 'WL403', message = 'Admin role required';
  end if;
end;
$$;

create or replace function set_default_model(model_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_model llm_models;
begin
  perform require_admin();
  select * into v_model from llm_models m where m.id = set_default_model.model_id for update;
  if not found or v_model.owner_user_id is not null then
    raise exception using errcode = 'WL404', message = 'Model not found';
  end if;
  if not v_model.is_enabled then
    raise exception using errcode = 'WL400', message = 'Enable the model before making it the default';
  end if;
  update llm_models set is_default = false where is_default and id <> v_model.id;
  update llm_models set is_default = true where id = v_model.id;
  perform log_audit_event('llm_models', v_model.id, 'llm_models.set_default', jsonb_build_object('display_name', v_model.display_name));
end;
$$;

create or replace function enqueue_model_test(p_model_id uuid, p_requested_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id from workflow_jobs
   where job_type = 'model_test' and status in ('queued','dispatching') and payload ->> 'model_id' = p_model_id::text
   limit 1;
  if v_job_id is null then
    insert into workflow_jobs (job_type, payload, requested_by)
    values ('model_test', jsonb_build_object('model_id', p_model_id), p_requested_by)
    returning id into v_job_id;
  end if;
  return v_job_id;
end;
$$;

create or replace function request_model_test(model_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job_id uuid;
begin
  perform require_admin();
  if not exists (select 1 from llm_models m where m.id = request_model_test.model_id) then
    raise exception using errcode = 'WL404', message = 'Model not found';
  end if;
  v_job_id := enqueue_model_test(request_model_test.model_id, auth.uid());
  perform log_audit_event('llm_models', request_model_test.model_id, 'llm_models.test_requested', jsonb_build_object('job_id', v_job_id));
  return jsonb_build_object('job_id', v_job_id, 'status', 'queued');
end;
$$;

-- Saving a model (new, or with a changed ref) runs a test invocation automatically.
create or replace function auto_enqueue_model_test() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.bedrock_model_id is distinct from old.bedrock_model_id
     or new.provider is distinct from old.provider then
    perform enqueue_model_test(new.id, auth.uid());
  end if;
  return new;
end;
$$;
create trigger trg_llm_models_auto_test after insert or update of bedrock_model_id, provider on llm_models
  for each row execute function auto_enqueue_model_test();

create or replace function request_fx_refresh() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job_id uuid;
begin
  perform require_admin();
  insert into workflow_jobs (job_type, payload, requested_by) values ('refresh_fx_rates', '{}', auth.uid())
  returning id into v_job_id;
  return jsonb_build_object('job_id', v_job_id, 'status', 'queued');
end;
$$;

-- Promote the first admin. Not callable through the API: run it from psql / supabase CLI.
create or replace function promote_admin(p_email text) returns void
language sql security definer set search_path = public as $$
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
  where lower(email) = lower(p_email)
$$;

-- ============================================================================
-- Worker RPCs (service_role only)
-- ============================================================================

-- Outbox claim (ADR-0002): SKIP LOCKED, and reclaim rows stuck in 'dispatching' > 60 s.
create or replace function claim_workflow_jobs(p_limit int default 10) returns setof workflow_jobs
language sql security definer set search_path = public as $$
  update workflow_jobs
     set status = 'dispatching', claimed_at = now(), attempts = attempts + 1
   where id in (select id from workflow_jobs
                 where (status = 'queued' and available_at <= now())
                    or (status = 'dispatching' and claimed_at < now() - interval '60 seconds')
                 order by available_at
                 for update skip locked
                 limit greatest(p_limit, 1))
  returning *
$$;

create or replace function mark_job_dispatched(p_job_id uuid, p_workflow_id text) returns void
language sql security definer set search_path = public as $$
  update workflow_jobs set status = 'dispatched', workflow_id = p_workflow_id, dispatched_at = now(), last_error = null
  where id = p_job_id
$$;

-- Start failed: requeue with exponential backoff, or fail the job and its domain row.
create or replace function release_workflow_job(p_job_id uuid, p_error text, p_retryable boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_job workflow_jobs;
begin
  select * into v_job from workflow_jobs where id = p_job_id for update;
  if not found then return null; end if;

  if p_retryable and v_job.attempts < v_job.max_attempts then
    update workflow_jobs
       set status = 'queued', last_error = left(p_error, 2000),
           available_at = now() + make_interval(secs => least(300, 5 * power(2, greatest(v_job.attempts - 1, 0))))
     where id = p_job_id;
    return 'queued';
  end if;

  update workflow_jobs set status = 'failed', last_error = left(p_error, 2000) where id = p_job_id;
  if v_job.job_type in ('scout_item','scheduled_rescout') then
    perform finish_scout_run((v_job.payload ->> 'scout_run_id')::uuid, 'failed', '{}'::jsonb,
                             'Could not start the search: ' || left(p_error, 500));
  elsif v_job.job_type = 'model_test' then
    perform complete_model_test((v_job.payload ->> 'model_id')::uuid, false, 'Test could not start: ' || left(p_error, 500));
  end if;
  return 'failed';
end;
$$;

-- Marks the run running, resolves and snapshots models, and returns everything the
-- workflow needs. Idempotent: a retried activity gets the same snapshot back.
create or replace function begin_scout_run(p_scout_run_id uuid, p_workflow_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run scout_runs;
  v_item wishlist_items;
  v_wishlist wishlists;
  v_profile user_profiles;
  v_model uuid;
  v_reason text;
  v_is_byom boolean;
  v_task_models jsonb := '{}'::jsonb;
  v_task record;
  v_country text;
begin
  select * into v_run from scout_runs where id = p_scout_run_id for update;
  if not found then
    return jsonb_build_object('skip', true, 'reason', 'run not found');
  end if;
  if v_run.status not in ('queued','running') then
    return jsonb_build_object('skip', true, 'reason', 'run is ' || v_run.status);
  end if;

  select * into v_item from wishlist_items where id = v_run.wishlist_item_id;
  select * into v_wishlist from wishlists where id = v_item.wishlist_id;
  select * into v_profile from user_profiles where user_id = v_run.user_id;

  if v_run.status = 'queued' then
    select r.llm_model_id, r.fallback_reason into v_model, v_reason from resolve_model_for(v_wishlist.model_id, v_run.user_id) r;
    if v_model is null then
      perform finish_scout_run(v_run.id, 'failed', '{}'::jsonb, 'No AI model is configured. Ask an admin to enable one.');
      return jsonb_build_object('skip', true, 'reason', 'no model');
    end if;
    select owner_user_id is not null into v_is_byom from llm_models where id = v_model;

    -- Background-task resolution (FR-1d), snapshotted per run.
    v_task_models := jsonb_build_object('scout_agent', model_ref_json(v_model));
    for v_task in select t.task_key, t.model_id, m.is_enabled from llm_task_models t
                  left join llm_models m on m.id = t.model_id loop
      v_task_models := v_task_models || jsonb_build_object(v_task.task_key,
        case when v_is_byom then model_ref_json(v_model)
             when v_task.model_id is not null and v_task.is_enabled then model_ref_json(v_task.model_id)
             else model_ref_json(v_model) end);
    end loop;

    update scout_runs
       set status = 'running', started_at = now(), workflow_id = coalesce(p_workflow_id, workflow_id),
           llm_model_id = v_model, model_id = (select bedrock_model_id from llm_models where id = v_model),
           model_fallback_reason = v_reason, task_models = v_task_models
     where id = v_run.id
     returning * into v_run;

    perform log_audit_event('scout_run', v_run.id, 'scout_run.started',
      jsonb_build_object('llm_model_id', v_model, 'model_id', v_run.model_id, 'retailers', v_run.retailer_codes),
      v_run.user_id, v_run.workflow_id);
  end if;

  v_country := upper(coalesce(v_item.constraints ->> 'ship_to_country', v_wishlist.ship_to_country, v_profile.country_code));

  return jsonb_build_object(
    'skip', false,
    'scout_run_id', v_run.id,
    'workflow_id', v_run.workflow_id,
    'trigger', v_run.trigger,
    'user_id', v_run.user_id,
    'item', jsonb_build_object('id', v_item.id, 'title', v_item.title, 'description', v_item.description,
                               'reference_url', v_item.reference_url, 'max_price', v_item.max_price,
                               'currency', coalesce(v_item.currency, v_profile.currency),
                               'constraints', v_item.constraints, 'status', v_item.status),
    'wishlist', jsonb_build_object('id', v_wishlist.id, 'name', v_wishlist.name),
    'country_code', v_country,
    'profile_currency', v_profile.currency,
    'model', model_ref_json(v_run.llm_model_id) || jsonb_build_object('fallback_reason', v_run.model_fallback_reason),
    'task_models', v_run.task_models,
    'retailers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'display_name', r.display_name, 'adapter_key', r.adapter_key,
               'domain', r.country_domains ->> v_country,
               'is_cross_border', v_country = any(r.cross_border_countries),
               'rate_limit_per_min', r.rate_limit_per_min) order by r.code)
      from retailers r where r.code = any(v_run.retailer_codes)), '[]'),
    'preferences', jsonb_build_object(
      'approved', coalesce((select jsonb_agg(jsonb_build_object('title', m.title, 'brand', m.brand, 'price', m.price,
                                                                'currency', m.currency, 'retailer', m.retailer_code))
                            from (select * from product_matches where wishlist_item_id = v_item.id and status = 'approved'
                                  order by decided_at desc limit 10) m), '[]'),
      'rejected', coalesce((select jsonb_agg(jsonb_build_object('title', m.title, 'brand', m.brand, 'price', m.price,
                                                                'currency', m.currency, 'reason', m.decision_reason))
                            from (select * from product_matches where wishlist_item_id = v_item.id and status = 'rejected'
                                  order by decided_at desc limit 15) m), '[]')),
    'existing_matches', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'canonical_url', m.canonical_url, 'product_url', m.product_url,
                                          'status', m.status, 'price', m.price, 'currency', m.currency,
                                          'retailer_code', m.retailer_code))
      from product_matches m where m.wishlist_item_id = v_item.id), '[]'),
    'fx', coalesce((select jsonb_object_agg(quote_currency, jsonb_build_object('rate', rate, 'as_of', as_of))
                    from fx_latest where as_of >= current_date - 3), '{}'));
end;
$$;

create or replace function set_retailer_result(p_scout_run_id uuid, p_retailer_code text, p_result jsonb) returns void
language sql security definer set search_path = public as $$
  update scout_runs
     set retailer_results = retailer_results || jsonb_build_object(p_retailer_code,
           coalesce(retailer_results -> p_retailer_code, '{}'::jsonb) || p_result)
   where id = p_scout_run_id
$$;

-- Persist one candidate (verified -> proposed, else unverified), record price history,
-- and notify on new matches / price drops found by scheduled runs.
create or replace function record_candidate(p_candidate jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run scout_runs;
  v_item wishlist_items;
  v_existing product_matches;
  v_match product_matches;
  v_verified boolean := coalesce((p_candidate ->> 'verified')::boolean, false);
  v_price numeric := (p_candidate ->> 'price')::numeric;
  v_currency text := upper(nullif(p_candidate ->> 'currency', ''));
  v_is_new boolean := false;
  v_price_dropped boolean := false;
  v_entity_id uuid;
  v_fact_id uuid;
begin
  select * into v_run from scout_runs where id = (p_candidate ->> 'scout_run_id')::uuid;
  if not found then
    raise exception using errcode = 'WL404', message = 'Scout run not found';
  end if;
  select * into v_item from wishlist_items where id = v_run.wishlist_item_id;

  select * into v_existing from product_matches
   where wishlist_item_id = v_item.id and canonical_url = p_candidate ->> 'canonical_url' for update;

  if not found then
    insert into product_matches (
      wishlist_item_id, scout_run_id, user_id, retailer_code, store_domain, product_url, canonical_url, title,
      image_url, price, currency, availability, condition, gtin, mpn, brand, match_score, rationale,
      price_source, is_cross_border, price_may_vary, extracted, status, verified_at, first_seen_run_id)
    values (
      v_item.id, v_run.id, v_run.user_id, p_candidate ->> 'retailer_code', p_candidate ->> 'store_domain',
      p_candidate ->> 'product_url', p_candidate ->> 'canonical_url', left(p_candidate ->> 'title', 500),
      p_candidate ->> 'image_url', v_price, v_currency, coalesce(p_candidate ->> 'availability', 'unknown'),
      p_candidate ->> 'condition', p_candidate ->> 'gtin', p_candidate ->> 'mpn', p_candidate ->> 'brand',
      least(greatest(coalesce((p_candidate ->> 'match_score')::numeric, 0), 0), 1), left(p_candidate ->> 'rationale', 1500),
      p_candidate ->> 'price_source', coalesce((p_candidate ->> 'is_cross_border')::boolean, false),
      coalesce((p_candidate ->> 'price_may_vary')::boolean, false), coalesce(p_candidate -> 'extracted', '{}'::jsonb),
      case when v_verified then 'proposed' else 'unverified' end,
      case when v_verified then now() end, v_run.id)
    returning * into v_match;
    v_is_new := v_verified;
  else
    v_price_dropped := v_verified and v_existing.price is not null and v_price is not null
                       and v_existing.currency = v_currency and v_price < v_existing.price * 0.99;
    update product_matches set
      scout_run_id = v_run.id,
      product_url = p_candidate ->> 'product_url',
      title = left(coalesce(p_candidate ->> 'title', title), 500),
      image_url = coalesce(p_candidate ->> 'image_url', image_url),
      price = case when v_verified then v_price else price end,
      currency = case when v_verified then v_currency else currency end,
      availability = case when v_verified then coalesce(p_candidate ->> 'availability', 'unknown') else availability end,
      gtin = coalesce(p_candidate ->> 'gtin', gtin), mpn = coalesce(p_candidate ->> 'mpn', mpn),
      brand = coalesce(p_candidate ->> 'brand', brand),
      match_score = least(greatest(coalesce((p_candidate ->> 'match_score')::numeric, match_score, 0), 0), 1),
      rationale = coalesce(left(p_candidate ->> 'rationale', 1500), rationale),
      price_source = coalesce(p_candidate ->> 'price_source', price_source),
      price_may_vary = coalesce((p_candidate ->> 'price_may_vary')::boolean, price_may_vary),
      extracted = coalesce(p_candidate -> 'extracted', extracted),
      verified_at = case when v_verified then now() else verified_at end,
      status = case when v_verified and status in ('unverified','stale') then 'proposed' else status end
    where id = v_existing.id
    returning * into v_match;
    v_is_new := v_verified and v_existing.status = 'unverified';
  end if;

  if v_verified and v_price is not null then
    insert into entities (entity_type, source_record_id) values ('product_match', v_match.id::text)
    on conflict (entity_type, source_record_id) do update set updated_at = now()
    returning id into v_entity_id;
    select id into v_fact_id from fact_types where key = 'product_price';
    insert into time_series_points (entity_id, fact_type_id, observed_at, data_payload, source_id)
    values (v_entity_id, v_fact_id, now(),
            jsonb_build_object('price', v_price, 'currency', v_currency, 'availability', v_match.availability, 'match_id', v_match.id),
            v_run.id::text);
  end if;

  if v_run.trigger = 'scheduled' and (v_is_new or v_price_dropped) then
    insert into notifications (user_id, kind, title, body, data)
    values (v_run.user_id,
            case when v_price_dropped then 'price_drop' else 'new_match' end,
            case when v_price_dropped then format('Price drop: %s', v_item.title) else format('New match for %s', v_item.title) end,
            case when v_price_dropped then format('%s is now %s %s (was %s %s)', v_match.title, v_currency, v_price, v_existing.currency, v_existing.price)
                 else format('%s at %s', v_match.title, v_match.store_domain) end,
            jsonb_build_object('wishlist_item_id', v_item.id, 'wishlist_id', v_item.wishlist_id, 'match_id', v_match.id));
  end if;

  return jsonb_build_object('match_id', v_match.id, 'status', v_match.status, 'is_new', v_is_new, 'price_dropped', v_price_dropped);
end;
$$;

create or replace function mark_match_stale(p_match_id uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_match product_matches;
  v_item wishlist_items;
begin
  select * into v_match from product_matches where id = p_match_id for update;
  if not found or v_match.status not in ('proposed','approved','saved') then
    return coalesce(v_match.status, 'missing');
  end if;
  update product_matches set status = 'stale', extracted = extracted || jsonb_build_object('stale_reason', p_reason)
   where id = p_match_id;
  select * into v_item from wishlist_items where id = v_match.wishlist_item_id;
  if v_match.status = 'approved' then
    insert into notifications (user_id, kind, title, body, data)
    values (v_match.user_id, 'match_stale', format('Your pick for %s changed', v_item.title),
            format('%s: %s. Run a new search to find alternatives.', v_match.title, p_reason),
            jsonb_build_object('wishlist_item_id', v_item.id, 'wishlist_id', v_item.wishlist_id, 'match_id', v_match.id));
  end if;
  perform recompute_item_status(v_match.wishlist_item_id);
  return 'stale';
end;
$$;

create or replace function finish_scout_run(p_scout_run_id uuid, p_status text, p_stats jsonb default '{}'::jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run scout_runs;
  v_item wishlist_items;
  v_task text;
  v_task_models jsonb;
  v_item_status text;
  v_recent_failures int;
  v_retry jsonb;
begin
  if p_status not in ('completed','partial','no_matches','failed','cancelled') then
    raise exception using errcode = 'WL400', message = 'invalid final status ' || p_status;
  end if;
  select * into v_run from scout_runs where id = p_scout_run_id for update;
  if not found then return jsonb_build_object('skip', true); end if;
  if v_run.status not in ('queued','running') then
    return jsonb_build_object('skip', true, 'status', v_run.status);  -- already finished (idempotent)
  end if;

  -- Merge per-task token usage into the run's model snapshot.
  v_task_models := v_run.task_models;
  for v_task in select jsonb_object_keys(coalesce(p_stats -> 'task_models', '{}'::jsonb)) loop
    v_task_models := v_task_models || jsonb_build_object(v_task,
      coalesce(v_task_models -> v_task, '{}'::jsonb) || (p_stats -> 'task_models' -> v_task));
  end loop;

  update scout_runs set
    status = p_status,
    finished_at = now(),
    started_at = coalesce(started_at, now()),
    error = left(p_error, 2000),
    input_tokens = coalesce((p_stats ->> 'input_tokens')::int, input_tokens),
    output_tokens = coalesce((p_stats ->> 'output_tokens')::int, output_tokens),
    tool_calls = coalesce((p_stats ->> 'tool_calls')::int, tool_calls),
    pages_fetched = coalesce((p_stats ->> 'pages_fetched')::int, pages_fetched),
    task_models = v_task_models,
    retailer_results = retailer_results || coalesce(p_stats -> 'retailer_results', '{}'::jsonb)
  where id = v_run.id;

  perform begin_trusted_rpc();
  update wishlist_items set last_scouted_at = now() where id = v_run.wishlist_item_id;
  v_item_status := recompute_item_status(v_run.wishlist_item_id,
    case when p_status in ('failed','cancelled') then
           case when coalesce(v_run.previous_item_status, 'scouting') = 'scouting' then 'draft' else v_run.previous_item_status end
         when p_status = 'no_matches' then 'no_matches' end);

  perform log_audit_event('scout_run', v_run.id, 'scout_run.' || case when p_status = 'failed' then 'failed' else 'completed' end,
    jsonb_build_object('status', p_status, 'error', left(p_error, 500), 'input_tokens', p_stats -> 'input_tokens',
                       'output_tokens', p_stats -> 'output_tokens'),
    v_run.user_id, v_run.workflow_id);

  -- Transient failures (Bedrock throttling/outage) retry automatically, at most 2 times in a row.
  if p_status = 'failed' and (p_stats ->> 'retry_after_seconds') is not null then
    select count(*) into v_recent_failures from (
      select status from scout_runs where wishlist_item_id = v_run.wishlist_item_id
      order by created_at desc limit 3) r where r.status = 'failed';
    select * into v_item from wishlist_items where id = v_run.wishlist_item_id;
    if v_recent_failures < 3 and v_item.status <> 'archived' then
      v_retry := enqueue_scout_run(v_item, v_run.trigger, null,
                                   now() + make_interval(secs => (p_stats ->> 'retry_after_seconds')::int));
    end if;
  end if;

  if p_status = 'failed' and v_run.trigger <> 'scheduled' then
    select * into v_item from wishlist_items where id = v_run.wishlist_item_id;
    insert into notifications (user_id, kind, title, body, data)
    values (v_run.user_id, 'run_failed', format('Search for %s didn''t finish', v_item.title),
            case when v_retry is not null then 'Search is temporarily unavailable, we''ll retry automatically.'
                 else coalesce(left(p_error, 300), 'Search is temporarily unavailable.') end,
            jsonb_build_object('wishlist_item_id', v_item.id, 'wishlist_id', v_item.wishlist_id, 'scout_run_id', v_run.id));
  end if;

  return jsonb_build_object('item_status', v_item_status, 'retry', v_retry);
end;
$$;

create or replace function model_test_context(p_model_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select model_ref_json(p_model_id)
$$;

create or replace function complete_model_test(p_model_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update llm_models set last_test_at = now(), last_test_ok = p_ok, last_test_error = case when p_ok then null else left(p_error, 1000) end
   where id = p_model_id;
  insert into audit_events (entity_type, entity_id, event_type, data)
  values ('llm_models', p_model_id, 'llm_models.tested', jsonb_build_object('ok', p_ok, 'error', left(p_error, 500)));
end;
$$;

-- First platform model from BEDROCK_BOOTSTRAP_MODEL_ID so a fresh install works
-- before an admin has configured anything. No-op once any platform model exists.
create or replace function bootstrap_platform_model(p_ref text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_ref is null or trim(p_ref) = '' or exists (select 1 from llm_models where owner_user_id is null) then
    return null;
  end if;
  insert into llm_models (display_name, description, bedrock_model_id, is_enabled, is_default, last_test_ok, last_test_at)
  values (coalesce(p_display_name, 'Default model'), 'Configured at install time', trim(p_ref), true, true, true, now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function upsert_fx_rates(p_as_of date, p_source text, p_rates jsonb, p_base text default 'USD') returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into fx_rates (base_currency, quote_currency, rate, as_of, source)
  select upper(p_base), upper(key), value::text::numeric, p_as_of, p_source
  from jsonb_each(p_rates)
  where jsonb_typeof(value) = 'number' and value::text::numeric > 0
  on conflict (base_currency, quote_currency, as_of) do update set rate = excluded.rate, source = excluded.source;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Store discovery cache (spec: Store discovery, step 1). Seeds first.
create or replace function find_shopify_stores(p_categories text[], p_country text, p_limit int default 8)
returns setof shopify_stores language sql stable security definer set search_path = public as $$
  select * from shopify_stores
  where status <> 'blocked'
    and upper(p_country) = any(ships_to)
    and (coalesce(cardinality(p_categories), 0) = 0 or categories && p_categories)
  order by (status = 'seed') desc, quality_score desc nulls last, last_checked_at desc nulls last
  limit greatest(p_limit, 1)
$$;

-- Saves a checked store. Admin decisions (seed/blocked) are never overwritten.
create or replace function upsert_shopify_store(p_store jsonb) returns shopify_stores
language plpgsql security definer set search_path = public as $$
declare
  v_row shopify_stores;
begin
  insert into shopify_stores (domain, display_name, ships_to, currency, categories, quality_score,
                              discovered_by_run_id, last_checked_at, check_details)
  values (lower(p_store ->> 'domain'), p_store ->> 'display_name',
          coalesce((select array_agg(distinct upper(x)) from jsonb_array_elements_text(p_store -> 'ships_to') x), '{}'),
          upper(p_store ->> 'currency'),
          coalesce((select array_agg(distinct x) from jsonb_array_elements_text(p_store -> 'categories') x), '{}'),
          (p_store ->> 'quality_score')::numeric, (p_store ->> 'discovered_by_run_id')::uuid, now(),
          coalesce(p_store -> 'check_details', '{}'::jsonb))
  on conflict (domain) do update set
    display_name = coalesce(excluded.display_name, shopify_stores.display_name),
    ships_to = (select array_agg(distinct x) from unnest(shopify_stores.ships_to || excluded.ships_to) x),
    currency = coalesce(excluded.currency, shopify_stores.currency),
    categories = (select array_agg(distinct x) from unnest(shopify_stores.categories || excluded.categories) x),
    quality_score = coalesce(excluded.quality_score, shopify_stores.quality_score),
    last_checked_at = now(),
    check_details = excluded.check_details
  returning * into v_row;
  return v_row;
end;
$$;

-- Scheduled re-scouts (FR-10): called hourly by the worker's Temporal Schedule.
create or replace function enqueue_due_rescouts(p_limit int default 100) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_item wishlist_items;
  v_count int := 0;
begin
  for v_item in
    select i.* from wishlist_items i
    join user_profiles p on p.user_id = i.user_id and p.onboarding_completed_at is not null
    where i.rescout_frequency <> 'off'
      and i.status not in ('archived','draft')
      and (i.last_scouted_at is null
           or i.last_scouted_at < now() - case i.rescout_frequency when 'daily' then interval '1 day' else interval '7 days' end)
      and not exists (select 1 from scout_runs r where r.wishlist_item_id = i.id and r.status in ('queued','running'))
    order by i.last_scouted_at nulls first
    limit greatest(p_limit, 1)
    for update of i skip locked
  loop
    begin
      perform enqueue_scout_run(v_item, 'scheduled', null);
      v_count := v_count + 1;
    exception when sqlstate 'WL400' or sqlstate 'WL409' then
      null;  -- retailers no longer available / raced with a manual run: skip this item
    end;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
do $$
declare
  f text;
  shopper text[] := array[
    'request_scout(uuid, text)', 'decide_match(uuid, text, text)', 'resolve_wishlist_model(uuid)',
    'my_scout_quota()', 'ensure_my_profile()', 'match_price_history(uuid)', 'mark_all_notifications_read()',
    'export_my_data()', 'delete_my_account()', 'retailers_for_country(text)',
    -- admin RPCs re-check is_admin() inside
    'set_default_model(uuid)', 'request_model_test(uuid)', 'request_fx_refresh()'];
  worker text[] := array[
    'claim_workflow_jobs(int)', 'mark_job_dispatched(uuid, text)', 'release_workflow_job(uuid, text, boolean)',
    'begin_scout_run(uuid, text)', 'set_retailer_result(uuid, text, jsonb)', 'record_candidate(jsonb)',
    'mark_match_stale(uuid, text)', 'finish_scout_run(uuid, text, jsonb, text)', 'model_test_context(uuid)',
    'complete_model_test(uuid, boolean, text)', 'bootstrap_platform_model(text, text)',
    'upsert_fx_rates(date, text, jsonb, text)', 'find_shopify_stores(text[], text, int)',
    'upsert_shopify_store(jsonb)', 'enqueue_due_rescouts(int)'];
  internal text[] := array[
    'resolve_model_for(uuid, uuid)', 'model_ref_json(uuid)', 'recompute_item_status(uuid, text)',
    'enqueue_scout_run(wishlist_items, text, uuid, timestamptz)', 'enqueue_model_test(uuid, uuid)',
    'promote_admin(text)', 'require_admin()', 'app_setting(text, jsonb)', 'log_audit_event(text, uuid, text, jsonb, uuid, text)',
    'begin_trusted_rpc()', 'in_trusted_rpc()', 'is_service_context()'];
begin
  foreach f in array shopper || worker || internal loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array shopper loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array worker loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- promote_admin stays postgres-only (no API path to grant admin, ADR-0007).
  foreach f in array internal loop
    if f <> 'promote_admin(text)' then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end;
$$;

-- RLS policies call is_admin() as the end user; the other helpers only run inside
-- security-definer functions and triggers.
grant execute on function public.is_admin() to anon, authenticated, service_role;
