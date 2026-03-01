import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFinanceEnv } from './env'

const FINANCE_SCHEMA = 'finance' as const

// SupabaseClient's type parameters default to schema "public".
// When we set a non-public schema, the inferred return type no longer matches
// the default `SupabaseClient` alias. We intentionally keep this loosely typed
// until this repo adopts generated Database types.
type AnySupabaseClient = SupabaseClient<unknown, unknown, unknown, unknown, unknown>

let _supabase: AnySupabaseClient | null = null

/**
 * Returns a singleton Supabase client.
 *
 * - Uses the anon key (safe to ship to browsers).
 * - Never bypasses RLS; all access is mediated by Auth JWT + RLS policies.
 */
export function getSupabaseClient(): AnySupabaseClient {
  if (_supabase) return _supabase

  const { supabaseUrl, supabaseAnonKey } = getFinanceEnv()

  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // For an app/dashboard, keep sessions across refresh so the JWT is present.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    db: {
      // Default schema; we still explicitly call .schema(FINANCE_SCHEMA) below.
      schema: FINANCE_SCHEMA,
    },
  })

  return _supabase as AnySupabaseClient
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
