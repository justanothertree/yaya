// Wires the Circuit store to the right adapter: Supabase + realtime when a member is
// signed in (and Supabase is configured), localStorage otherwise. Re-wires on auth change.
import { circuitStore } from './store'
import { createLocalAdapter } from './localAdapter'
import { createSupabaseAdapter } from './supabaseAdapter'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { getUser, onAuthStateChange } from '../finance/auth'

let local: ReturnType<typeof createLocalAdapter> | null = null
let supa: ReturnType<typeof createSupabaseAdapter> | null = null

async function pickAdapter() {
  if (hasFinanceSupabaseEnv()) {
    const user = await getUser().catch(() => null)
    if (user) return (supa ??= createSupabaseAdapter())
  }
  return (local ??= createLocalAdapter())
}

let wired = false
export async function connectCircuit() {
  await circuitStore.init(await pickAdapter())
  if (!wired) {
    wired = true
    // when the member signs in/out, swap to Supabase / localStorage accordingly
    onAuthStateChange(() => {
      void pickAdapter().then((a) => circuitStore.init(a))
    })
  }
}
