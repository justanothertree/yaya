// Family "dollar-a-day" investments — read-only portfolio for the signed-in member: their
// accounts, each with the dollars/day promised and holdings rolled up at cost. Live prices and
// profit/loss come in a later pass; for now value is shown at cost (what's been allocated).
import { useEffect, useState } from 'react'
import {
  fetchMyPortfolio,
  accountTotalCost,
  promisedToDate,
  assetColor,
  usd,
  type AccountPortfolio,
} from '../finance/portfolio'

export function Investments() {
  const [accounts, setAccounts] = useState<AccountPortfolio[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetchMyPortfolio()
      .then((a) => {
        if (alive) setAccounts(a)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Investments
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Your dollar-a-day portfolio — what’s been invested for you and how it’s allocated. Live
          prices and profit/loss are coming soon.
        </p>
      </header>

      {error && (
        <article className="card">
          <p style={{ margin: 0, color: 'var(--accent-2)' }}>{error}</p>
        </article>
      )}

      {accounts === null && !error && (
        <article className="card" aria-busy>
          Loading your portfolio…
        </article>
      )}

      {accounts !== null && accounts.length === 0 && (
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>
            No accounts yet — once an account is set up for you, your holdings will show here.
          </p>
        </article>
      )}

      {accounts?.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
    </section>
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
