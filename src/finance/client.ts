import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFinanceEnv } from './env'

const FINANCE_SCHEMA = 'finance' as const

let _supabase: SupabaseClient | null = null

export type FinanceDbClient = ReturnType<SupabaseClient['schema']>

/**
 * Returns a singleton Supabase client.
 *
 * - Uses the anon key (safe to ship to browsers).
 * - Never bypasses RLS; all access is mediated by Auth JWT + RLS policies.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase

  const { supabaseUrl, supabaseAnonKey } = getFinanceEnv()

  // Ensure all PostgREST queries default to the `finance` schema.
  // Type definitions can be strict about schema names without generated DB types,
  // so we cast the options shape instead of widening generics.
  const options = {
    auth: {
      // For an app/dashboard, keep sessions across refresh so the JWT is present.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    db: {
      schema: FINANCE_SCHEMA,
    },
  } as unknown as Parameters<typeof createClient>[2]

  _supabase = createClient(supabaseUrl, supabaseAnonKey, options)

  return _supabase
}

/**
 * Returns a schema-scoped client for the `finance` schema.
 * Using `.schema('finance')` avoids accidentally querying `public.*`.
 */
export function getFinanceClient(): FinanceDbClient {
  return getSupabaseClient().schema(FINANCE_SCHEMA)
}

export { FINANCE_SCHEMA }
