import { useState } from 'react'
import { TradeReview } from '../components/TradeReview'
import type { RecentReview } from '../finance/portfolio'
import type { ReviewTrade } from '../finance/reviewGroups'

/**
 * The trade review, with invented trades, because nothing could see the real one.
 *
 * ⚠️ IT IS THE SCREEN THAT MOVES MONEY AND IT HAD NO WORKBENCH. The review lives in ImportPanel,
 * which `#dev-admin` renders with no token — so `admin_unallocated_trades` answered nothing and
 * the list was always empty. Every layout claim about it was therefore a claim about a card
 * containing one heading. That is the "a room with nothing in it passes every check there is"
 * trap, on the one surface where being wrong costs somebody shares.
 *
 * ⚠️ AND IT IS WORTH ONE MORE THING, which is why the fixture is shaped the way it is: the live
 * backlog is EMPTY. Evan answered 103 trades on 29 Oct in about seven minutes. So even an admin
 * session would render nothing today, and the next time there is anything to look at is after the
 * next import — which is exactly when you would rather not be discovering a layout bug.
 *
 * Every person, symbol and figure below is invented. The SHAPES are real:
 *   - a symbol with seven trades, so the bulk answer and the ✓ have something to act on
 *   - the same symbol on two brokers, which must stay two questions (designation is per broker)
 *   - one trade on its own, where the bulk row must NOT appear
 *   - a sell, so a negative figure is on screen
 *   - a symbol the family already holds, which is what the "already holds" line is for
 *   - a long symbol and a six-figure trade, to see what crowds the row
 */

const DAY = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

const TRADES: ReviewTrade[] = [
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `pv-sofi-${i}`,
    date: DAY(3 + i),
    symbol: 'SOFI',
    platform: 'robinhood',
    dollars: 20 + i * 5,
    units: 1.2345 + i * 0.1,
    isFamilySymbol: false,
    alreadyHeld: 0,
    eligibleAccounts: 33,
  })),
  {
    id: 'pv-sofi-cash',
    date: DAY(4),
    symbol: 'SOFI',
    platform: 'cashapp',
    dollars: 60,
    units: 3.5,
    isFamilySymbol: false,
    alreadyHeld: 0,
    eligibleAccounts: 33,
  },
  {
    id: 'pv-voo',
    date: DAY(6),
    symbol: 'VOO',
    platform: 'robinhood',
    dollars: 500,
    units: 0.9123,
    isFamilySymbol: true,
    alreadyHeld: 12.5,
    eligibleAccounts: 33,
  },
  {
    id: 'pv-sell',
    date: DAY(8),
    symbol: 'MDLN',
    platform: 'cashapp',
    dollars: -1043.22,
    units: -28,
    isFamilySymbol: false,
    alreadyHeld: 0,
    eligibleAccounts: 33,
  },
  {
    id: 'pv-wide',
    date: DAY(9),
    symbol: 'BRK.B',
    platform: 'robinhood',
    dollars: 131966.09,
    units: 1234.5678,
    isFamilySymbol: false,
    alreadyHeld: 0,
    eligibleAccounts: 33,
  },
]

const RECENT: RecentReview[] = [
  {
    id: 'pv-r1',
    date: DAY(12),
    reviewedAt: new Date().toISOString(),
    symbol: 'HOG',
    platform: 'cashapp',
    dollars: 7.83,
    units: 0.31585,
    isFamilySymbol: false,
    familyUnits: 0,
    fraction: 0,
  },
  {
    id: 'pv-r2',
    date: DAY(14),
    reviewedAt: new Date().toISOString(),
    symbol: 'KTOS',
    platform: 'robinhood',
    dollars: 185.33,
    units: 3.3,
    isFamilySymbol: true,
    familyUnits: 3.3,
    fraction: 1,
  },
  /* ⚠️ a zero-dollar restatement: `fraction` is null and the label must say units, not a made-up
     percentage — see `answerLabel`. SGRX on the live fund is this row. */
  {
    id: 'pv-r3',
    date: DAY(20),
    reviewedAt: new Date().toISOString(),
    symbol: 'SGRX',
    platform: 'robinhood',
    dollars: 0,
    units: 6,
    isFamilySymbol: false,
    familyUnits: 1.5,
    fraction: null,
  },
]

export function TradeReviewPreview() {
  const [empty, setEmpty] = useState(false)
  const [slow, setSlow] = useState(false)
  const [fail, setFail] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 6))

  return (
    <section className="card dev-bench">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — #dev-review · invented trades, real component. Nothing here writes.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
        <label className="import-review-also">
          <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />
          <span>backlog empty (&ldquo;All caught up&rdquo;)</span>
        </label>
        <label className="import-review-also">
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
          <span>slow writes (watch the buttons disable)</span>
        </label>
        <label className="import-review-also">
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
          <span>writes fail (per-row error)</span>
        </label>
      </div>
      <TradeReview
        trades={empty ? [] : TRADES}
        total={empty ? 0 : 118}
        recent={RECENT}
        onAnswer={async (ids, fraction) => {
          if (slow) await new Promise((r) => setTimeout(r, 1200))
          if (fail) throw new Error('permission denied for function admin_set_trade_allocation')
          say(`answer ${ids.length} trade(s) at ${(fraction * 100).toFixed(0)}%`)
        }}
        onDesignate={async (symbol, platform, family) => {
          if (slow) await new Promise((r) => setTimeout(r, 1200))
          say(`designate ${symbol} (${platform}) ${family ? 'family' : 'personal'}`)
        }}
      />
      {log.length > 0 && (
        <pre className="muted" style={{ fontSize: '0.75rem', marginTop: '0.6rem' }}>
          {log.join('\n')}
        </pre>
      )}
    </section>
  )
}
