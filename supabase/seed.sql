-- Seed data for the AI Shopping Wishlist ("Scout").
-- Loaded after migrations by `supabase db reset`. Idempotent.
-- The first llm_models row is NOT seeded here: SQL seeds can't read env vars, so the
-- worker calls bootstrap_platform_model(BEDROCK_BOOTSTRAP_MODEL_ID) at startup.

-- Launch retailers and market matrix (spec: Launch markets). Temu is US-only.
insert into retailers (code, display_name, adapter_key, country_domains, cross_border_countries, rate_limit_per_min)
values
  ('takealot', 'Takealot', 'takealot', '{"ZA": "takealot.com"}', '{}', 20),
  ('amazon',   'Amazon',   'amazon',   '{"US": "amazon.com", "KE": "amazon.com", "ZA": "amazon.co.za"}', '{KE}', 20),
  ('temu',     'Temu',     'temu',     '{"US": "temu.com"}', '{}', 6),
  ('jumia',    'Jumia',    'jumia',    '{"KE": "jumia.co.ke"}', '{}', 20),
  ('shopify',  'Independent stores (Shopify)', 'shopify', '{"KE": "*", "US": "*", "ZA": "*"}', '{}', 30)
on conflict (code) do nothing;

-- Background-task model mappings start as "use wishlist model" (null).
insert into llm_task_models (task_key, model_id)
values ('category_inference', null), ('discovery_queries', null), ('attribute_extraction', null),
       ('preference_summary', null), ('cross_retailer_rerank', null)
on conflict (task_key) do nothing;

-- Price history fact type (time_series_points, FR-11).
insert into fact_types (key, label, description, unit)
values ('product_price', 'Product price', 'Verified price observation of a product match', 'currency')
on conflict (key) do nothing;

-- Rollout and cost controls (FR-13, Rollout Plan). Editable by admins.
insert into app_settings (key, value, description)
values
  ('wishlist_scout_enabled', 'true', 'Feature flag: allow new scout runs'),
  ('scout_beta_allowlist_enabled', 'false', 'Only allow emails in scout_beta_allowlist to run scouts'),
  ('scout_beta_allowlist', '[]', 'Lower-case emails allowed during beta'),
  ('scout_daily_cap', '30', 'Max user-initiated scout runs per user per day')
on conflict (key) do nothing;
