/**
 * Supabase Realtime subscriptions → TanStack Query invalidation.
 * RLS applies to postgres_changes, so filtering by user_id is a bandwidth
 * optimisation, not the security boundary.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/data/supabase';
import type { AppNotification } from '@/data/types';

/** Live scouting progress for one wishlist: items, runs and matches fill in as they're verified. */
export function useWishlistRealtime(wishlistId: string, userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`wishlist-${wishlistId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_matches', filter }, () =>
        qc.invalidateQueries({ queryKey: ['matches', wishlistId] })
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scout_runs', filter }, () => {
        qc.invalidateQueries({ queryKey: ['runs', wishlistId] });
        qc.invalidateQueries({ queryKey: ['quota'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist_items', filter }, () =>
        qc.invalidateQueries({ queryKey: ['items', wishlistId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [wishlistId, userId, qc]);
}

/** New in-app notifications: refresh the bell and raise a toast. */
export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification;
          toast(n.title, { description: n.body ?? undefined });
          qc.invalidateQueries({ queryKey: ['notifications'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
