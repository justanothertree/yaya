import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFinanceEnv } from './env'

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
 * Subscribe to a realtime channel and SAY SO when it fails.
 *
 * `channel.subscribe()` with no callback is the quiet kind of broken: if the socket errors, times
 * out, or the channel is closed under you, live updates simply stop. Nothing throws, nothing
 * logs, and the page keeps showing whatever it had — so "the board stopped syncing" and "chat
 * went quiet" look identical to "nothing has happened yet".
 *
 * This project has already been bitten by exactly that: realtime-js dedupes channels BY TOPIC,
 * so re-subscribing to a topic mid-teardown returns the dying instance and `subscribe()` silently
 * no-ops. That took a long time to find precisely because it was silent.
 *
 * Deliberately only WARNS — it does not retry or surface UI. Every caller here is a
 * nice-to-have live layer over data that is also fetched normally, so a dead channel should
 * degrade to "not live", not to an error page. The point is that it stops being invisible.
 */
export function subscribeLogged(
  channel: { subscribe: (cb?: (status: string, err?: Error) => void) => unknown },
  label: string,
) {
  return channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') return
    // CLOSED is normal on teardown; the rest mean live updates are not happening
    if (status === 'CLOSED') return
    console.warn(`[realtime] ${label}: ${status}${err ? ` — ${err.message}` : ''} (not live)`)
  })
}
