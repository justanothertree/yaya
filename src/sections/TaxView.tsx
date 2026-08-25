import { useEffect, useMemo, useState } from 'react'
import { usd } from '../finance/portfolio'
import {
  fetchTaxStatus,
  holdingVerdict,
  longFraction,
  washVerdict,
  costOfSellingNow,
  unrealized,
  monthLabel,
  type TaxPosition,
  type TaxStatus,
} from '../finance/tax'

/**
 * "When may I sell without it costing me."
 *
 * Evan's own words for why this page exists, and the reason it is admin-only: he is the one
 * buying and selling, so he is the one paying the tax. A family member's card must not grow a
 * number that is about somebody else's tax bill.
 *
 * The honest state for the next few months is "none of it is long-term yet" — the fund started
 * 2025-12-10 and nothing crosses until 2026-12-11. That is not an empty state to design around;
 * it IS the answer, and the useful half is the slope: how much becomes sellable, and when.
 */

const RATE_NOTE =
  'Typed here, kept in memory, never sent anywhere and gone on refresh. A marginal rate is a ' +
  'personal fact and this site has no business storing one.'

export function TaxView() {
  const [status, setStatus] = useState<TaxStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** session-only: see RATE_NOTE. Deliberately not localStorage, not a column. */
  const [ordinary, setOrdinary] = useState('')
  const [longRate, setLongRate] = useState('15')

  useEffect(() => {
    let alive = true
    void fetchTaxStatus().then(
      (s) => alive && setStatus(s),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [])

  const ordinaryPct = useMemo(() => {
    const n = parseFloat(ordinary)
    return Number.isFinite(n) && n > 0 && n < 100 ? n : null
  }, [ordinary])
  const longPct = useMemo(() => {
    const n = parseFloat(longRate)
    return Number.isFinite(n) && n >= 0 && n < 100 ? n : 15
  }, [longRate])

  if (error) {
    return (
      <article className="card">
        <p style={{ margin: 0, color: 'var(--accent-2)' }}>{error}</p>
      </article>
    )
  }
  if (!status) {
    return (
      <article className="card" aria-busy>
        Working out what is long-term…
      </article>
    )
  }
  if (status.positions.length === 0) {
    return (
      <article className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Tax
        </h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          Nothing is allocated to the family fund yet, so there is nothing to hold. This fills in
          once trades are imported and designated.
        </p>
      </article>
    )
  }

  const t = status.totals
  // ⚠️ against pricedBasis, never against basis: value covers only the positions that have a
  // price, so comparing it with the whole book's cost would report a missing price as a loss.
  const gain = t.value - t.pricedBasis
  const shortGain = t.shortValue - t.pricedShortBasis
  const waitingIsWorth =
    ordinaryPct != null && shortGain > 0 ? (shortGain * (ordinaryPct - longPct)) / 100 : null
  const longShare = t.basis > 0 ? t.longBasis / t.basis : 0

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <article className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap' }}>
          <Figure label="Long-term" value={usd(t.longBasis)} sub="at cost, sellable at CG rates" />
          <Figure
            label="Short-term"
            value={usd(t.shortBasis)}
            sub="at cost, taxed as ordinary income"
          />
          <Figure
            label="Unrealized"
            value={usd(gain)}
            sub={`on ${usd(t.pricedBasis)} of priced cost`}
            tone={gain >= 0 ? 'up' : 'down'}
          />
          {t.nextCross && (
            <Figure
              label="First crossing"
              value={new Date(t.nextCross + 'T00:00:00').toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
              sub={`${Math.max(
                0,
                Math.round(
                  (Date.parse(t.nextCross + 'T00:00:00') - Date.parse(status.asOf + 'T00:00:00')) /
                    86400000,
                ),
              )} days away`}
            />
          )}
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {t.longBasis <= 0
            ? 'Every share the family holds is short-term. Selling anything at a gain today is taxed as ordinary income, not at capital-gains rates.'
            : `${Math.round(longShare * 100)}% of the cost has been held over a year.`}{' '}
          Cost is the same average-cost figure the rest of the page shows, split by when each share
          was bought — the two halves always add back to it.
        </p>

        {t.unpriced > 0 && (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            ⚠️ {t.unpriced} {t.unpriced === 1 ? 'holding has' : 'holdings have'} no price yet,
            carrying {usd(t.unpricedBasis)} of cost. They are left out of the worth and gain above
            rather than counted as nothing.
          </p>
        )}

        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            borderTop: '1px solid var(--border)',
            paddingTop: 12,
          }}
        >
          <RateField
            label="Your ordinary rate"
            value={ordinary}
            onChange={setOrdinary}
            placeholder="e.g. 22"
          />
          <RateField
            label="Long-term rate"
            value={longRate}
            onChange={setLongRate}
            placeholder="15"
          />
          <p
            className="muted"
            style={{ margin: 0, fontSize: '0.8rem', flex: '1 1 260px', minWidth: 0 }}
          >
            {waitingIsWorth != null ? (
              <>
                <strong style={{ color: 'var(--text)' }}>
                  Selling every short-term holding today costs {usd(waitingIsWorth)} more in tax
                </strong>{' '}
                than selling them after they cross — losses netted against gains, which is how
                selling the lot would actually be taxed. The per-holding figures below answer a
                narrower question (selling that one position) and deliberately skip the losers, so
                they do not add up to this. {RATE_NOTE}
              </>
            ) : ordinaryPct != null ? (
              <>
                The short-term holdings are down overall, so selling them today realises a loss
                rather than a taxable gain — there is nothing to wait for. {RATE_NOTE}
              </>
            ) : (
              RATE_NOTE
            )}
          </p>
        </div>
      </article>

      {status.crossings.length > 0 && <CrossingChart status={status} />}

      <article className="card" style={{ display: 'grid', gap: 10 }}>
        <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
          Holding by holding
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          {t.positions} positions{t.unpriced > 0 ? `, ${t.unpriced} without a price yet` : ''}.
          Sorted by what they are worth.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {status.positions.map((p) => (
            <PositionRow
              key={p.symbol + '/' + p.platform}
              p={p}
              ordinaryPct={ordinaryPct}
              longPct={longPct}
            />
          ))}
        </div>
      </article>
    </section>
  )
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'up' | 'down'
}) {
  return (
    <div style={{ minWidth: 130 }}>
      <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '1.35rem',
          fontWeight: 800,
          fontFamily: 'var(--mono)',
          color: tone === 'up' ? '#22cc78' : tone === 'down' ? 'var(--accent-2)' : undefined,
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="muted" style={{ fontSize: '0.75rem' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function RateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={99}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 72 }}
        />
        <span className="muted">%</span>
      </span>
    </label>
  )
}

