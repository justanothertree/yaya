// Family "dollar-a-day" investments. Members see their own read-only portfolio (holdings at
// cost + dollars/day, plus current value and gain/loss from the daily price sweep). Admins
// also get "All accounts" (view as any member) and the trades ledger.
import { useEffect, useMemo, useState } from 'react'
import {
  fetchMyPortfolio,
  fetchAllPortfolios,
  checkIsAdmin,
  fetchMembers,
  adminCreateAccount,
  adminUpdateAccount,
  adminDeleteAccount,
  adminReassignAccount,
  adminEnableFinance,
  accountReserved,
  promisedToDate,
  aheadBehind,
  portfolioTotals,
  runwayDays,
  assetColor,
  usd,
  fetchMyTrades,
  fetchMyAllocations,
  assignAllocation,
  adminSetPrice,
  fetchPositions,
  setSymbolDesignation,
  correctPosition,
  setPositionCost,
  type AccountPortfolio,
  type Member,
  type Trade,
  type AllocationRow,
  type Position,
} from '../finance/portfolio'
import { DEMO_PORTFOLIO } from '../finance/demoPortfolio'
import {
  fetchMyTimeline,
  fetchFundTimeline,
  demoTimeline,
  avgCostBySymbol,
  type Timeline,
} from '../finance/timeline'
import { PortfolioChart } from './PortfolioChart'

