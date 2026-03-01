import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFinanceEnv } from './env'

const FINANCE_SCHEMA = 'finance' as const

let _supabase: SupabaseClient | null = null

/**
 * Returns a singleton Supabase client.
 *
 * - Uses the anon key (safe to ship to browsers).
 * - Never bypasses RLS; all access is mediated by Auth JWT + RLS policies.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase

  const { supabaseUrl, supabaseAnonKey } = getFinanceEnv()

  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // For an app/dashboard, keep sessions across refresh so the JWT is present.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return _supabase
}

/**
 * Returns a schema-scoped client for the `finance` schema.
 * Using `.schema('finance')` avoids accidentally querying `public.*`.
 */
export function getFinanceClient(): SupabaseClient {
  const sb = getSupabaseClient()
  // supabase-js returns a schema-scoped client.
  const withSchema = sb as unknown as { schema: (schema: string) => SupabaseClient }
  return withSchema.schema(FINANCE_SCHEMA)
}

export { FINANCE_SCHEMA }
