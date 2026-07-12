// Wires the Circuit store to the right adapter: Supabase + realtime when a member is
// signed in (and Supabase is configured), localStorage otherwise. Re-wires on auth change.
import { circuitStore } from './store'
import { createLocalAdapter } from './localAdapter'
import { createSupabaseAdapter, clearCloudCache } from './supabaseAdapter'
import { fetchPublicCircuit, bundledPublicBoard } from './publicData'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { onAuthStateChange, peekPersistedUserId } from '../finance/auth'
import type { CircuitAdapter } from './adapter'

let local: ReturnType<typeof createLocalAdapter> | null = null
let supa: ReturnType<typeof createSupabaseAdapter> | null = null
let current: CircuitAdapter | null = null

function pickAdapter() {
  // The persisted session is peeked synchronously — the old `await getUser()` here was a
  // network round-trip on EVERY mount, and when a stale token made it fail, a signed-in
  // member briefly got the demo sandbox (the "sign in" flash). If the session really is
  // dead, the queries fail, connectCircuit falls back, and the auth listener re-wires.
  if (hasFinanceSupabaseEnv() && peekPersistedUserId()) return (supa ??= createSupabaseAdapter())
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
  current = pickAdapter()
  try {
    await circuitStore.init(current)
  } catch {
    // cloud load failed (dead session, network) — fall back to the sandbox for now;
    // the auth listener below re-wires the moment the session settles
    if (current !== local) {
      if (!local) local = createLocalAdapter(bundledPublicBoard())
      current = local
      await circuitStore.init(local).catch(() => undefined)
    }
  }
  if (!wired) {
    wired = true
    // when the member signs in/out, swap to Supabase / localStorage accordingly.
    // Only an EXPLICIT sign-out swaps away — the auth library also emits transient
    // null-session events mid-refresh, and reacting to those flashed the demo board
    // ("read-only, sign in") at signed-in members.
    onAuthStateChange((event, session) => {
      if (!session?.user && event !== 'SIGNED_OUT') return
      if (event === 'SIGNED_OUT') clearCloudCache() // next user/session starts clean
      const a = pickAdapter()
      if (a === current) return // no churn on token refreshes
      current = a
      void circuitStore.init(a).catch(() => undefined)
    })
  }
  // signed out → upgrade the bundled board to the live one in the background
  if (current === local) void refreshPublicInBackground()
}
