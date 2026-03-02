import { useEffect, useMemo, useState } from 'react'
import type { AllocationRow, ExecutedTradeRow, FamilyAccountRow } from '../finance/tables'
import { getSession, onAuthStateChange } from '../finance/auth'
import { getSupabaseClient } from '../finance/client'

type MaybeError = { message?: string } | null | undefined

function safeMsg(err: unknown) {
  const msg = (err as MaybeError)?.message
  return typeof msg === 'string' && msg ? msg : String(err)
}

type PostgrestResult<T> = { data: T | null; error: unknown | null }

function logCallStart(meta: Record<string, unknown>) {
  console.info('[investments][supabase] start', meta)
}

function logCallOk(meta: Record<string, unknown>) {
  console.info('[investments][supabase] ok', meta)
}

function logCallError(meta: Record<string, unknown>, error: unknown) {
  console.error('[investments][supabase] error', meta, error)
}

function rowCount(data: unknown): number {
  if (!data) return 0
  if (Array.isArray(data)) return data.length
  return 1
}

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
  const devEnabled = import.meta.env.DEV

  const [userId, setUserId] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<FamilyAccountRow[]>([])
  const [trades, setTrades] = useState<ExecutedTradeRow[]>([])
  const [allocs, setAllocs] = useState<AllocationRow[]>([])

  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingTrades, setLoadingTrades] = useState(false)
  const [loadingAllocs, setLoadingAllocs] = useState(false)

  const [error, setError] = useState<string | null>(null)

  // DEV-only test controls
  const [devBusy, setDevBusy] = useState(false)
  const [devAccountName, setDevAccountName] = useState('[DEV] Test Account')
  const [devAccountBalance, setDevAccountBalance] = useState('1000')
  const [devTradeSymbol, setDevTradeSymbol] = useState('DEVTEST')
  const [devTradeType, setDevTradeType] = useState<'buy' | 'sell'>('buy')
  const [devTradeQty, setDevTradeQty] = useState('1')
  const [devTradePrice, setDevTradePrice] = useState('100')
  const [devAllocType, setDevAllocType] = useState('[DEV] stocks')
  const [devAllocTarget, setDevAllocTarget] = useState('60')
  const [showRaw, setShowRaw] = useState(false)

  async function getSessionLogged(context: string) {
    logCallStart({ op: 'auth.getSession', context })
    try {
      const session = await getSession()
      logCallOk({ op: 'auth.getSession', context, user_id: session?.user?.id ?? null })
      return session
    } catch (e) {
      logCallError({ op: 'auth.getSession', context }, e)
      throw e
    }
  }

  async function devCtx() {
    const session = await getSessionLogged('devCtx')
    const uid = session?.user?.id
    if (!uid) throw new Error('Not authenticated. Sign in required.')
    const sb = getSupabaseClient().schema('finance')
    return { sb, uid }
  }

  async function devCreateFamilyAccount() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const name = devAccountName.trim() || `[DEV] Test Account ${new Date().toISOString()}`
      const bal = Number(devAccountBalance)
      const balances = Number.isFinite(bal) ? bal : devAccountBalance

      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        values: { user_id: uid, account_name: name },
      })

      const res = await sb
        .from('family_accounts')
        .insert({ user_id: uid, account_name: name, balances })
        .select('*')
        .single()
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'family_accounts', user_id: uid },
          res.error,
        )
        throw res.error
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create family account failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devCreateExecutedTrade() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const symbol = devTradeSymbol.trim() || 'DEVTEST'
      const quantity = Number(devTradeQty)
      const price = Number(devTradePrice)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Trade quantity must be > 0')
      if (!Number.isFinite(price) || price <= 0) throw new Error('Trade price must be > 0')

      const payload = {
        user_id: uid,
        executed_at: new Date().toISOString(),
        symbol,
        quantity,
        price,
        type: devTradeType,
      }

      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        values: payload,
      })

      const res = await sb.from('executed_trades').insert(payload).select('*').single()
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'executed_trades', user_id: uid },
          res.error,
        )
        throw res.error
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create executed trade failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devCreateAllocation() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const allocation_type = devAllocType.trim() || '[DEV] allocation'
      const target_percent = Number(devAllocTarget)
      if (!Number.isFinite(target_percent) || target_percent < 0 || target_percent > 100) {
        throw new Error('Allocation target % must be between 0 and 100')
      }

      const payload = { user_id: uid, allocation_type, target_percent }
      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        values: payload,
      })

      const res = await sb.from('allocations').insert(payload).select('*').single()
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'allocations', user_id: uid },
          res.error,
        )
        throw res.error
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create allocation failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devDeleteTestRows() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()

      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        filter: "user_id=... AND account_name ILIKE '[DEV]%",
      })
      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        filter: "user_id=... AND symbol ILIKE 'DEV%'",
      })
      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        filter: "user_id=... AND allocation_type ILIKE '[DEV]%",
      })

      const [accDel, tradeDel, allocDel] = await Promise.all([
        sb.from('family_accounts').delete().eq('user_id', uid).ilike('account_name', '[DEV]%'),
        sb.from('executed_trades').delete().eq('user_id', uid).ilike('symbol', 'DEV%'),
        sb.from('allocations').delete().eq('user_id', uid).ilike('allocation_type', '[DEV]%'),
      ])

      if (accDel.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid },
          accDel.error,
        )
        throw accDel.error
      }
      if (tradeDel.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid },
          tradeDel.error,
        )
        throw tradeDel.error
      }
      if (allocDel.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'allocations', user_id: uid },
          allocDel.error,
        )
        throw allocDel.error
      }

      logCallOk({ op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid })
      logCallOk({ op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid })
      logCallOk({ op: 'delete', schema: 'finance', table: 'allocations', user_id: uid })

      await loadAll()
    } catch (e) {
      console.error('[investments][dev] delete test rows failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    void getSessionLogged('mount')
      .then((s) => {
        if (!alive) return
        setUserId(s?.user?.id ?? null)
      })
      .catch((e) => {
        if (!alive) return
        console.error('[investments] getSession failed', e)
        setError(safeMsg(e))
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
      const session = await getSessionLogged('loadAll')
      const uid = session?.user?.id
      if (!uid) throw new Error('Not authenticated. Sign in required.')

      const sb = getSupabaseClient().schema('finance')

      logCallStart({ op: 'select', schema: 'finance', table: 'family_accounts', user_id: uid })
      logCallStart({ op: 'select', schema: 'finance', table: 'executed_trades', user_id: uid })
      logCallStart({ op: 'select', schema: 'finance', table: 'allocations', user_id: uid })

      const [accountsRes, tradesRes, allocsRes] = await Promise.all([
        sb
          .from('family_accounts')
          .select('*')
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(100),
        sb
          .from('executed_trades')
          .select('*')
          .eq('user_id', uid)
          .order('executed_at', { ascending: false })
          .limit(250),
        sb
          .from('allocations')
          .select('*')
          .eq('user_id', uid)
          .order('allocation_type', { ascending: true })
          .limit(500),
      ])

      if (accountsRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'family_accounts', user_id: uid },
          accountsRes.error,
        )
        throw accountsRes.error
      }
      if (tradesRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'executed_trades', user_id: uid },
          tradesRes.error,
        )
        throw tradesRes.error
      }
      if (allocsRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'allocations', user_id: uid },
          allocsRes.error,
        )
        throw allocsRes.error
      }

      logCallOk({
        op: 'select',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        rows: rowCount((accountsRes as PostgrestResult<unknown>).data),
      })
      logCallOk({
        op: 'select',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        rows: rowCount((tradesRes as PostgrestResult<unknown>).data),
      })
      logCallOk({
        op: 'select',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        rows: rowCount((allocsRes as PostgrestResult<unknown>).data),
      })

      setAccounts((accountsRes.data ?? []) as unknown as FamilyAccountRow[])
      setTrades((tradesRes.data ?? []) as unknown as ExecutedTradeRow[])
      setAllocs((allocsRes.data ?? []) as unknown as AllocationRow[])
    } catch (e) {
      console.error('[investments] loadAll failed', e)
      setError(safeMsg(e))
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

      {devEnabled && userId && (
        <article
          className="card"
          style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <strong style={{ fontSize: 13 }}>Debug</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            user_id: {userId}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            family_accounts: {accounts.length}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            executed_trades: {trades.length}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            allocations: {allocs.length}
          </span>
        </article>
      )}

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

      {devEnabled && userId && (
        <article className="card" style={{ display: 'grid', gap: 12 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Internal test controls (DEV)
          </h3>
          <p className="muted" style={{ margin: 0 }}>
            Uses <code>schema('finance')</code> and scopes to your <code>user_id</code>. Intended
            for local development only.
          </p>

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create family account</strong>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={devAccountName}
                  onChange={(e) => setDevAccountName(e.target.value)}
                  placeholder="[DEV] Test Account"
                  style={{ minWidth: 220 }}
                  disabled={devBusy}
                />
                <input
                  value={devAccountBalance}
                  onChange={(e) => setDevAccountBalance(e.target.value)}
                  placeholder="Balance"
                  style={{ width: 140 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateFamilyAccount()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create executed trade</strong>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={devTradeSymbol}
                  onChange={(e) => setDevTradeSymbol(e.target.value)}
                  placeholder="DEVTEST"
                  style={{ width: 140 }}
                  disabled={devBusy}
                />
                <select
                  value={devTradeType}
                  onChange={(e) => setDevTradeType(e.target.value as 'buy' | 'sell')}
                  disabled={devBusy}
                >
                  <option value="buy">buy</option>
                  <option value="sell">sell</option>
                </select>
                <input
                  value={devTradeQty}
                  onChange={(e) => setDevTradeQty(e.target.value)}
                  placeholder="Qty"
                  style={{ width: 90 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradePrice}
                  onChange={(e) => setDevTradePrice(e.target.value)}
                  placeholder="Price"
                  style={{ width: 90 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateExecutedTrade()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create allocation</strong>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={devAllocType}
                  onChange={(e) => setDevAllocType(e.target.value)}
                  placeholder="[DEV] stocks"
                  style={{ minWidth: 220 }}
                  disabled={devBusy}
                />
                <input
                  value={devAllocTarget}
                  onChange={(e) => setDevAllocTarget(e.target.value)}
                  placeholder="Target %"
                  style={{ width: 120 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateAllocation()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" onClick={() => void loadAll()} disabled={devBusy}>
                Refresh lists
              </button>
              <button className="btn" onClick={() => setShowRaw((v) => !v)} disabled={devBusy}>
                {showRaw ? 'Hide raw rows' : 'Show raw rows'}
              </button>
              <button
                className="btn"
                onClick={() => void devDeleteTestRows()}
                disabled={devBusy}
                aria-label="Delete DEV test rows"
              >
                {devBusy ? 'Working…' : 'Delete DEV test rows'}
              </button>
            </div>

            {showRaw && (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflowX: 'auto',
                  maxHeight: 340,
                }}
              >
                {JSON.stringify(
                  {
                    accounts,
                    trades,
                    allocations: allocs,
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        </article>
      )}
    </section>
  )
}
