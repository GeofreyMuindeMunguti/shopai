/**
 * TanStack Query hooks for the Scout domain.
 * CRUD goes straight through PostgREST under RLS; anything with a state
 * machine (scouting, decisions, defaults, tests) is an RPC.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '@/hooks/useAuth';
import { toastError } from '@/lib/errors';
import { buildFxTable } from '@/lib/fx';
import type {
  AppNotification,
  AvailableModel,
  Decision,
  FxLatest,
  MerchantAccount,
  PriceObservation,
  ProductMatch,
  ResolvedModel,
  Retailer,
  ScoutQuota,
  ScoutRun,
  UserProfile,
  Wishlist,
  WishlistItem,
} from './types';

async function unwrap<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

export const RETAILER_COLUMNS = 'id, code, display_name, adapter_key, country_domains, cross_border_countries, is_enabled, rate_limit_per_min';

// ---------------------------------------------------------------------------
// Profile, catalogue, FX
// ---------------------------------------------------------------------------

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    // ensure_my_profile creates the row if the auth trigger missed it.
    queryFn: () => unwrap<UserProfile>(supabase.rpc('ensure_my_profile')),
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (patch: Partial<UserProfile>) =>
      unwrap<UserProfile>(supabase.from('user_profiles').update(patch).eq('user_id', user!.id).select().single()),
    onSuccess: (profile) => qc.setQueryData(['profile', user?.id], profile),
    onError: (e) => toastError(e, 'Could not save your settings'),
  });
}

export function useRetailers() {
  return useQuery({
    queryKey: ['retailers'],
    queryFn: () => unwrap<Retailer[]>(supabase.from('retailers').select(RETAILER_COLUMNS).order('display_name')),
    staleTime: 5 * 60_000,
  });
}

export function useAvailableModels() {
  return useQuery({
    queryKey: ['available_models'],
    queryFn: () =>
      unwrap<AvailableModel[]>(supabase.from('available_models').select('*').order('display_name')),
    staleTime: 60_000,
  });
}

export function useFx() {
  return useQuery({
    queryKey: ['fx_latest'],
    queryFn: async () => buildFxTable(await unwrap<FxLatest[]>(supabase.from('fx_latest').select('*'))),
    staleTime: 60 * 60_000,
  });
}

export function useQuota() {
  return useQuery({
    queryKey: ['quota'],
    queryFn: () => unwrap<ScoutQuota>(supabase.rpc('my_scout_quota')),
  });
}

// ---------------------------------------------------------------------------
// Wishlists & items
// ---------------------------------------------------------------------------

export type WishlistWithCount = Wishlist & { wishlist_items: { count: number }[] };

export function useWishlists() {
  return useQuery({
    queryKey: ['wishlists'],
    queryFn: () =>
      unwrap<WishlistWithCount[]>(
        supabase.from('wishlists').select('*, wishlist_items(count)').eq('is_archived', false).order('created_at', { ascending: false })
      ),
  });
}

export function useWishlist(id: string) {
  return useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => unwrap<Wishlist>(supabase.from('wishlists').select('*').eq('id', id).single()),
  });
}

export function useResolvedModel(wishlistId: string | null) {
  return useQuery({
    queryKey: ['resolved_model', wishlistId],
    queryFn: () => unwrap<ResolvedModel>(supabase.rpc('resolve_wishlist_model', { p_wishlist_id: wishlistId })),
  });
}

export interface WishlistInput {
  name: string;
  description?: string | null;
  model_id: string | null;
  ship_to_country?: string | null;
  default_currency?: string;
}

export function useSaveWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: WishlistInput & { id?: string }) =>
      id
        ? unwrap<Wishlist>(supabase.from('wishlists').update(input).eq('id', id).select().single())
        : unwrap<Wishlist>(supabase.from('wishlists').insert(input).select().single()),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['wishlists'] });
      qc.invalidateQueries({ queryKey: ['wishlist', w.id] });
      qc.invalidateQueries({ queryKey: ['resolved_model', w.id] });
    },
    onError: (e) => toastError(e, 'Could not save the wishlist'),
  });
}

export function useItems(wishlistId: string) {
  return useQuery({
    queryKey: ['items', wishlistId],
    queryFn: () =>
      unwrap<WishlistItem[]>(
        supabase.from('wishlist_items').select('*').eq('wishlist_id', wishlistId).order('created_at', { ascending: false })
      ),
  });
}

export function useMatches(wishlistId: string) {
  return useQuery({
    queryKey: ['matches', wishlistId],
    queryFn: async () => {
      const rows = await unwrap<(ProductMatch & { wishlist_items?: unknown })[]>(
        supabase
          .from('product_matches')
          .select('*, wishlist_items!inner(wishlist_id)')
          .eq('wishlist_items.wishlist_id', wishlistId)
      );
      return rows.map(({ wishlist_items: _join, ...m }) => m as ProductMatch);
    },
  });
}

export function useRuns(wishlistId: string) {
  return useQuery({
    queryKey: ['runs', wishlistId],
    queryFn: async () => {
      const rows = await unwrap<(ScoutRun & { wishlist_items?: unknown })[]>(
        supabase
          .from('scout_runs')
          .select('*, wishlist_items!inner(wishlist_id)')
          .eq('wishlist_items.wishlist_id', wishlistId)
          .order('created_at', { ascending: false })
          .limit(200)
      );
      return rows.map(({ wishlist_items: _join, ...r }) => r as ScoutRun);
    },
  });
}

export type ItemInput = Pick<
  WishlistItem,
  'title' | 'description' | 'reference_url' | 'max_price' | 'currency' | 'constraints' | 'retailer_codes' | 'rescout_frequency'
>;

export function useRequestScout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { itemId: string; reason: 'created' | 'constraints_changed' | 'manual' }) =>
      unwrap<{ scout_run_id: string; job_id: string; status: string }>(
        supabase.rpc('request_scout', { wishlist_item_id: args.itemId, reason: args.reason })
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['quota'] });
    },
    onError: (e) => toastError(e, 'Could not start the search'),
  });
}

export function useCreateItem(wishlistId: string) {
  const qc = useQueryClient();
  const scout = useRequestScout();
  return useMutation({
    mutationFn: async (input: ItemInput) => {
      const item = await unwrap<WishlistItem>(
        supabase.from('wishlist_items').insert({ ...input, wishlist_id: wishlistId }).select().single()
      );
      // Saving an item starts a scout run automatically. If that fails (e.g. daily cap)
      // the item stays a draft and the error is shown.
      await scout.mutateAsync({ itemId: item.id, reason: 'created' }).catch(() => undefined);
      return item;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items', wishlistId] }),
    onError: (e) => toastError(e, 'Could not add the item'),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<WishlistItem> & { id: string }) =>
      unwrap<WishlistItem>(supabase.from('wishlist_items').update(patch).eq('id', id).select().single()),
    onSuccess: (item) => qc.invalidateQueries({ queryKey: ['items', item.wishlist_id] }),
    onError: (e) => toastError(e, 'Could not update the item'),
  });
}

export function useDecideMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { matchId: string; decision: Decision; reason?: string | null }) =>
      unwrap<{ match_id: string; match_status: string; item_status: string }>(
        supabase.rpc('decide_match', { match_id: args.matchId, decision: args.decision, reason: args.reason ?? null })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (e) => toastError(e, 'Could not save your decision'),
  });
}

export function usePriceHistory(matchId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['price_history', matchId],
    enabled,
    queryFn: () => unwrap<PriceObservation[]>(supabase.rpc('match_price_history', { p_match_id: matchId })),
  });
}

// ---------------------------------------------------------------------------
// Linked accounts & notifications
// ---------------------------------------------------------------------------

export function useMerchantAccounts() {
  return useQuery({
    queryKey: ['merchant_accounts'],
    queryFn: () => unwrap<MerchantAccount[]>(supabase.from('merchant_accounts').select('*').order('retailer_code')),
  });
}

export function useLinkAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Pick<MerchantAccount, 'retailer_code' | 'account_email' | 'login_method'>[]) =>
      unwrap<MerchantAccount[]>(
        supabase
          .from('merchant_accounts')
          .upsert(rows.map((r) => ({ ...r, status: 'linked' })), { onConflict: 'user_id,retailer_code' })
          .select()
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant_accounts'] }),
    onError: (e) => toastError(e, 'Could not link the account'),
  });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: Boolean(user),
    queryFn: () =>
      unwrap<AppNotification[]>(
        supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
      ),
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      id === 'all'
        ? unwrap<number>(supabase.rpc('mark_all_notifications_read'))
        : unwrap<unknown>(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toastError(e),
  });
}

export { unwrap };
