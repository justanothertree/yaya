// DEV-ONLY FILE
// This file must never be imported in production code.
// Used for manual Supabase debugging only.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
)

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
async function testTable(tableName: string) {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .limit(5)

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
async function testFinalizeRoundRPC() {
  console.log('\nTesting finalize_round_rpc...')

  const { data, error } = await supabase.rpc('finalize_round_rpc', {
    p_room_id: 'test_room',
    p_round_id: crypto.randomUUID(),
    p_game_mode: 'survival',
    p_items: [
      { id: 'p1', name: 'Alice', score: 10, finishIdx: 1 },
      { id: 'p2', name: 'Bob', score: 8, finishIdx: 2 }
    ],
    p_players: []
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
async function testEnforceBestScore() {
  console.log('\nTesting enforce_best_score...')

  const { data, error } = await supabase.rpc('enforce_best_score', {
    p_player_id: 45,
    p_game_mode: 'survival'
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
  console.log('🧪 Supabase debug starting...')

  await testTable('leaderboard')
  await testTable('score_history')
  await testTable('player_registry')
  await testTable('trophies')
  await testTable('round_results')

  await testFinalizeRoundRPC()
  await testEnforceBestScore()

  console.log('🧪 Supabase debug completed.')
}


if (import.meta.env.DEV) {
  window.supabaseDebug = {
    run: runSupabaseDebug
  }
}