/**
 * How much cost becomes long-term, and when.
 *
 * ⚠️ ONE SCALE, deliberately. The first version drew monthly bars and a cumulative line together,
 * which needs two y-axes to be readable and two y-axes on one picture is how a chart starts
 * lying. The running total is the question being asked — "how much may I sell tax-favourably by
 * date X" — so that is the line; the month's own figure lives in the point's tooltip, where it
 * cannot be misread against the wrong axis.
 *
 * Hand-rolled SVG to match PortfolioChart and the Circuit's charts; the site has no chart library
 * and does not need one for nine points.
 */
function CrossingChart({ status }: { status: TaxStatus }) {
  const W = 720
  const H = 210
  const PAD = { top: 16, right: 16, bottom: 36, left: 66 }
  const rows = status.crossings
  const max = Math.max(...rows.map((r) => r.cumulative), 1)
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  // one point per month, with today pinned at zero on the left so the climb starts from nothing
  const n = rows.length
  const cx = (i: number) => PAD.left + (iw / Math.max(n, 1)) * (i + 0.5)
  const cy = (v: number) => PAD.top + ih - (v / max) * ih
  const pts = rows.map((r, i) => `${cx(i)},${cy(r.cumulative)}`)
  const area = `${PAD.left},${cy(0)} ${pts.join(' ')} ${cx(n - 1)},${cy(0)}`
  // a phone cannot fit twelve month labels; show every other one past that
  const labelEvery = n > 12 ? 2 : 1

  return (
    <article className="card" style={{ display: 'grid', gap: 8 }}>
      <h3 className="section-title" style={{ margin: 0, fontSize: '1rem' }}>
        What becomes long-term, and when
      </h3>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Running total of cost held over a year. Nothing has crossed yet — the fund is younger than a
        year. Hover a point for that month&rsquo;s own figure.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 460, display: 'block' }}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={cy(max * f)}
                y2={cy(max * f)}
                stroke="var(--border)"
              />
              <text
                x={PAD.left - 8}
                y={cy(max * f) + 4}
                textAnchor="end"
                fontSize="11"
                fill="currentColor"
                opacity="0.6"
              >
                {usd(max * f).replace(/\.00$/, '')}
              </text>
            </g>
          ))}
          <polygon points={area} fill="#22cc78" opacity="0.14" />
          <polyline points={pts.join(' ')} fill="none" stroke="#22cc78" strokeWidth="2.5" />
          {rows.map((r, i) => (
            <circle key={r.month} cx={cx(i)} cy={cy(r.cumulative)} r="9" fill="transparent">
              <title>
                {monthLabel(r.month)}: {usd(r.basis)} crosses, {usd(r.cumulative)} long-term in
                total
              </title>
            </circle>
          ))}
          {rows.map((r, i) => (
            <circle
              key={r.month + '-dot'}
              cx={cx(i)}
              cy={cy(r.cumulative)}
              r="3"
              fill="#22cc78"
              pointerEvents="none"
            />
          ))}
          {rows.map((r, i) =>
            i % labelEvery === 0 ? (
              <text
                key={r.month + '-label'}
                x={cx(i)}
                y={H - 12}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
                opacity="0.7"
              >
                {monthLabel(r.month)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </article>
  )
}

function PositionRow({
  p,
  ordinaryPct,
  longPct,
}: {
  p: TaxPosition
  ordinaryPct: number | null
  longPct: number
}) {
  const hold = holdingVerdict(p)
  const wash = washVerdict(p)
  const u = unrealized(p)
  const cost = costOfSellingNow(p, ordinaryPct, longPct)
  // ⚠️ by cost, matching the summary card and holdingVerdict's wording. A bar drawn from units
  // while the sentence beside it counts dollars is two answers to one question.
  const longPctOfPos = longFraction(p) * 100
  const atLoss = u.total != null && u.total < 0

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '0.6rem 0.75rem',
        display: 'grid',
        gap: 6,
        background: 'var(--card2, transparent)',
      }}
    >
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'var(--mono)' }}>{p.symbol}</strong>
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {p.platform}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>
          {p.value == null ? 'no price yet' : usd(p.value)}
        </span>
        {u.total != null && (
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: '0.85rem',
              color: u.total >= 0 ? '#22cc78' : 'var(--accent-2)',
            }}
          >
            {u.total >= 0 ? '+' : ''}
            {usd(u.total)}
          </span>
        )}
      </div>

      {/* the long/short split, as a bar rather than two numbers to compare by eye */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--accent-2)',
          overflow: 'hidden',
          opacity: 0.75,
        }}
        aria-hidden
      >
        <div style={{ width: `${longPctOfPos}%`, height: '100%', background: '#22cc78' }} />
      </div>

      <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
        {hold.text}
      </p>

      {atLoss && wash.level !== 'none' && (
        <p
          style={{
            margin: 0,
            fontSize: '0.82rem',
            color: wash.level === 'wash' ? 'var(--accent-2)' : undefined,
          }}
        >
          {wash.level === 'wash' ? '⚠️ ' : wash.level === 'exempt' ? 'ℹ️ ' : ''}
          {wash.text}
        </p>
      )}

      {cost != null && cost > 0.005 && (
        <p style={{ margin: 0, fontSize: '0.82rem' }}>
          Selling the short-term half now costs <strong>{usd(cost)}</strong> more in tax than
          waiting.
        </p>
      )}

      {Math.abs(p.brokerGap) > 0.005 && (
        <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
          This page uses average cost ({usd(p.basis)}). {p.platform} reports FIFO and will say{' '}
          {usd(p.brokerBasis)} — {usd(Math.abs(p.brokerGap))} {p.brokerGap > 0 ? 'higher' : 'lower'}
          .
        </p>
      )}
    </div>
  )
}
