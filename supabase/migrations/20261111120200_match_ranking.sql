-- Persist merge_and_rank output on product_matches (FR-4).
-- Created: 2026-11-11
-- rank / best_for_retailer drive the UI ordering and the best-per-retailer guarantee;
-- duplicate_of hides same-store duplicates of an undecided candidate.

alter table product_matches add column if not exists rank int;
alter table product_matches add column if not exists best_for_retailer boolean not null default false;
alter table product_matches add column if not exists duplicate_of uuid references product_matches(id) on delete set null;

create or replace function apply_scout_ranking(p_scout_run_id uuid, p_ranking jsonb, p_duplicates jsonb default '[]'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_item_id uuid;
  v_count int;
begin
  select wishlist_item_id into v_item_id from scout_runs where id = p_scout_run_id;
  if v_item_id is null then
    raise exception using errcode = 'WL404', message = 'Scout run not found';
  end if;

  -- Ranking is per item: reset, then apply this run's merged list.
  update product_matches set rank = null, best_for_retailer = false where wishlist_item_id = v_item_id;
  update product_matches m
     set rank = (r ->> 'rank')::int,
         best_for_retailer = coalesce((r ->> 'best_for_retailer')::boolean, false)
    from jsonb_array_elements(coalesce(p_ranking, '[]'::jsonb)) r
   where m.id = (r ->> 'match_id')::uuid and m.wishlist_item_id = v_item_id;
  get diagnostics v_count = row_count;

  -- Only undecided candidates are hidden; a user's decision always stays visible.
  update product_matches m
     set duplicate_of = (d ->> 'duplicate_of')::uuid
    from jsonb_array_elements(coalesce(p_duplicates, '[]'::jsonb)) d
   where m.id = (d ->> 'match_id')::uuid and m.wishlist_item_id = v_item_id
     and m.status in ('proposed','unverified') and (d ->> 'duplicate_of')::uuid <> m.id;
  return v_count;
end;
$$;

revoke execute on function public.apply_scout_ranking(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_scout_ranking(uuid, jsonb, jsonb) to service_role;
