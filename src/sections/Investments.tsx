// Family "dollar-a-day" investments. Members see their own read-only portfolio (holdings at
// cost + dollars/day). Admins also get an "All accounts" view to see every account and expand
// any one into exactly what that member sees ("view as"). Live prices / profit-loss come later.
import { useEffect, useState } from 'react'
import {
  fetchMyPortfolio,
  fetchAllPortfolios,
  checkIsAdmin,
  fetchMembers,
  adminCreateAccount,
  adminUpdateAccount,
  adminDeleteAccount,
  adminEnableFinance,
  accountTotalCost,
  promisedToDate,
  aheadBehind,
  portfolioTotals,
  assetColor,
  usd,
  type AccountPortfolio,
  type Member,
} from '../finance/portfolio'
import { DEMO_PORTFOLIO } from '../finance/demoPortfolio'

export function Investments({ demo = false }: { demo?: boolean }) {
  const [mine, setMine] = useState<AccountPortfolio[] | null>(null)
  const [all, setAll] = useState<AccountPortfolio[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [mode, setMode] = useState<'mine' | 'all'>('mine')
  const [error, setError] = useState<string | null>(null)

  const reloadAll = async () => {
    setAll(await fetchAllPortfolios())
  }

  useEffect(() => {
    if (demo) {
      setMine(DEMO_PORTFOLIO)
      return
    }
    let alive = true
    void (async () => {
      try {
        const [m, admin] = await Promise.all([fetchMyPortfolio(), checkIsAdmin()])
        if (!alive) return
        setMine(m)
        setIsAdmin(admin)
        if (admin) {
          const [a, mem] = await Promise.all([fetchAllPortfolios(), fetchMembers()])
          if (alive) {
            setAll(a)
            setMembers(mem)
          }
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
            </span>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {demo
            ? 'A sample of the dollar-a-day fund — each account gets $1/day, invested and split across holdings. This is example data.'
            : mode === 'all'
              ? 'Every family account — expand one to see exactly what that member sees.'
              : 'Your dollar-a-day portfolio — what’s been invested for you and how it’s allocated. Live prices and profit/loss are coming soon.'}
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
          {mine && mine.length > 0 && <ScheduleSummary accounts={mine} />}
          <PortfolioList accounts={mine} own />
        </>
      ) : (
        <>
          {all && all.length > 0 && <ScheduleSummary accounts={all} />}
          <AllAccounts accounts={all} members={members} onChanged={reloadAll} />
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

function PortfolioList({ accounts, own }: { accounts: AccountPortfolio[] | null; own?: boolean }) {
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
  return (
    <>
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
    </>
  )
}

// Admin: manage every account — create (link to a member, set $/day + start), edit, delete, and
// expand any row to "view as" (the full member card).
function AllAccounts({
  accounts,
  members,
  onChanged,
}: {
  accounts: AccountPortfolio[] | null
  members: Member[]
  onChanged: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  if (accounts === null) {
    return (
      <article className="card" aria-busy>
        Loading all accounts…
      </article>
    )
  }

  return (
    <article className="card" style={{ display: 'grid', gap: '0.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </span>
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

      {accounts.map((a) => {
        const open = expanded === a.id
        const editing = editingId === a.id
        const owner = a.ownerName || (a.ownerUsername ? `@${a.ownerUsername}` : 'Unlinked')
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
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {owner}
                </span>
                {a.dollarPerDay > 0 && (
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    · {usd(a.dollarPerDay)}/day
                  </span>
                )}
                <span className="cz-num" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  {usd(accountTotalCost(a))}
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
                <AccountCard account={a} />
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
        {!isEdit && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Member
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
        )}
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

function AccountCard({ account }: { account: AccountPortfolio }) {
  const total = accountTotalCost(account)
  const promised = promisedToDate(account)
  const ab = aheadBehind(account)
  const holdings = [...account.holdings].sort((x, y) => y.cost - x.cost)

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
        <Stat label="Invested (at cost)" value={usd(total)} big />
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
                title={`${h.symbol}: ${usd(h.cost)}`}
                style={{
                  width: `${total > 0 ? (h.cost / total) * 100 : 0}%`,
                  background: assetColor(h.symbol),
                }}
              />
            ))}
          </div>

          {/* holdings list */}
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {holdings.map((h) => {
              const pct = total > 0 ? (h.cost / total) * 100 : 0
              return (
                <div
                  key={h.symbol}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.4rem 0.2rem',
                    borderBottom: '1px solid var(--b1, rgba(127,127,127,0.12))',
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
                  {h.assetType && (
                    <span className="muted" style={{ fontSize: '0.74rem' }}>
                      {h.assetType}
                    </span>
                  )}
                  <span
                    className="muted cz-num"
                    style={{ marginLeft: 'auto', fontSize: '0.82rem' }}
                    title="Units held"
                  >
                    {h.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units
                  </span>
                  <span
                    className="cz-num"
                    style={{ width: '6rem', textAlign: 'right', fontWeight: 700 }}
                  >
                    {usd(h.cost)}
                  </span>
                  <span
                    className="muted cz-num"
                    style={{ width: '3rem', textAlign: 'right', fontSize: '0.78rem' }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </article>
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
  return (
    <article className="card" style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
      <Stat label="Invested" value={usd(t.invested)} big />
      <Stat label="Promised to date" value={usd(t.promised)} />
      <Stat
        label="Schedule"
        value={`${ahead ? '+' : '−'}${usd(Math.abs(t.aheadBehind))} ${ahead ? 'ahead' : 'behind'}`}
        big
        color={ahead ? '#22cc78' : '#f46b6b'}
      />
      <Stat label="Accounts" value={String(t.tracked)} />
    </article>
  )
}
