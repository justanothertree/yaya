// DEV-ONLY FILE
// This file must never be imported in production code.
// Used for manual Supabase debugging only.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Made on first use, never at import. App.tsx imports this file on every dev load, and
 * `createClient` throws "supabaseUrl is required" when .env.local is missing — so a checkout
 * without one took the whole dev page down for the sake of a console helper nobody had called.
 * Without the env it now answers `null`, and `run()` says why instead of throwing.
 */
let client: SupabaseClient | null = null
function debugClient(): SupabaseClient | null {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, { auth: { persistSession: false, storageKey: 'sb-debug' } })
  return client
}

declare global {
  interface Window {
    supabaseDebug?: {
      run: () => Promise<void>
    }
  }
}

/* -----------------------------
   Table sanity check
-------------------------------- */
async function testTable(supabase: SupabaseClient, tableName: string) {
  const { data, error } = await supabase.from(tableName).select('*').limit(5)

  if (error) {
    console.error(`❌ ${tableName}`, error)
  } else {
    console.log(`\n--- ${tableName} ---`)
    console.table(data)
  }
}

/* -----------------------------
   finalize_round_rpc test
-------------------------------- */
async function testFinalizeRoundRPC(supabase: SupabaseClient) {
  console.log('\nTesting finalize_round_rpc...')

  const { data, error } = await supabase.rpc('finalize_round_rpc', {
    p_room_id: 'test_room',
    p_round_id: crypto.randomUUID(),
    p_game_mode: 'survival',
    p_items: [
      { id: 'p1', name: 'Alice', score: 10, finishIdx: 1 },
      { id: 'p2', name: 'Bob', score: 8, finishIdx: 2 },
    ],
    p_players: [],
  })

  if (error) {
    console.error('❌ finalize_round_rpc error:', error)
  } else {
    console.log('✅ finalize_round_rpc result:')
    console.table(data)
  }
}

/* -----------------------------
   enforce_best_score test
   NOTE: only uses parameters
   that actually exist
-------------------------------- */
async function testEnforceBestScore(supabase: SupabaseClient) {
  console.log('\nTesting enforce_best_score...')

  const { data, error } = await supabase.rpc('enforce_best_score', {
    p_player_id: 45,
    p_game_mode: 'survival',
  })

  if (error) {
    console.error('❌ enforce_best_score error:', error)
  } else {
    console.log('✅ enforce_best_score result:', data)
  }
}

/* -----------------------------
   Main runner
-------------------------------- *
async function main() {
  console.log('Testing Supabase connection and tables...')

  await testTable('leaderboard')
  await testTable('score_history')
  await testTable('player_registry')
  await testTable('trophies')
  await testTable('round_results')

  await testFinalizeRoundRPC()
  await testEnforceBestScore()

  console.log('\nSupabase test completed.')
}
-------------------------------- */
//main()

export async function runSupabaseDebug() {
  const supabase = debugClient()
  if (!supabase) {
    console.warn(
      '🧪 Supabase debug skipped: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (.env.local).',
    )
    return
  }
  console.log('🧪 Supabase debug starting...')

  await testTable(supabase, 'leaderboard')
  await testTable(supabase, 'score_history')
  await testTable(supabase, 'player_registry')
  await testTable(supabase, 'trophies')
  await testTable(supabase, 'round_results')

  await testFinalizeRoundRPC(supabase)
  await testEnforceBestScore(supabase)

  console.log('🧪 Supabase debug completed.')
}

if (import.meta.env.DEV) {
  window.supabaseDebug = {
    run: runSupabaseDebug,
  }
}
