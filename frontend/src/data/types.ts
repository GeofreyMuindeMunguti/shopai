/**
 * Row types for the Scout domain tables and views.
 * Mirrors supabase/migrations/20261111120000_wishlist_domain.sql.
 */

export type CountryCode = 'KE' | 'US' | 'ZA';
export type CurrencyCode = 'KES' | 'USD' | 'ZAR';

export type ItemStatus = 'draft' | 'scouting' | 'candidates_ready' | 'no_matches' | 'approved' | 'archived';
export type MatchStatus = 'unverified' | 'proposed' | 'approved' | 'rejected' | 'saved' | 'stale';
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'no_matches' | 'failed' | 'cancelled';
export type Condition = 'new' | 'used' | 'refurb' | 'any';
export type RescoutFrequency = 'off' | 'daily' | 'weekly';
export type Decision = 'approve' | 'reject' | 'save';

export interface UserProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  country_code: CountryCode | null;
  currency: CurrencyCode | null;
  retailer_codes: string[];
  model_id: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Retailer {
  id: string;
  code: string;
  display_name: string;
  adapter_key: string;
  country_domains: Record<string, string>;
  cross_border_countries: string[];
  is_enabled: boolean;
  rate_limit_per_min: number;
}

/** Row of the `available_models` view (safe columns only). */
export interface AvailableModel {
  id: string;
  display_name: string;
  description: string | null;
  provider: string;
  owner_user_id: string | null;
  max_output_tokens: number;
  supports_images: boolean;
  is_default: boolean;
  model_group: 'platform' | 'mine';
}

/** Admin view of llm_models (every column except secret_ref). */
export interface LlmModel {
  id: string;
  display_name: string;
  description: string | null;
  provider: string;
  bedrock_model_id: string;
  owner_user_id: string | null;
  connection: Record<string, unknown>;
  supports_tools: boolean;
  max_output_tokens: number;
  supports_images: boolean;
  cost_note: string | null;
  is_enabled: boolean;
  is_default: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export const LLM_MODEL_COLUMNS =
  'id, display_name, description, provider, bedrock_model_id, owner_user_id, connection, supports_tools, max_output_tokens, supports_images, cost_note, is_enabled, is_default, last_test_at, last_test_ok, last_test_error, created_at, updated_at';

export interface Wishlist {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  default_currency: string;
  ship_to_country: CountryCode | null;
  model_id: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemConstraints {
  brands?: string[];
  exclude_brands?: string[];
  condition?: Condition;
  attributes?: Record<string, string>;
  ship_to_country?: CountryCode;
}

export interface WishlistItem {
  id: string;
  wishlist_id: string;
  user_id: string;
  title: string;
  description: string | null;
  reference_url: string | null;
  image_path: string | null;
  max_price: number | null;
  currency: string | null;
  constraints: ItemConstraints;
  retailer_codes: string[] | null;
  status: ItemStatus;
  rescout_frequency: RescoutFrequency;
  last_scouted_at: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface RetailerResult {
  status?: string; // queued | running | retrying | completed | no_matches | failed | skipped
  matches?: number;
  error?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ScoutRun {
  id: string;
  wishlist_item_id: string;
  user_id: string;
  workflow_id: string;
  trigger: 'created' | 'constraints_changed' | 'manual' | 'scheduled';
  status: RunStatus;
  llm_model_id: string | null;
  model_id: string | null;
  model_fallback_reason: string | null;
  retailer_codes: string[];
  retailer_results: Record<string, RetailerResult>;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ProductMatch {
  id: string;
  wishlist_item_id: string;
  scout_run_id: string | null;
  user_id: string;
  retailer_code: string;
  store_domain: string;
  product_url: string;
  canonical_url: string;
  title: string;
  image_url: string | null;
  price: number | null;
  currency: string | null;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown' | null;
  condition: string | null;
  gtin: string | null;
  mpn: string | null;
  brand: string | null;
  match_score: number | null;
  rationale: string | null;
  price_source: string | null;
  is_cross_border: boolean;
  price_may_vary: boolean;
  extracted: Record<string, unknown>;
  status: MatchStatus;
  decision_reason: string | null;
  decided_at: string | null;
  verified_at: string | null;
  first_seen_run_id: string | null;
  /** Set by merge_and_rank when a run finishes: 1 = best overall. Null while a run is in progress. */
  rank: number | null;
  best_for_retailer: boolean;
  /** Cross-retailer duplicate (same GTIN/MPN/canonical product); hidden in the UI. */
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantAccount {
  id: string;
  user_id: string;
  retailer_code: string;
  account_email: string;
  login_method: 'google_sso' | 'email';
  status: 'linked' | 'unlinked';
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  kind: 'new_match' | 'price_drop' | 'model_fallback' | 'run_failed' | 'match_stale' | 'info';
  title: string;
  body: string | null;
  data: { wishlist_item_id?: string; wishlist_id?: string; match_id?: string; [k: string]: unknown };
  read_at: string | null;
  created_at: string;
}

export interface FxLatest {
  base_currency: string;
  quote_currency: string;
  rate: number;
  as_of: string;
  source: string;
}

export interface ResolvedModel {
  llm_model_id: string | null;
  display_name: string | null;
  requested_model_id: string | null;
  fallback_reason: string | null;
}

export interface ScoutQuota {
  used: number;
  cap: number;
  enabled: boolean;
}

export interface ShopifyStore {
  id: string;
  domain: string;
  display_name: string | null;
  ships_to: string[];
  currency: string | null;
  categories: string[];
  quality_score: number | null;
  status: 'seed' | 'discovered' | 'blocked';
  last_checked_at: string | null;
  created_at: string;
}

export interface WorkflowJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  requested_by: string | null;
  status: 'queued' | 'dispatching' | 'dispatched' | 'failed' | 'cancelled';
  workflow_id: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  last_error: string | null;
  created_at: string;
}

export interface AppSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

export interface TaskModel {
  id: string;
  task_key: string;
  model_id: string | null;
}

export interface PriceObservation {
  observed_at: string;
  price: number;
  currency: string;
  availability: string | null;
}