export function Investments({ demo = false }: { demo?: boolean }) {
  const [mine, setMine] = useState<AccountPortfolio[] | null>(null)
  const [all, setAll] = useState<AccountPortfolio[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [mode, setMode] = useState<'mine' | 'all' | 'trades'>('mine')
  const [error, setError] = useState<string | null>(null)
  const [tl, setTl] = useState<Timeline | null>(null)
  const [tlAll, setTlAll] = useState<Timeline | null>(null)

  const reloadAll = async () => {
    setAll(await fetchAllPortfolios())
  }

  useEffect(() => {
    if (demo) {
      setMine(DEMO_PORTFOLIO)
      setTl(demoTimeline())
      return
    }
    let alive = true
    void (async () => {
      try {
        const [m, admin] = await Promise.all([fetchMyPortfolio(), checkIsAdmin()])
        if (!alive) return
        setMine(m)
        setIsAdmin(admin)
        // the chart is a bonus — never block the page on it
        fetchMyTimeline().then(
          (t) => alive && setTl(t),
          () => undefined,
        )
        if (admin) {
          const [a, mem] = await Promise.all([fetchAllPortfolios(), fetchMembers()])
          if (alive) {
            setAll(a)
            setMembers(mem)
          }
          fetchFundTimeline().then(
            (t) => alive && setTlAll(t),
            () => undefined,
          )
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [demo])

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Investments
          </h2>
          {isAdmin && (
            <span style={{ display: 'inline-flex', gap: '0.35rem', marginLeft: 'auto' }}>
              <ModeBtn active={mode === 'mine'} onClick={() => setMode('mine')}>
                My portfolio
              </ModeBtn>
              <ModeBtn active={mode === 'all'} onClick={() => setMode('all')}>
                All accounts{all ? ` (${all.length})` : ''}
              </ModeBtn>
              <ModeBtn active={mode === 'trades'} onClick={() => setMode('trades')}>
                Trades
              </ModeBtn>
            </span>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {demo
            ? 'A sample of the dollar-a-day fund — each account gets $1/day, invested and split across holdings. This is example data.'
            : mode === 'all'
              ? 'Every family account — expand one to see exactly what that member sees.'
              : mode === 'trades'
                ? 'Every trade you’ve made — what’s allocated to the family fund and what’s still yours. Expand a trade to assign shares.'
                : 'Your dollar-a-day portfolio — what’s been invested for you, what it’s worth now, and how it’s allocated.'}
        </p>
      </header>

      {demo && (
        <article
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
            borderColor: 'var(--accent,#7c6af7)',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🔎</span>
          <span style={{ fontWeight: 700 }}>Demo</span>
          <span className="muted" style={{ fontSize: '0.88rem' }}>
            Sample data — sign in to track your family’s real fund.
          </span>
          <a
            className="btn"
            href="#signin"
            style={{
              marginLeft: 'auto',
              fontSize: '0.82rem',
              background: 'var(--accent,#7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            Sign in
          </a>
        </article>
      )}

      {error && (
        <article className="card">
          <p style={{ margin: 0, color: 'var(--accent-2)' }}>{error}</p>
        </article>
      )}

      {mode === 'mine' ? (
        <>
          {/* one account = the card says it all; the roll-up banner is for multi-account views */}
          {mine && mine.length > 1 && <ScheduleSummary accounts={mine} />}
          {tl && tl.events.length > 0 && (
            <PortfolioChart timeline={tl} title="Your fund over time" />
          )}
          <PortfolioList accounts={mine} own timeline={tl} />
        </>
      ) : mode === 'trades' ? (
        <TradesLedger accounts={all} />
      ) : (
        <>
          {all && all.length > 0 && <ScheduleSummary accounts={all} />}
          {tlAll && tlAll.events.length > 0 && (
            <PortfolioChart timeline={tlAll} title="Whole fund over time" />
          )}
          <AllAccounts accounts={all} members={members} onChanged={reloadAll} timeline={tlAll} />
        </>
      )}
    </section>
  )
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className="btn"
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: '0.82rem',
        background: active ? 'var(--accent,#7c6af7)' : 'transparent',
        color: active ? '#fff' : 'inherit',
        borderColor: active ? 'transparent' : undefined,
      }}
    >
      {children}
    </button>
  )
}

function PortfolioList({
  accounts,
  own,
  timeline,
}: {
  accounts: AccountPortfolio[] | null
  own?: boolean
  timeline?: Timeline | null
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (accounts === null) {
    return (
      <article className="card" aria-busy>
        Loading your portfolio…
      </article>
    )
  }
  if (accounts.length === 0) {
    return (
      <article className="card">
        <p className="muted" style={{ margin: 0 }}>
          {own
            ? 'No accounts yet — once an account is set up for you, your holdings will show here.'
            : 'No accounts.'}
        </p>
      </article>
    )
  }
  // One card renders open; the rest are compact rows (33 full cards would scroll forever).
  if (accounts.length === 1) return <AccountCard account={accounts[0]} timeline={timeline} />
  return (
    <article className="card" style={{ display: 'grid', gap: '0.5rem' }}>
      {accounts.map((a) => {
        const open = expanded === a.id
        const ab = aheadBehind(a)
        return (
          <div key={a.id}>
            <button
              onClick={() => setExpanded(open ? null : a.id)}
              aria-expanded={open}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                flexWrap: 'wrap',
                textAlign: 'left',
                padding: '0.5rem 0.7rem',
                background: 'var(--b1,rgba(127,127,127,0.06))',
                border: '1px solid var(--border, rgba(127,127,127,0.2))',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'inherit',
              }}
            >
              <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
              <span style={{ fontWeight: 700 }}>{a.name || 'Account'}</span>
              {a.dollarPerDay > 0 && (
                <span className="muted" style={{ fontSize: '0.76rem' }}>
                  {usd(a.dollarPerDay)}/day
                </span>
              )}
              {ab != null && (
                <span
                  className="cz-num"
                  style={{ fontSize: '0.76rem', color: ab >= 0 ? '#22cc78' : '#f46b6b' }}
                >
                  {ab >= 0 ? '+' : '−'}
                  {usd(Math.abs(ab))}
                </span>
              )}
              <span className="cz-num" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                {usd(accountReserved(a))}
              </span>
            </button>
            {open && (
              <div style={{ marginTop: '0.4rem' }}>
                <AccountCard account={a} timeline={timeline} />
              </div>
            )}
          </div>
        )
      })}
    </article>
  )
}

// Admin: manage every account — create (link to a member, set $/day + start), edit, delete, and
// expand any row to "view as" (the full member card).
function AllAccounts({
  accounts,
  members,
  onChanged,
  timeline,
}: {
  accounts: AccountPortfolio[] | null
  members: Member[]
  onChanged: () => Promise<void>
  timeline?: Timeline | null
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkVal, setBulkVal] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  if (accounts === null) {
    return (
      <article className="card" aria-busy>
        Loading all accounts…
      </article>
    )
  }

  const totalDaily = accounts.reduce((s, a) => s + a.dollarPerDay, 0)
  const totalReserved = accounts.reduce((s, a) => s + accountReserved(a), 0)
  const people = new Set(accounts.map((a) => a.ownerUserId).filter(Boolean)).size
  const openSlots = accounts.filter((a) => !a.ownerName && !a.ownerUsername).length
  const q = query.trim().toLowerCase()
  const filtered = q
    ? accounts.filter((a) =>
        [a.name, a.ownerName, a.ownerUsername].some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    : accounts

  async function applyBulk() {
    const v = Number(bulkVal)
    if (!accounts || !Number.isFinite(v) || v < 0) return
    setBulkBusy(true)
    setBulkMsg(null)
    try {
      for (const a of accounts) await adminUpdateAccount(a.id, a.name ?? '', v, a.startDate || null)
      await onChanged()
      setBulkMsg(
        `✓ Set all ${accounts.length} account${accounts.length === 1 ? '' : 's'} to ${usd(v)}/day`,
      )
      setBulkVal('')
      setBulkOpen(false)
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <article className="card" style={{ display: 'grid', gap: '0.5rem' }}>
      {/* fund-wide config summary */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <Stat label="Accounts" value={String(accounts.length)} />
        <Stat label="People linked" value={`${people}${openSlots ? ` · ${openSlots} open` : ''}`} />
        <Stat label="Promised / day" value={`${usd(totalDaily)}`} />
        <Stat label="Reserved total" value={usd(totalReserved)} color="#22cc78" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an account or person…"
          style={{ padding: '0.4rem 0.6rem', flex: '1 1 12rem', minWidth: 0 }}
        />
        <button
          className="btn btn-ghost"
          onClick={() => {
            setBulkOpen((b) => !b)
            setBulkMsg(null)
          }}
          style={{ fontSize: '0.8rem' }}
          aria-expanded={bulkOpen}
        >
          {bulkOpen ? '✕' : '⚙️ Set $/day for all'}
        </button>
        <button
          className="btn"
          onClick={() => {
            setCreating((c) => !c)
            setEditingId(null)
          }}
          style={{
            fontSize: '0.82rem',
            background: creating ? 'transparent' : 'var(--accent,#7c6af7)',
            color: creating ? 'inherit' : '#fff',
            borderColor: creating ? undefined : 'transparent',
          }}
        >
          {creating ? '✕ Cancel' : '➕ New account'}
        </button>
      </div>

      {bulkOpen && (
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '0.6rem 0.7rem',
            border: '1px solid var(--border, rgba(127,127,127,0.25))',
            borderRadius: 8,
          }}
        >
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Promise every account
          </span>
          <span style={{ fontWeight: 700 }}>$</span>
          <input
            value={bulkVal}
            onChange={(e) => setBulkVal(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder="1.00"
            autoFocus
            style={{ padding: '0.35rem 0.5rem', width: '6rem' }}
          />
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            /day — overwrites all {accounts.length}
          </span>
          <button
            className="btn"
            onClick={() => void applyBulk()}
            disabled={bulkBusy || !bulkVal || !Number.isFinite(Number(bulkVal))}
            style={{
              background: 'var(--accent,#7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            {bulkBusy ? 'Applying…' : 'Apply to all'}
          </button>
        </div>
      )}
      {bulkMsg && (
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          {bulkMsg}
        </p>
      )}

      {creating && (
        <AccountForm
          members={members}
          onSaved={async () => {
            setCreating(false)
            await onChanged()
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {accounts.length === 0 && !creating && (
        <p className="muted" style={{ margin: 0 }}>
          No family accounts yet — create one above.
        </p>
      )}
      {accounts.length > 0 && filtered.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          No account matches “{query}”.
        </p>
      )}

      {filtered.map((a) => {
        const open = expanded === a.id
        const editing = editingId === a.id
        const linked = !!(a.ownerName || a.ownerUsername)
        const owner = a.ownerName || (a.ownerUsername ? `@${a.ownerUsername}` : 'Open slot')
        return (
          <div key={a.id}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flexWrap: 'wrap',
                padding: '0.5rem 0.7rem',
                background: 'var(--b1,rgba(127,127,127,0.06))',
                border: '1px solid var(--border, rgba(127,127,127,0.2))',
                borderRadius: 8,
              }}
            >
              <button
                onClick={() => setExpanded(open ? null : a.id)}
                aria-expanded={open}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 700 }}>{a.name || 'Account'}</span>
                <span
                  className={linked ? 'muted' : undefined}
                  style={{
                    fontSize: '0.74rem',
                    ...(linked
                      ? {}
                      : {
                          color: 'var(--accent,#7c6af7)',
                          border: '1px solid rgba(124,106,247,0.4)',
                          borderRadius: 10,
                          padding: '1px 8px',
                        }),
                  }}
                >
                  {linked ? owner : '◇ open slot'}
                </span>
                {a.dollarPerDay > 0 && (
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    · {usd(a.dollarPerDay)}/day
                  </span>
                )}
                <span className="cz-num" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  {usd(accountReserved(a))}
                </span>
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditingId(editing ? null : a.id)
                  setExpanded(null)
                }}
                style={{ fontSize: '0.74rem' }}
              >
                {editing ? 'Close' : 'Edit'}
              </button>
            </div>
            {editing && (
              <AccountForm
                account={a}
                members={members}
                onSaved={async () => {
                  setEditingId(null)
                  await onChanged()
                }}
                onCancel={() => setEditingId(null)}
                onDeleted={async () => {
                  setEditingId(null)
                  await onChanged()
                }}
              />
            )}
            {open && (
              <div style={{ marginTop: '0.4rem' }}>
                <AccountCard account={a} timeline={timeline} />
              </div>
            )}
          </div>
        )
      })}
    </article>
  )
}

// Create or edit a family account. Create mode shows a member picker; edit mode keeps the owner.
function AccountForm({
  account,
  members,
  onSaved,
  onCancel,
  onDeleted,
}: {
  account?: AccountPortfolio
  members: Member[]
  onSaved: () => Promise<void>
  onCancel: () => void
  onDeleted?: () => Promise<void>
}) {
  const isEdit = !!account
  const [ownerUid, setOwnerUid] = useState(account?.ownerUserId ?? members[0]?.userId ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [dpd, setDpd] = useState(account ? String(account.dollarPerDay || '') : '')
  const [start, setStart] = useState(account?.startDate ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      if (isEdit) {
        await adminUpdateAccount(account.id, name, Number(dpd) || 0, start || null)
        // owner changed → hand the account (holdings and all) to the new member
        if (ownerUid && ownerUid !== (account.ownerUserId ?? '')) {
          await adminReassignAccount(account.id, ownerUid)
          await adminEnableFinance(ownerUid).catch(() => {})
        }
      } else {
        await adminCreateAccount(ownerUid, name, Number(dpd) || 0, start || null)
        // creating a member's fund account should let them see it — best-effort, since the
        // account itself is the important part (the Admin feature toggle is the fallback).
        await adminEnableFinance(ownerUid).catch(() => {})
      }
      await onSaved()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  async function del() {
    if (!account || !onDeleted) return
    setBusy(true)
    setErr(null)
    try {
      await adminDeleteAccount(account.id)
      await onDeleted()
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setBusy(false)
    }
  }

  const field: React.CSSProperties = { padding: '0.4rem 0.6rem' }
  return (
    <form
      onSubmit={(e) => void save(e)}
      style={{
        display: 'grid',
        gap: '0.6rem',
        padding: '0.7rem',
        margin: '0.4rem 0',
        border: '1px solid var(--border, rgba(127,127,127,0.25))',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Member{isEdit ? ' (change to hand this account over)' : ''}
          </span>
          <select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} style={field}>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName || (m.username ? '@' + m.username : m.userId.slice(0, 8))}
                {m.role ? ` · ${m.role}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Account name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. College Fund"
            style={field}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            $/day promised
          </span>
          <input
            value={dpd}
            onChange={(e) => setDpd(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            style={field}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Start date
          </span>
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            type="date"
            style={field}
          />
        </label>
      </div>
      {err && <p style={{ margin: 0, color: 'var(--accent-2)', fontSize: '0.82rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn"
          type="submit"
          disabled={busy || !name.trim() || (!isEdit && !ownerUid)}
          style={{ background: 'var(--accent,#7c6af7)', color: '#fff', borderColor: 'transparent' }}
        >
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {isEdit && onDeleted && (
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              gap: '0.4rem',
              alignItems: 'center',
            }}
          >
            {confirmDel ? (
              <>
                <span style={{ fontSize: '0.78rem', color: '#f46b6b' }}>Delete this account?</span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void del()}
                  disabled={busy}
                  style={{
                    background: '#e5484d',
                    color: '#fff',
                    borderColor: 'transparent',
                    fontSize: '0.78rem',
                  }}
                >
                  Yes, delete
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  style={{ fontSize: '0.78rem' }}
                >
                  No
                </button>
              </>
            ) : (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setConfirmDel(true)}
                style={{
                  color: '#f46b6b',
                  borderColor: 'rgba(244,107,107,0.5)',
                  fontSize: '0.78rem',
                }}
              >
                🗑 Delete
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  )
}

function AccountCard({
  account,
  timeline,
}: {
  account: AccountPortfolio
  timeline?: Timeline | null
}) {
  const [showAll, setShowAll] = useState(false)
  const [openSym, setOpenSym] = useState<string | null>(null)
  const hVal = (h: AccountPortfolio['holdings'][number]) =>
    h.price != null ? h.units * h.price : 0
  const total = accountReserved(account)
  const promised = promisedToDate(account)
  const ab = aheadBehind(account)
  const unpriced = account.holdings.filter((h) => h.price == null).length
  const holdings = [...account.holdings].sort((x, y) => hVal(y) - hVal(x))
  const HOLDINGS_PREVIEW = 10
  const shown = showAll ? holdings : holdings.slice(0, HOLDINGS_PREVIEW)

  // daily price series per symbol (for sparklines + the "today" change)
  const priceSeries = useMemo(() => {
    const m = new Map<string, { date: string; price: number }[]>()
    if (timeline) {
      for (const p of timeline.prices) {
        const arr = m.get(p.symbol) ?? []
        arr.push(p)
        m.set(p.symbol, arr)
      }
      for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date))
    }
    return m
  }, [timeline])

  const dayChange = useMemo(() => {
    let sum = 0
    let any = false
    for (const h of account.holdings) {
      const s = priceSeries.get(h.symbol)
      if (!s || s.length < 2) continue
      any = true
      sum += h.units * (s[s.length - 1].price - s[s.length - 2].price)
    }
    return any ? sum : null
  }, [account, priceSeries])

  // Broker-style average cost per share (buys blend in, sells leave at the average), so
  // each held position gets a percent gain/loss from its cost to the current price.
  const avgCost = useMemo(
    () => (timeline ? avgCostBySymbol(timeline) : new Map<string, number>()),
    [timeline],
  )
  const plFor = (h: AccountPortfolio['holdings'][number]) => {
    const ac = avgCost.get(h.symbol)
    if (ac == null || ac <= 0 || h.price == null) return null
    return { avgCost: ac, pct: ((h.price - ac) / ac) * 100, dollars: (h.price - ac) * h.units }
  }

  const toggleSym = (symbol: string) => setOpenSym((cur) => (cur === symbol ? null : symbol))

  return (
    <article className="card" style={{ display: 'grid', gap: '0.9rem' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{account.name || 'Account'}</h3>
        {account.dollarPerDay > 0 && (
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              background: 'rgba(124,106,247,0.14)',
              color: 'var(--accent,#7c6af7)',
              border: '1px solid rgba(124,106,247,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
          >
            {usd(account.dollarPerDay)}/day
          </span>
        )}
      </div>

      {/* summary stats */}
      <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
        <Stat label="Reserved value" value={usd(total)} big />
        {dayChange != null && Math.abs(dayChange) >= 0.005 && (
          <Stat
            label="Today"
            value={`${dayChange >= 0 ? '▲ +' : '▼ −'}${usd(Math.abs(dayChange))}`}
            color={dayChange >= 0 ? '#22cc78' : '#f46b6b'}
          />
        )}
        {promised != null && <Stat label="Promised to date" value={usd(promised)} />}
        {ab != null && (
          <Stat
            label="Schedule"
            value={`${ab >= 0 ? '+' : '−'}${usd(Math.abs(ab))} ${ab >= 0 ? 'ahead' : 'behind'}`}
            color={ab >= 0 ? '#22cc78' : '#f46b6b'}
          />
        )}
        <Stat label="Holdings" value={String(holdings.length)} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>
        Reserved value is what these holdings are worth at the latest prices
        {(() => {
          const asOf = account.holdings.reduce<string | null>(
            (acc, h) => (h.priceAt && (!acc || h.priceAt > acc) ? h.priceAt : acc),
            null,
          )
          return asOf
            ? ` (updated ${new Date(asOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })})`
            : ''
        })()}
        . &ldquo;Ahead&rdquo; means more is set aside than the {usd(account.dollarPerDay)}/day
        promise so far; &ldquo;behind&rdquo; means less.
        {unpriced > 0 &&
          ` Covers ${holdings.length - unpriced} of ${holdings.length} holdings — the rest aren’t priced yet.`}
      </p>

      {holdings.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          Nothing allocated to this account yet.
        </p>
      ) : (
        <>
          {/* allocation bar */}
          <div
            style={{
              display: 'flex',
              height: 12,
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--b1, rgba(127,127,127,0.18))',
            }}
            title="Allocation by asset"
          >
            {holdings.map((h) => (
              <span
                key={h.symbol}
                title={`${h.symbol}: ${usd(hVal(h))} — tap for details`}
                onClick={() => {
                  setShowAll(true)
                  toggleSym(h.symbol)
                }}
                style={{
                  width: `${total > 0 ? (hVal(h) / total) * 100 : 0}%`,
                  background: assetColor(h.symbol),
                  cursor: 'pointer',
                  outline: openSym === h.symbol ? '2px solid var(--fg,#fff)' : 'none',
                  outlineOffset: -2,
                }}
              />
            ))}
          </div>

          {/* holdings list */}
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {shown.map((h) => {
              const val = hVal(h)
              const pct = total > 0 ? (val / total) * 100 : 0
              const isOpen = openSym === h.symbol
              const series = priceSeries.get(h.symbol) ?? []
              const spark = series.slice(-90).map((p) => p.price)
              const pl = plFor(h)
              return (
                <div key={h.symbol}>
                  <div
                    onClick={() => toggleSym(h.symbol)}
                    role="button"
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      flexWrap: 'wrap',
                      padding: '0.4rem 0.2rem',
                      borderBottom: '1px solid var(--b1, rgba(127,127,127,0.12))',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: assetColor(h.symbol),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 700, minWidth: '4.5rem' }}>{h.symbol}</span>
                    <span style={{ opacity: 0.5, fontSize: '0.72rem' }}>{isOpen ? '▾' : '▸'}</span>
                    <span
                      className="cz-num"
                      style={{
                        marginLeft: 'auto',
                        width: '6rem',
                        textAlign: 'right',
                        fontWeight: 700,
                      }}
                      title="Current worth (units × price)"
                    >
                      {h.price == null ? '—' : usd(val)}
                    </span>
                    <span
                      className="cz-num"
                      title={
                        pl
                          ? `${pl.pct >= 0 ? 'Up' : 'Down'} from your average cost of ${usd(pl.avgCost)}/share`
                          : 'Not enough cost history to show gain/loss'
                      }
                      style={{
                        width: '4.5rem',
                        textAlign: 'right',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        color: pl ? (pl.pct >= 0 ? '#22cc78' : '#f46b6b') : 'var(--muted,#888)',
                      }}
                    >
                      {pl ? `${pl.pct >= 0 ? '▲ ' : '▼ '}${Math.abs(pl.pct).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  {isOpen && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1.2rem',
                        flexWrap: 'wrap',
                        padding: '0.6rem 0.4rem 0.7rem 1.2rem',
                        borderBottom: '1px solid var(--b1, rgba(127,127,127,0.12))',
                        background: 'var(--b1, rgba(127,127,127,0.05))',
                        borderRadius: 8,
                      }}
                    >
                      <Stat
                        label="Your share"
                        value={`${h.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units`}
                      />
                      {pl && <Stat label="Avg cost" value={`${usd(pl.avgCost)}/sh`} />}
                      {h.price != null && <Stat label="Price now" value={usd(h.price)} />}
                      {h.price != null && <Stat label="Worth" value={usd(val)} />}
                      {pl && (
                        <Stat
                          label="Gain / loss"
                          value={`${pl.dollars >= 0 ? '+' : '−'}${usd(Math.abs(pl.dollars))} · ${pl.pct >= 0 ? '▲' : '▼'}${Math.abs(pl.pct).toFixed(1)}%`}
                          color={pl.pct >= 0 ? '#22cc78' : '#f46b6b'}
                        />
                      )}
                      <Stat label="Of this fund" value={`${pct.toFixed(1)}%`} />
                      {spark.length >= 2 && (
                        <span style={{ marginLeft: 'auto', display: 'grid', gap: 2 }}>
                          <span
                            className="muted"
                            style={{
                              fontSize: '0.68rem',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            Last {spark.length} days
                          </span>
                          <Sparkline points={spark} />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {holdings.length > HOLDINGS_PREVIEW && (
              <button
                className="btn btn-ghost"
                onClick={() => setShowAll((s) => !s)}
                style={{ fontSize: '0.78rem', justifySelf: 'start' }}
                aria-expanded={showAll}
              >
                {showAll ? '▴ Show top holdings only' : `▾ Show all ${holdings.length} holdings`}
              </button>
            )}
          </div>
        </>
      )}
    </article>
  )
}

// Tiny inline price line for a holding's expanded detail — green when up over the window.
function Sparkline({
  points,
  width = 130,
  height = 34,
}: {
  points: number[]
  width?: number
  height?: number
}) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const d = points
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`,
    )
    .join('')
  const up = points[points.length - 1] >= points[0]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }} aria-hidden>
      <path d={d} fill="none" stroke={up ? '#22cc78' : '#f46b6b'} strokeWidth="1.6" />
    </svg>
  )
}

function Stat({
  label,
  value,
  big,
  color,
}: {
  label: string
  value: string
  big?: boolean
  color?: string
}) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span
        className="muted"
        style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </span>
      <span
        className="cz-num"
        style={{ fontWeight: 800, fontSize: big ? '1.5rem' : '1.05rem', color }}
      >
        {value}
      </span>
    </div>
  )
}

// Overall "are we ahead or behind the dollar-a-day promise?" across a set of accounts.
function ScheduleSummary({ accounts }: { accounts: AccountPortfolio[] }) {
  const t = portfolioTotals(accounts)
  if (t.tracked === 0) return null
  const ahead = t.aheadBehind >= 0
  const days = runwayDays(t.aheadBehind, t.dailyRate)
  return (
    <article className="card" style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
        <Stat label="Reserved value" value={usd(t.invested)} big />
        <Stat label="Promised to date" value={usd(t.promised)} />
        <Stat
          label="Schedule"
          value={`${ahead ? '+' : '−'}${usd(Math.abs(t.aheadBehind))} ${ahead ? 'ahead' : 'behind'}`}
          big
          color={ahead ? '#22cc78' : '#f46b6b'}
        />
        {days != null && (
          <Stat
            label={ahead ? 'Days ahead' : 'Days behind'}
            value={`≈ ${days}`}
            color={ahead ? '#22cc78' : '#f46b6b'}
          />
        )}
        <Stat label="Accounts" value={String(t.tracked)} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        Each account is promised $1 a day; “reserved value” is what the family-marked holdings are
        worth today. Ahead means more value is reserved than promised so far.
      </p>
    </article>
  )
}

// Admin: the trades ledger — every trade with its allocation status (family fund / partial /
// still yours), expandable to see the per-account split and assign shares by hand (e.g. one
// share of one trade to one person). Unassigned units stay yours until you assign them.
function TradesLedger({ accounts }: { accounts: AccountPortfolio[] | null }) {
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [allocs, setAllocs] = useState<AllocationRow[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busySym, setBusySym] = useState<string | null>(null)
  const [fixFor, setFixFor] = useState<string | null>(null)
  const [fixVal, setFixVal] = useState('')
  const [fixCost, setFixCost] = useState('')
  const [err, setErr] = useState<string | null>(null)
  // trade-list filters + lazy rendering (1,500+ rows would drown the page)
  const [fSymbol, setFSymbol] = useState('')
  const [fPlatform, setFPlatform] = useState<'all' | 'cashapp' | 'robinhood' | 'manual'>('all')
  const [fKind, setFKind] = useState<'all' | 'buys' | 'sells' | 'adjustments'>('all')
  const [visibleCount, setVisibleCount] = useState(50)

  const load = async () => {
    const [t, a, p] = await Promise.all([fetchMyTrades(), fetchMyAllocations(), fetchPositions()])
    t.sort((x, y) => y.date.localeCompare(x.date) || x.symbol.localeCompare(y.symbol))
    setTrades(t)
    setAllocs(a)
    setPositions(p)
  }

  const posKey = (p: Position) => `${p.symbol}|${p.platform}`

  const toggleDesignation = (pos: Position) => {
    setBusySym(posKey(pos))
    setErr(null)
    setSymbolDesignation(pos.symbol, pos.platform, !pos.isFamily)
      .then(load)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusySym(null))
  }

  // Save whichever fields were filled: true units (correctPosition) and/or true avg cost.
  const saveCorrection = (pos: Position) => {
    const v = parseFloat(fixVal)
    const c = fixCost.trim() === '' ? null : parseFloat(fixCost)
    // only re-correct units if the number actually changed (avoids a no-op adjustment trade)
    const doUnits = Number.isFinite(v) && v >= 0 && Math.abs(v - pos.units) > 1e-9
    const wantCost = fixCost.trim() !== ''
    const doCost = wantCost && Number.isFinite(c) && (c as number) >= 0
    if (!doUnits && !doCost) return
    setBusySym(posKey(pos))
    setErr(null)
    Promise.resolve()
      .then(() => (doUnits ? correctPosition(pos.symbol, pos.platform, v) : undefined))
      .then(() => (doCost ? setPositionCost(pos.symbol, pos.platform, c as number) : undefined))
      .then(() => {
        setFixFor(null)
        setFixVal('')
        setFixCost('')
        return load()
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusySym(null))
  }
  useEffect(() => {
    void load().catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  if (err) {
    return (
      <article className="card">
        <p style={{ margin: 0, color: 'var(--accent-2)' }}>{err}</p>
      </article>
    )
  }
  if (trades === null) {
    return (
      <article className="card" aria-busy>
        Loading trades…
      </article>
    )
  }

  const accName = (id: string) =>
    accounts?.find((a) => a.id === id)?.name || `Account ${id.slice(0, 6)}…`
  const allocatedUnits = (tradeId: string) =>
    allocs.filter((a) => a.executedTradeId === tradeId).reduce((s, a) => s + a.unitsAllocated, 0)

  const fmtU = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  const portfolioValue = positions.reduce((sum, p) => sum + (p.value ?? 0), 0)
  const familyValue = positions.reduce((sum, p) => sum + (p.isFamily ? (p.value ?? 0) : 0), 0)
  const pricedCount = positions.filter((p) => p.value != null).length
  const familyCount = positions.filter((p) => p.isFamily).length
  const brokerLabel = (pl: string) =>
    pl === 'cashapp' ? 'Cash App' : pl === 'robinhood' ? 'Robinhood' : pl
  const byPlatform = new Map<string, Position[]>()
  for (const p of positions) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p])

  const nBuys = trades.filter((t) => t.units > 0 && t.dollars !== 0).length
  const nSells = trades.filter((t) => t.units < 0 && t.dollars !== 0).length
  const nAdj = trades.filter((t) => t.dollars === 0).length
  const filtered = trades.filter((t) => {
    if (fSymbol && !t.symbol.toUpperCase().includes(fSymbol.toUpperCase())) return false
    if (fPlatform !== 'all' && t.platform !== fPlatform) return false
    if (fKind === 'buys' && !(t.units > 0 && t.dollars !== 0)) return false
    if (fKind === 'sells' && !(t.units < 0 && t.dollars !== 0)) return false
    if (fKind === 'adjustments' && t.dollars !== 0) return false
    return true
  })
  const visible = filtered.slice(0, visibleCount)

  return (
    <>
      <article className="card" style={{ display: 'grid', gap: '0.7rem' }}>
        <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
          <Stat label="Family fund (worth)" value={usd(familyValue)} big color="#22cc78" />
          <Stat
            label="Still yours (worth)"
            value={usd(Math.max(0, portfolioValue - familyValue))}
            big
          />
          <Stat label="Trades on record" value={String(trades.length)} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>
          This tab is your control room: mark each holding Family or Personal below, fix any wrong
          share count with ✏️, and dig into the raw trade history at the bottom if you ever need to
          audit where a number came from.
        </p>
        <SetPriceForm symbols={[...new Set(trades.map((t) => t.symbol))].sort()} />
      </article>

      {positions.length > 0 && (
        <article className="card" style={{ display: 'grid', gap: '0.45rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
            <strong>Your portfolio</strong>
            <span className="cz-num" style={{ fontWeight: 800, fontSize: '1.15rem' }}>
              {usd(portfolioValue)}
            </span>
            <span className="muted" style={{ fontSize: '0.74rem' }}>
              {positions.length} symbols · {pricedCount} priced · {familyCount} marked family
            </span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>
            Your synced portfolio, grouped by broker — the same ticker can be Family on one and
            Personal on another. Mark a holding <strong>👨‍👩‍👧 Family</strong> to split it across the
            fund; wrong count after a split the export missed? Use ✏️ to set the true units.
          </p>
          {[...byPlatform.entries()].map(([platform, list]) => {
            const subtotal = list.reduce((s, p) => s + (p.value ?? 0), 0)
            return (
              <div key={platform} style={{ display: 'grid', gap: '0.4rem' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    marginTop: '0.5rem',
                  }}
                >
                  <strong style={{ fontSize: '0.9rem' }}>{brokerLabel(platform)}</strong>
                  <span className="muted cz-num" style={{ fontSize: '0.76rem' }}>
                    {list.length} holdings · {usd(subtotal)}
                  </span>
                </div>
                {list.map((p) => {
                  const key = posKey(p)
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        flexWrap: 'wrap',
                        padding: '0.35rem 0.5rem',
                        background: 'var(--b1,rgba(127,127,127,0.06))',
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontWeight: 700, minWidth: '3.5rem' }}>{p.symbol}</span>
                      <span className="muted cz-num" style={{ fontSize: '0.76rem' }}>
                        {fmtU(p.units)} units{p.value != null ? ` · worth ${usd(p.value)}` : ''}
                      </span>
                      {p.units < 0 && (
                        <span
                          style={{ fontSize: '0.7rem', color: '#f46b6b', fontWeight: 700 }}
                          title="More sold than bought in the data — usually a stock split the export missed"
                        >
                          oversold?
                        </span>
                      )}
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          const opening = fixFor !== key
                          setFixFor(opening ? key : null)
                          setFixVal(opening ? String(Math.max(0, p.units)) : '')
                          setFixCost('')
                        }}
                        disabled={busySym !== null}
                        title="Fix the true units and/or the true average cost for this holding."
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                        aria-expanded={fixFor === key}
                      >
                        {fixFor === key ? '✕' : '✏️'}
                      </button>
                      {fixFor === key && (
                        <span
                          style={{
                            display: 'inline-flex',
                            gap: '0.35rem',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={fixVal}
                            onChange={(e) => setFixVal(e.target.value)}
                            placeholder="true units"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveCorrection(p)
                            }}
                            style={{ padding: '0.2rem 0.4rem', width: '7rem' }}
                          />
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={fixCost}
                            onChange={(e) => setFixCost(e.target.value)}
                            placeholder="avg cost $/sh"
                            title="Your true average cost per share — sets percent gain/loss when the data can't"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveCorrection(p)
                            }}
                            style={{ padding: '0.2rem 0.4rem', width: '8rem' }}
                          />
                          <button
                            className="btn"
                            onClick={() => saveCorrection(p)}
                            disabled={busySym !== null}
                            style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem' }}
                          >
                            Set
                          </button>
                        </span>
                      )}
                      <button
                        className="btn btn-ghost"
                        onClick={() => toggleDesignation(p)}
                        disabled={busySym !== null}
                        aria-pressed={p.isFamily}
                        title={
                          p.isFamily
                            ? 'In the family fund — click to make personal'
                            : 'Yours — click to add to the family fund'
                        }
                        style={{
                          marginLeft: 'auto',
                          fontSize: '0.74rem',
                          padding: '0.18rem 0.6rem',
                          color: p.isFamily ? '#22cc78' : 'inherit',
                          borderColor: p.isFamily ? 'rgba(34,204,120,0.5)' : undefined,
                        }}
                      >
                        {busySym === key ? '…' : p.isFamily ? '👨‍👩‍👧 Family' : '🔒 Personal'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </article>
      )}

      <article className="card" style={{ display: 'grid', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
          <strong>Trade history</strong>
          <span className="muted cz-num" style={{ fontSize: '0.76rem' }}>
            {trades.length} on record — {nBuys} buys · {nSells} sells · {nAdj} splits/corrections
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={fSymbol}
            onChange={(e) => {
              setFSymbol(e.target.value)
              setVisibleCount(50)
            }}
            placeholder="Filter by symbol…"
            style={{ padding: '0.35rem 0.5rem', width: '10rem' }}
          />
          <select
            value={fPlatform}
            onChange={(e) => {
              setFPlatform(e.target.value as typeof fPlatform)
              setVisibleCount(50)
            }}
            style={{ padding: '0.35rem 0.5rem' }}
          >
            <option value="all">Both brokers</option>
            <option value="cashapp">Cash App</option>
            <option value="robinhood">Robinhood</option>
            <option value="manual">Manual fixes</option>
          </select>
          <select
            value={fKind}
            onChange={(e) => {
              setFKind(e.target.value as typeof fKind)
              setVisibleCount(50)
            }}
            style={{ padding: '0.35rem 0.5rem' }}
          >
            <option value="all">Buys + sells + fixes</option>
            <option value="buys">Buys only</option>
            <option value="sells">Sells only</option>
            <option value="adjustments">Splits/corrections</option>
          </select>
          {filtered.length !== trades.length && (
            <span className="muted" style={{ fontSize: '0.76rem' }}>
              {filtered.length} match
            </span>
          )}
        </div>
        {trades.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            No trades yet — run the sync script after your next broker export.
          </p>
        )}
        {visible.map((t) => {
          const got = allocatedUnits(t.id)
          const absU = Math.abs(t.units)
          const remaining = t.units - got
          const isSell = t.units < 0
          const full = absU > 0 && Math.abs(remaining) <= absU * 1e-6
          const none = Math.abs(got) <= absU * 1e-6
          const status = full ? '🟢 Family fund' : none ? '⚪ Yours' : '🟡 Partial'
          const isOpen = open === t.id
          const rows = allocs.filter((a) => a.executedTradeId === t.id)
          return (
            <div key={t.id}>
              <button
                onClick={() => setOpen(isOpen ? null : t.id)}
                aria-expanded={isOpen}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  textAlign: 'left',
                  padding: '0.5rem 0.7rem',
                  background: 'var(--b1,rgba(127,127,127,0.06))',
                  border: '1px solid var(--border, rgba(127,127,127,0.2))',
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 700, minWidth: '3.5rem' }}>{t.symbol}</span>
                {t.dollars === 0 ? (
                  <span className="muted" style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                    SPLIT/ADJ
                  </span>
                ) : (
                  isSell && (
                    <span style={{ fontSize: '0.68rem', color: '#f46b6b', fontWeight: 700 }}>
                      SELL
                    </span>
                  )
                )}
                <span className="muted cz-num" style={{ fontSize: '0.78rem' }}>
                  {t.date}
                </span>
                <span className="muted cz-num" style={{ fontSize: '0.78rem' }}>
                  {fmtU(t.units)} @ {usd(t.price)}
                </span>
                <span style={{ fontSize: '0.76rem' }}>{status}</span>
                <span className="cz-num" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  {usd(t.dollars)}
                </span>
              </button>
              {isOpen && (
                <div
                  style={{
                    display: 'grid',
                    gap: '0.5rem',
                    padding: '0.6rem 0.7rem',
                    margin: '0.3rem 0 0.5rem',
                    border: '1px solid var(--border, rgba(127,127,127,0.2))',
                    borderRadius: 8,
                  }}
                >
                  {rows.length > 0 ? (
                    rows.map((a) => (
                      <div
                        key={a.id}
                        style={{ display: 'flex', gap: '0.6rem', fontSize: '0.84rem' }}
                      >
                        <span style={{ fontWeight: 600 }}>{accName(a.familyAccountId)}</span>
                        <span className="muted cz-num" style={{ marginLeft: 'auto' }}>
                          {fmtU(a.unitsAllocated)} units ·{' '}
                          {usd(t.units !== 0 ? (a.unitsAllocated / t.units) * t.dollars : 0)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
                      Nothing assigned yet — all {fmtU(t.units)} units are still yours.
                    </p>
                  )}
                  {!isSell && remaining > absU * 1e-6 && accounts && accounts.length > 0 && (
                    <AssignForm
                      accounts={accounts}
                      remaining={remaining}
                      onAssign={async (accountId, units) => {
                        await assignAllocation(accountId, t.id, units)
                        await load()
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length > visibleCount && (
          <button
            className="btn btn-ghost"
            onClick={() => setVisibleCount((n) => n + 100)}
            style={{ fontSize: '0.78rem', justifySelf: 'start' }}
          >
            ▾ Show {Math.min(100, filtered.length - visibleCount)} more (
            {filtered.length - visibleCount} remaining)
          </button>
        )}
      </article>
    </>
  )
}

// Manually cache a symbol's price — the fallback when the daily sweep has no free source
// for it. Prices show up as value / gain-loss on the portfolio cards.
function SetPriceForm({ symbols }: { symbols: string[] }) {
  const [symbol, setSymbol] = useState(symbols[0] ?? '')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const parsed = parseFloat(price)
  const valid = symbol && Number.isFinite(parsed) && parsed > 0
  if (symbols.length === 0) return null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        setMsg(null)
        adminSetPrice(symbol, parsed)
          .then(() => {
            setPrice('')
            setMsg(`✓ ${symbol} price set — shown on the portfolio cards`)
          })
          .catch((e2: unknown) => setMsg(e2 instanceof Error ? e2.message : String(e2)))
          .finally(() => setBusy(false))
      }}
      style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        💲 Set a price by hand
      </span>
      <select
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        style={{ padding: '0.35rem 0.5rem' }}
      >
        {symbols.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="any"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="price ($)"
        style={{ padding: '0.35rem 0.5rem', width: '7.5rem' }}
      />
      <button
        className="btn"
        type="submit"
        disabled={busy || !valid}
        style={{ fontSize: '0.8rem' }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {msg && (
        <span className="muted" style={{ fontSize: '0.76rem' }}>
          {msg}
        </span>
      )}
    </form>
  )
}

// Assign some of a trade's remaining units to one account.
function AssignForm({
  accounts,
  remaining,
  onAssign,
}: {
  accounts: AccountPortfolio[]
  remaining: number
  onAssign: (accountId: string, units: number) => Promise<void>
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [units, setUnits] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const parsed = parseFloat(units)
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= remaining + 1e-9

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || !accountId) return
        setBusy(true)
        setErr(null)
        onAssign(accountId, parsed)
          .then(() => setUnits(''))
          .catch((e2: unknown) => setErr(e2 instanceof Error ? e2.message : String(e2)))
          .finally(() => setBusy(false))
      }}
      style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        Assign to
      </span>
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        style={{ padding: '0.35rem 0.5rem' }}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name || 'Account'}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="any"
        value={units}
        onChange={(e) => setUnits(e.target.value)}
        placeholder={`units (≤ ${remaining.toLocaleString(undefined, { maximumFractionDigits: 6 })})`}
        style={{ padding: '0.35rem 0.5rem', width: '11rem' }}
      />
      <button
        className="btn"
        type="submit"
        disabled={busy || !valid || !accountId}
        style={{
          fontSize: '0.8rem',
          background: 'var(--accent,#7c6af7)',
          color: '#fff',
          borderColor: 'transparent',
        }}
      >
        {busy ? 'Assigning…' : 'Assign'}
      </button>
      {err && <span style={{ color: 'var(--accent-2)', fontSize: '0.78rem' }}>{err}</span>}
    </form>
  )
}
