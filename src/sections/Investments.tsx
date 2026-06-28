// Family "dollar-a-day" investments. Members see their own read-only portfolio (holdings at
// cost + dollars/day). Admins also get an "All accounts" view to see every account and expand
// any one into exactly what that member sees ("view as"). Live prices / profit-loss come later.
import { useEffect, useState } from 'react'
import {
  fetchMyPortfolio,
  fetchAllPortfolios,
  checkIsAdmin,
  accountTotalCost,
  promisedToDate,
  assetColor,
  usd,
  type AccountPortfolio,
} from '../finance/portfolio'

export function Investments() {
  const [mine, setMine] = useState<AccountPortfolio[] | null>(null)
  const [all, setAll] = useState<AccountPortfolio[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [mode, setMode] = useState<'mine' | 'all'>('mine')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [m, admin] = await Promise.all([fetchMyPortfolio(), checkIsAdmin()])
        if (!alive) return
        setMine(m)
        setIsAdmin(admin)
        if (admin) {
          const a = await fetchAllPortfolios()
          if (alive) setAll(a)
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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
          {mode === 'all'
            ? 'Every family account — expand one to see exactly what that member sees.'
            : 'Your dollar-a-day portfolio — what’s been invested for you and how it’s allocated. Live prices and profit/loss are coming soon.'}
        </p>
      </header>

      {error && (
        <article className="card">
          <p style={{ margin: 0, color: 'var(--accent-2)' }}>{error}</p>
        </article>
      )}

      {mode === 'mine' ? <PortfolioList accounts={mine} own /> : <AllAccounts accounts={all} />}
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

// Admin: every account as a compact row; expand one to "view as" (the full member card).
function AllAccounts({ accounts }: { accounts: AccountPortfolio[] | null }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (accounts === null) {
    return (
      <article className="card" aria-busy>
        Loading all accounts…
      </article>
    )
  }
  if (accounts.length === 0) {
    return (
      <article className="card">
        <p className="muted" style={{ margin: 0 }}>
          No family accounts yet.
        </p>
      </article>
    )
  }

  return (
    <article className="card" style={{ display: 'grid', gap: '0.5rem' }}>
      {accounts.map((a) => {
        const open = expanded === a.id
        const owner = a.ownerName || (a.ownerUsername ? `@${a.ownerUsername}` : 'Unlinked')
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
                padding: '0.55rem 0.7rem',
                background: 'var(--b1,rgba(127,127,127,0.06))',
                border: '1px solid var(--border, rgba(127,127,127,0.2))',
                borderRadius: 8,
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
              <span
                className="muted cz-num"
                style={{ fontSize: '0.76rem', width: '4.5rem', textAlign: 'right' }}
              >
                {a.holdings.length} held
              </span>
            </button>
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

function AccountCard({ account }: { account: AccountPortfolio }) {
  const total = accountTotalCost(account)
  const promised = promisedToDate(account)
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

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span
        className="muted"
        style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </span>
      <span className="cz-num" style={{ fontWeight: 800, fontSize: big ? '1.5rem' : '1.05rem' }}>
        {value}
      </span>
    </div>
  )
}
