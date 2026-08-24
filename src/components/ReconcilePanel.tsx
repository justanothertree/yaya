import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Checking the numbers against the brokers, without needing me.
 *
 * Every accuracy problem so far was caught the same way: Evan looked at a figure, said "that's
 * not right", and a one-off query went hunting. It worked — WEN's average cost, the SPCE sales
 * he knew he'd never made — but it depends on him spotting something, and it doesn't scale to a
 * weekly import.
 *
 * He has said he won't show this to a single family member until he trusts it. So the thing that
 * earns trust is being able to verify it himself, in two minutes, whenever he likes.
 *
 * The strongest check here is the last column: family + personal = the whole position. The whole
 * position is what the broker shows him. If those agree, the allocation is right BY CONSTRUCTION,
 * and no family member has to be involved for him to know it.
 */

type Check = { label: string; count: number; meaning: string }

type Row = {
  symbol: string
  platform: string
  wholeUnits: number
  familyUnits: number
  personalUnits: number
  familyAvgCost: number | null
  price: number | null
  priceAt: string | null
  wholeValue: number | null
  familyValue: number | null
  isFamily: boolean
}

type Report = { checks: Check[]; symbols: Row[]; generatedAt: string }

const usd = (n: number | null) =>
  n == null
    ? '—'
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

/** 4 decimals, but no trailing noise on a whole number of shares. */
const units = (n: number) =>
  Math.abs(n) < 1e-9 ? '0' : n.toLocaleString(undefined, { maximumFractionDigits: 4 })

export function ReconcilePanel() {
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [onlyFamily, setOnlyFamily] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseClient().rpc('admin_reconciliation')
    if (error) setErr(error.message)
    else {
      setErr(null)
      setReport(data as Report)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (err) return <p style={{ color: '#f46b6b' }}>{err}</p>
  if (!report) return <p className="muted">Checking…</p>

  const problems = report.checks.filter((c) => c.count > 0)
  const rows = report.symbols.filter((r) => !onlyFamily || r.familyUnits > 0.000001)

  /**
   * Totals across whatever is currently listed.
   *
   * The per-symbol rows are for hunting a specific discrepancy; this row is the one you tick
   * against a broker's home screen. Only priced positions count toward it — an unpriced holding
   * would otherwise quietly drag the total down as if it were worth nothing, which is exactly
   * the sort of confident wrong number this whole screen exists to catch.
   */
  const totals = rows.reduce(
    (a, r) => {
      if (r.price == null) {
        a.unpriced += 1
        return a
      }
      a.family += r.familyUnits * r.price
      a.personal += r.personalUnits * r.price
      a.whole += r.wholeUnits * r.price
      return a
    },
    { family: 0, personal: 0, whole: 0, unpriced: 0 },
  )

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Everything the site believes, next to what your broker would show. The last three columns
        are the check that matters: <strong>theirs + yours should equal the whole position</strong>.
        If those agree, the split is right.
      </p>

      {/* The verdict first. "All clear" is the answer he's looking for most times he opens this. */}
      {problems.length === 0 ? (
        <div className="import-done">
          <strong>All {report.checks.length} checks clear.</strong>
          <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.84rem' }}>
            No over-allocation, no negative holdings, nothing dated before the account it belongs
            to, every trade split evenly, every family holding priced and current.
          </p>
        </div>
      ) : (
        <div className="import-fail">
          <strong>
            {problems.length} check{problems.length === 1 ? '' : 's'} found something.
          </strong>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
            {problems.map((c) => (
              <li key={c.label}>
                <strong>
                  {c.label}: {c.count}
                </strong>{' '}
                <span className="muted">{c.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          margin: '0.8rem 0 0.4rem',
        }}
      >
        <div className="cz-sec" style={{ margin: 0 }}>
          Positions ({rows.length})
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setOnlyFamily((v) => !v)}
          style={{ fontSize: '0.78rem', marginLeft: 'auto' }}
        >
          {onlyFamily ? 'Show everything you hold' : 'Only what they hold'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void load()}
          style={{ fontSize: '0.78rem' }}
        >
          Refresh
        </button>
      </div>

      {/* Scrolls inside itself — a wide table must never make the page scroll sideways. */}
      <div className="reconcile-scroll">
        <table className="reconcile">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Avg cost</th>
              <th className="num">Price</th>
              <th className="num">Theirs</th>
              <th className="num">Yours</th>
              <th className="num">Whole position</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol + r.platform}>
                <td>
                  <strong>{r.symbol}</strong>{' '}
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    {r.platform}
                  </span>
                </td>
                <td className="num">{r.familyAvgCost == null ? '—' : usd(r.familyAvgCost)}</td>
                <td className="num">{usd(r.price)}</td>
                <td className="num">{units(r.familyUnits)}</td>
                {/* A negative personal share means more was allocated than you hold — the one
                    number here that is always a bug rather than a fact. */}
                <td className={'num' + (r.personalUnits < -0.000001 ? ' reconcile-bad' : '')}>
                  {units(r.personalUnits)}
                </td>
                <td className="num">
                  {units(r.wholeUnits)}
                  {r.wholeValue != null && (
                    <span className="muted" style={{ fontSize: '0.76rem' }}>
                      {' '}
                      · {usd(r.wholeValue)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="reconcile-total">
              <td>
                <strong>{onlyFamily ? 'Family total' : 'Everything total'}</strong>
                {totals.unpriced > 0 && (
                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                    {' '}
                    · {totals.unpriced} unpriced, left out
                  </span>
                )}
              </td>
              <td className="num" />
              <td className="num" />
              <td className="num">{usd(totals.family)}</td>
              <td className="num">{usd(totals.personal)}</td>
              <td className="num">
                <strong>{usd(totals.whole)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="muted" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>
        The bottom row is in dollars, not units — switch to &ldquo;everything you hold&rdquo; and
        its last figure is what your brokers add up to between them. Checked{' '}
        {new Date(report.generatedAt).toLocaleString()}. Average cost is what the family paid for
        the shares they still hold, so it should match your broker&apos;s average for a position
        that is entirely theirs — and sit between your two averages where it is shared.
      </p>
    </div>
  )
}
