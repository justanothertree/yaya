import { useEffect, useState } from 'react'
import { onAuthStateChange, signInWithPassword, signOut } from './auth'
import {
  fetchAllocationBreakdowns,
  fetchExecutedTradesHistory,
  fetchFamilyAccountsOverview,
  lookupPriceCache,
} from './queries'

/**
 * Example usage (not wired into the app).
 *
 * Demonstrates:
 * - Signing in to establish a session (JWT)
 * - Fetching finance data under RLS
 *
 * IMPORTANT:
 * - With an anon key, requests are only “user-scoped” if you are authenticated
 *   and your Supabase RLS policies enforce `auth.uid()` ownership.
 */
export function FinanceExampleWidget() {
  const [status, setStatus] = useState('idle')
  const [accounts, setAccounts] = useState<unknown[]>([])

  useEffect(() => {
    const { data } = onAuthStateChange((event) => {
      setStatus(`auth:${event}`)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function demo() {
    setStatus('loading')
    const a = await fetchFamilyAccountsOverview()
    const t = await fetchExecutedTradesHistory({ limit: 50 })
    const al = await fetchAllocationBreakdowns({ limit: 50 })
    const p = await lookupPriceCache({ symbols: ['AAPL', 'MSFT'], limitPerSymbol: 1 })
    console.log('[finance demo]', { accounts: a, trades: t, allocations: al, prices: p })
    setAccounts(a)
    setStatus('done')
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div>Status: {status}</div>
      <button
        onClick={() =>
          // Replace with a real sign-in form in your app.
          signInWithPassword('parent@example.com', 'password123').catch((e) =>
            setStatus(`error:${String(e?.message || e)}`),
          )
        }
      >
        Sign in (example)
      </button>
      <button onClick={() => signOut().catch((e) => setStatus(`error:${String(e)}`))}>
        Sign out
      </button>
      <button onClick={() => demo().catch((e) => setStatus(`error:${String(e?.message || e)}`))}>
        Fetch finance data
      </button>
      <pre style={{ maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(accounts, null, 2)}</pre>
    </div>
  )
}
