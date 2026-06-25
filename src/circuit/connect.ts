// Wires the Circuit store to the right adapter: Supabase + realtime when a member is
// signed in (and Supabase is configured), localStorage otherwise. Re-wires on auth change.
import { circuitStore } from './store'
import { createLocalAdapter } from './localAdapter'
import { createSupabaseAdapter } from './supabaseAdapter'
import { fetchPublicCircuit, bundledPublicBoard } from './publicData'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { getUser, onAuthStateChange } from '../finance/auth'
import type { CircuitAdapter } from './adapter'

let local: ReturnType<typeof createLocalAdapter> | null = null
let supa: ReturnType<typeof createSupabaseAdapter> | null = null
let current: CircuitAdapter | null = null

async function pickAdapter() {
  if (hasFinanceSupabaseEnv()) {
    const user = await getUser().catch(() => null)
    if (user) return (supa ??= createSupabaseAdapter())
  }
  // Signed out: seed the local sandbox INSTANTLY from the bundled public board so the page
  // is never blank while the live board loads. The live data is pulled in the background
  // (see connectCircuit) — this matters most on Firefox, whose cross-site fetch is slower.
  if (!local) local = createLocalAdapter(bundledPublicBoard())
  return local
}

// Pull the live public board and, if it actually came back, refresh it into the signed-out
// sandbox. Guarded so it never clobbers the signed-in adapter if auth changed meanwhile.
async function refreshPublicInBackground() {
  const res = await fetchPublicCircuit().catch(() => null)
  if (res?.live && current === local) {
    local = createLocalAdapter(res.state, true)
    current = local
    await circuitStore.init(local)
  }
}

let wired = false
export async function connectCircuit() {
  current = await pickAdapter()
  await circuitStore.init(current)
  if (!wired) {
    wired = true
    // when the member signs in/out, swap to Supabase / localStorage accordingly
    onAuthStateChange(() => {
      void pickAdapter().then((a) => {
        current = a
        void circuitStore.init(a)
      })
    })
  }
  // signed out → upgrade the bundled board to the live one in the background
  if (current === local) void refreshPublicInBackground()
}
