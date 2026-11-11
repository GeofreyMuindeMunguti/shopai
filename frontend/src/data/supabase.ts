/**
 * Supabase Client Setup
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables (Vite-prefixed for client-side access)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dev-anon-key';

/**
 * Supabase client singleton
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE: the OAuth redirect carries a one-time code, not tokens in the URL hash.
    flowType: 'pkce',
  },
});

/**
 * Typed Supabase client type
 */
export type SupabaseClient = typeof supabase;
