import { describe, expect, it } from 'vitest'
import { accountNumbers, holdingWorth } from './accountNumbers'
import type { AccountPortfolio, Holding } from './portfolio'

/**
 * A PIN, NOT A DERIVATION — the one thing a UI change must never move.
 *
 * `ui/investments-polish` changes only CSS and two `className` attributes, and the claim that
 * goes with it is "every number and calculation is exactly as #341 left it". That claim is worth
 * nothing asserted in a commit message, because nothing downstream contradicts it: a stylesheet
 * and a card full of figures do not fail each other, and the figures are the half nobody would
 * notice had shifted until a member read their own card.
 *
 * So this file is deliberately NOT a test of the arithmetic — `accountNumbers.test.ts` next to it
 * already asks each derivation its own question, one at a time, against a fixture built so no
 * field sits on its default. This one asks a different and duller question: **are the answers
 * still these answers**. It is the regression net a restyle gets to run against.
 *
 * ⚠️ EVERY EXPECTATION BELOW IS WORKED OUT FROM THE FIXTURE, NEVER READ OFF A RUN. The difference
 * matters more here than anywhere: a pin filled in from the code's own output pins whatever the
 * code does today, bug included, and would have agreed just as happily with the clamp that
 * CLAUDE.md §2 describes or with the text sort that hid integrity check 10. The sums are written
 * beside each line so the next person can check them without the program.
 */

/* VOO 2 x $50 = $100 | AAPL 1 x $20 = $20 | CRUMB 0.1 x $4 = $0.40 | BIT 0.2 x $2 = $0.40
   PRIV 3 units, no price — counted nowhere, not as zero. */
const hold = (over: Partial<Holding> & { symbol: string }): Holding => ({
  assetType: 'stock',
  units: 1,
  netCash: 10,
  price: 10,
  priceAt: '2026-10-27T12:00:00.000Z',
  ...over,
})

const ACCOUNT: AccountPortfolio = {
  id: 'pin-1',
  name: 'Robin',
  dollarPerDay: 1,
  startDate: '2026-07-20',
  contributed: 120,
  cash: 18.4,
  heldBasis: 100,
  ready: true,
  holdings: [
    hold({ symbol: 'VOO', units: 2, price: 50 }),
    hold({ symbol: 'AAPL', units: 1, price: 20 }),
    hold({ symbol: 'CRUMB', units: 0.1, price: 4 }),
    hold({ symbol: 'BIT', units: 0.2, price: 2 }),
    hold({ symbol: 'PRIV', units: 3, price: null, priceAt: null }),
  ],
}

const NOW = Date.parse('2026-10-28T12:00:00Z')

describe('the figures on a member’s card, pinned against a restyle', () => {
  const n = accountNumbers(ACCOUNT, null, NOW)

  it('is worth the priced shares and nothing else', () => {
    /* 100 + 20 + 0.40 + 0.40. PRIV has no price, so it is absent rather than zero — the
       difference between "we don't know" and "it's worthless". */
    expect(n.total).toBeCloseTo(120.8, 10)
  })

  it('keeps cash out of the headline and still reports it', () => {
    /* the sum above excludes it; accountValue() leaves cash out on purpose so the headline
       never overstates what somebody has, and the card prints it on its own line */
    expect(n.cash).toBe(18.4)
    expect(n.total).not.toBeCloseTo(120.8 + 18.4, 10)
  })

  it('counts money put in from the server, never inferred', () => {
    expect(n.putIn).toBe(120)
  })

  it('measures the gain against what the shares cost', () => {
    /* $120.80 of shares against a $100 basis = $20.80, which is 20.8% of 100 */
    expect(n.gain?.dollars).toBeCloseTo(20.8, 10)
    expect(n.gain?.pct).toBeCloseTo(20.8, 10)
  })

  it('leaves the unpriced holding out and says so', () => {
    expect(n.unpriced).toBe(1)
    expect(n.holdings).toHaveLength(5)
  })

  it('folds the two crumbs, and never folds the one with no price', () => {
    /* $0.40 and $0.40 are under the $1 dust floor; $100 and $20 are not.
       PRIV joins them above the fold with no price at all, which is the module's own rule and
       the one my first pass got wrong: "an unpriced holding is NEVER folded — unknown is the
       opposite of small". Worth keeping as a pin precisely because it is counter-intuitive:
       a holding with no value sits above two that have one. */
    expect(n.big.map((h) => h.symbol)).toEqual(['VOO', 'AAPL', 'PRIV'])
    expect(n.small.map((h) => h.symbol).sort()).toEqual(['BIT', 'CRUMB'])
    expect(n.smallWorth).toBeCloseTo(0.8, 10)
  })

  it('orders the list biggest first', () => {
    /* an unsorted list passes a sorted fixture, so the fixture above is deliberately NOT in
       value order: BIT ($0.40) is declared before PRIV, and VOO before AAPL by luck only */
    const worths = n.holdings.map((h) => holdingWorth(h))
    expect(worths).toEqual([...worths].sort((a, b) => b - a))
    expect(n.holdings[0].symbol).toBe('VOO')
  })

  it('adds up: the parts equal the whole', () => {
    /* the invariant rather than the sum — whatever the figures become, big + small must still
       be the total, because a holding is either worth a row or worth folding and never both */
    const big = n.big.reduce((t, h) => t + holdingWorth(h), 0)
    expect(big + n.smallWorth).toBeCloseTo(n.total, 10)
  })
})
