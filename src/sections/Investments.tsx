import { useEffect, useMemo, useState } from 'react'
import { fetchFamilyAccountsOverview } from '../finance/queries'
import {
  allocations,
  executedTrades,
  type AllocationRow,
  type ExecutedTradeRow,
  type FamilyAccountRow,
} from '../finance/tables'
import { getUser, onAuthStateChange } from '../finance/auth'

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function coerceBalance(balances: unknown): { value: number | null; label: string } {
  if (typeof balances === 'number' && Number.isFinite(balances))
    return { value: balances, label: fmtMoney(balances) }
  if (balances && typeof balances === 'object') {
    const obj = balances as Record<string, unknown>
    const candidates = ['balance', 'current', 'current_balance', 'available', 'total']
    for (const k of candidates) {
      const v = obj[k]
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, label: fmtMoney(v) }
    }
    try {
      const s = JSON.stringify(balances)
      return { value: null, label: s.length > 80 ? s.slice(0, 77) + '…' : s }
    } catch {
      return { value: null, label: String(balances) }
    }
  }
  if (typeof balances === 'string' && balances.trim()) return { value: null, label: balances }
  return { value: null, label: '—' }
}

export function Investments() {
  const [userId, setUserId] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<FamilyAccountRow[]>([])
  const [trades, setTrades] = useState<ExecutedTradeRow[]>([])
  const [allocs, setAllocs] = useState<AllocationRow[]>([])

  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingTrades, setLoadingTrades] = useState(false)
  const [loadingAllocs, setLoadingAllocs] = useState(false)

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getUser()
      .then((u) => {
        if (!alive) return
        setUserId(u?.id ?? null)
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e?.message || e))
      })

    const { data } = onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function loadAll() {
    setError(null)
    if (!userId) return

    setLoadingAccounts(true)
    setLoadingTrades(true)
    setLoadingAllocs(true)

    try {
      const [a, t, al] = await Promise.all([
        fetchFamilyAccountsOverview({ limit: 100 }),
        executedTrades.list({ limit: 250, orderBy: 'executed_at', ascending: false }),
        allocations.list({ limit: 500, orderBy: 'allocation_type', ascending: true }),
      ])
      setAccounts(a)
      setTrades(t)
      setAllocs(al)
    } catch (e) {
      setError(String((e as { message?: string } | null)?.message || e))
    } finally {
      setLoadingAccounts(false)
      setLoadingTrades(false)
      setLoadingAllocs(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const totals = useMemo(() => {
    let total = 0
    let known = 0
    for (const a of accounts) {
      const b = coerceBalance(a.balances).value
      if (typeof b === 'number') {
        total += b
        known += 1
      }
    }
    return { total, known, count: accounts.length }
  }, [accounts])

  const allocationTotal = useMemo(() => {
    let sum = 0
    for (const a of allocs) {
      const v = a.target_percent as unknown as number
      if (typeof v === 'number' && Number.isFinite(v)) sum += v
    }
    return sum
  }, [allocs])

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Investments
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Data is scoped to the signed-in user via Supabase Auth + RLS (`auth.uid()` / `user_id`).
        </p>
        {!userId ? (
          <p className="muted" style={{ margin: 0 }}>
            Sign in to view your accounts, trades, and allocations.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => loadAll()}
              disabled={loadingAccounts || loadingTrades || loadingAllocs}
            >
              {loadingAccounts || loadingTrades || loadingAllocs ? 'Loading…' : 'Refresh'}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              User: {userId.slice(0, 8)}…
            </span>
            {error && (
              <span className="muted" style={{ color: 'var(--accent-2)' }}>
                {error}
              </span>
            )}
          </div>
        )}
      </header>

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Family Accounts
        </h3>
        {loadingAccounts ? (
          <p className="muted">Loading accounts…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Total (known balances): {fmtMoney(totals.total)} • Accounts: {totals.count}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Account</th>
                  <th style={{ padding: '8px 6px' }}>Balance</th>
                  <th style={{ padding: '8px 6px' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const bal = coerceBalance(a.balances)
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px' }}>{a.account_name}</td>
                      <td style={{ padding: '8px 6px' }}>{bal.label}</td>
                      <td style={{ padding: '8px 6px' }}>{fmtDate(a.updated_at)}</td>
                    </tr>
                  )
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td className="muted" style={{ padding: '10px 6px' }} colSpan={3}>
                      No accounts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </article>

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Executed Trades
        </h3>
        {loadingTrades ? (
          <p className="muted">Loading trades…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>When</th>
                <th style={{ padding: '8px 6px' }}>Symbol</th>
                <th style={{ padding: '8px 6px' }}>Type</th>
                <th style={{ padding: '8px 6px' }}>Qty</th>
                <th style={{ padding: '8px 6px' }}>Price</th>
                <th style={{ padding: '8px 6px' }}>Notional</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const notional = Number(t.quantity) * Number(t.price)
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      {fmtDate(t.executed_at)}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{t.symbol}</td>
                    <td style={{ padding: '8px 6px' }}>{t.type}</td>
                    <td style={{ padding: '8px 6px' }}>{t.quantity}</td>
                    <td style={{ padding: '8px 6px' }}>{fmtMoney(Number(t.price))}</td>
                    <td style={{ padding: '8px 6px' }}>
                      {fmtMoney(Number.isFinite(notional) ? notional : 0)}
                    </td>
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr>
                  <td className="muted" style={{ padding: '10px 6px' }} colSpan={6}>
                    No trades found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </article>

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Allocations
        </h3>
        {loadingAllocs ? (
          <p className="muted">Loading allocations…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Target total: {Number.isFinite(allocationTotal) ? allocationTotal.toFixed(1) : '—'}%
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Type</th>
                  <th style={{ padding: '8px 6px' }}>Target %</th>
                  <th style={{ padding: '8px 6px' }}>Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => {
                  const pct =
                    typeof a.target_percent === 'number'
                      ? a.target_percent
                      : Number(a.target_percent)
                  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px' }}>{a.allocation_type}</td>
                      <td style={{ padding: '8px 6px' }}>
                        {Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '8px 6px', minWidth: 220 }}>
                        <div
                          style={{
                            height: 10,
                            borderRadius: 999,
                            background: 'var(--border)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${safe}%`,
                              height: '100%',
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {allocs.length === 0 && (
                  <tr>
                    <td className="muted" style={{ padding: '10px 6px' }} colSpan={3}>
                      No allocations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </article>
    </section>
  )
}
