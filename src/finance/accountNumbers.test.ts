import { describe, expect, it } from 'vitest'
import { STALE_AFTER_DAYS, accountNumbers, holdingWorth } from './accountNumbers'
import type { AccountPortfolio, Holding } from './portfolio'
import type { Timeline } from './timeline'

/**
 * ⚠️ THE FIXTURE IS BUILT SO NO FIELD SITS ON ITS DEFAULT. A derivation is only worth the fields
 * its fixture fills: in chronicle, deleting every rating from an import left all 34 tests green
 * because nothing in the fixture had a rating. So the account here has cash, a contribution, a
 * server basis, two comfortable holdings, two crumbs and one the price sweep has never seen — and
 * each test below asks about one of those in isolation.
 */
const DAY = 86_400_000
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)
const NOW = Date.parse('2026-10-28T12:00:00Z')

const hold = (over: Partial<Holding> & { symbol: string }): Holding => ({
  assetType: 'stock',
  units: 1,
  netCash: 10,
  price: 10,
  priceAt: new Date(NOW - DAY).toISOString(),
  ...over,
})

const account = (over: Partial<AccountPortfolio> = {}): AccountPortfolio => ({
  id: 'a1',
  name: 'Robin',
  dollarPerDay: 1,
  startDate: dayOf(NOW - 100 * DAY),
  contributed: 120,
  cash: 18.4,
  heldBasis: 100,
  ready: true,
  holdings: [
    hold({ symbol: 'VOO', units: 2, price: 50 }), // 100
    hold({ symbol: 'AAPL', units: 1, price: 20 }), // 20
    hold({ symbol: 'CRUMB', units: 0.1, price: 4 }), // 0.40
    hold({ symbol: 'BIT', units: 0.2, price: 2 }), // 0.40
    hold({ symbol: 'PRIV', units: 3, price: null, priceAt: null }), // unknown
  ],
  ...over,
})

const timeline = (over: Partial<Timeline> = {}): Timeline => ({
  accounts: [{ dollarPerDay: 1, startDate: dayOf(NOW - 100 * DAY) }],
  events: [
    { date: dayOf(NOW - 90 * DAY), symbol: 'VOO', units: 2, cost: 80 },
    { date: dayOf(NOW - 80 * DAY), symbol: 'AAPL', units: 1, cost: 25 },
  ],
  /**
   * ⚠️ THREE CAPTURES PER SYMBOL, NOT TWO, AND THAT IS THE WHOLE POINT OF THE THIRD. With two,
   * "the last two" and "the first two" are the same pair — so perturbing `dayChange` to read
   * `s[0]` and `s[1]` left all twenty tests green. The fixture was pinning the one dimension the
   * test was named after. The oldest point is deliberately far from the other two, so reading the
   * wrong end gives +14 rather than +6.
   */
  prices: [
    { symbol: 'VOO', date: dayOf(NOW - 3 * DAY), price: 30 },
    { symbol: 'VOO', date: dayOf(NOW - 2 * DAY), price: 46 },
    { symbol: 'VOO', date: dayOf(NOW - DAY), price: 50 },
    { symbol: 'AAPL', date: dayOf(NOW - 3 * DAY), price: 40 },
    { symbol: 'AAPL', date: dayOf(NOW - 2 * DAY), price: 22 },
    { symbol: 'AAPL', date: dayOf(NOW - DAY), price: 20 },
  ],
  costBasis: [],
  ...over,
})

describe('what a member’s card is worth', () => {
  it('counts the priced shares and leaves cash out of the headline', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    /* 100 + 20 + 0.40 + 0.40 — the unpriced holding is not booked as worth nothing */
    expect(n.total).toBeCloseTo(120.8, 6)
    expect(n.cash).toBe(18.4)
  })

  it('treats an unpriced holding as unknown rather than as zero dollars', () => {
    expect(holdingWorth(hold({ symbol: 'PRIV', units: 3, price: null }))).toBe(0)
    const n = accountNumbers(account(), timeline(), NOW)
    expect(n.unpriced).toBe(1)
    /* and it still gets a row of its own */
    expect(n.shown.map((h) => h.symbol)).toContain('PRIV')
  })

  it('does not turn “we don’t know what was put in” into “nothing was put in”', () => {
    expect(accountNumbers(account({ contributed: undefined }), timeline(), NOW).putIn).toBeNull()
    expect(accountNumbers(account(), timeline(), NOW).putIn).toBe(120)
  })
})

describe('the small-pieces fold', () => {
  it('shows every holding that is worth a row and nothing else', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    expect(n.folds).toBe(true)
    expect(n.small.map((h) => h.symbol).sort()).toEqual(['BIT', 'CRUMB'])
    expect(n.shown.map((h) => h.symbol)).not.toContain('CRUMB')
  })

  /**
   * ⚠️ THE INVARIANT, NOT THE ARITHMETIC. "It is a summary, not a filter" is a claim that the
   * money in the fold plus the money on screen is all the money there is — asked against the
   * account's own total, which `accountReserved` arrives at by a different route.
   */
  it('loses nothing: what is shown plus what is folded is the whole account', () => {
    for (const a of [account(), account({ holdings: [] }), account({ cash: 0 })]) {
      const n = accountNumbers(a, timeline(), NOW)
      const onScreen = n.shown.reduce((s, h) => s + holdingWorth(h), 0)
      expect(onScreen + (n.folds ? n.smallWorth : 0)).toBeCloseTo(n.total, 6)
    }
  })

  it('does not summarise one thing', () => {
    const one = account({
      holdings: [
        hold({ symbol: 'VOO', units: 2, price: 50 }),
        hold({ symbol: 'CRUMB', price: 0.4 }),
      ],
    })
    const n = accountNumbers(one, timeline(), NOW)
    expect(n.small).toHaveLength(1)
    expect(n.folds).toBe(false)
    expect(n.shown.map((h) => h.symbol)).toContain('CRUMB')
  })

  it('never folds away a holding nobody has a price for', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    expect(n.small.map((h) => h.symbol)).not.toContain('PRIV')
  })

  it('puts the biggest first, so the fold is always the tail', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    const worths = n.holdings.map(holdingWorth)
    for (let i = 1; i < worths.length; i++) expect(worths[i]).toBeLessThanOrEqual(worths[i - 1])
  })
})

describe('whether the prices behind “worth today” can still be trusted', () => {
  /**
   * ⚠️ FROM THE SENTENCE, NOT FROM THE CONSTANT. "A single missed run is worth tolerating quietly
   * while two in a row means something broke" is the claim; comparing against STALE_AFTER_DAYS
   * would be the constant typed twice, and green at any value it held.
   */
  it('says nothing about a feed that has missed one day', () => {
    const fresh = account({
      holdings: [hold({ symbol: 'VOO', priceAt: new Date(NOW - 1.9 * DAY).toISOString() })],
    })
    expect(accountNumbers(fresh, timeline(), NOW).pricesStale).toBe(false)
  })

  it('speaks up once two days have passed', () => {
    const stale = account({
      holdings: [hold({ symbol: 'VOO', priceAt: new Date(NOW - 2 * DAY).toISOString() })],
    })
    expect(accountNumbers(stale, timeline(), NOW).pricesStale).toBe(true)
    expect(STALE_AFTER_DAYS).toBe(2)
  })

  it('takes the newest price as the account’s age, not the oldest', () => {
    const mixed = account({
      holdings: [
        hold({ symbol: 'OLD', priceAt: new Date(NOW - 40 * DAY).toISOString() }),
        hold({ symbol: 'VOO', priceAt: new Date(NOW - 0.5 * DAY).toISOString() }),
      ],
    })
    expect(accountNumbers(mixed, timeline(), NOW).pricesStale).toBe(false)
  })

  it('has nothing to say when no holding was ever priced', () => {
    const never = account({ holdings: [hold({ symbol: 'PRIV', price: null, priceAt: null })] })
    const n = accountNumbers(never, timeline(), NOW)
    expect(n.pricedAsOf).toBeNull()
    expect(n.pricesStale).toBe(false)
  })
})

describe('today’s move', () => {
  it('is the last two captures, weighted by what is held', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    /* VOO 2 × (50 − 46) = +8, AAPL 1 × (20 − 22) = −2 */
    expect(n.dayChange).toBeCloseTo(6, 6)
  })

  it('refuses to answer from a single capture', () => {
    const one = timeline({ prices: [{ symbol: 'VOO', date: dayOf(NOW - DAY), price: 50 }] })
    expect(accountNumbers(account(), one, NOW).dayChange).toBeNull()
  })

  it('refuses to answer with no timeline at all', () => {
    expect(accountNumbers(account(), null, NOW).dayChange).toBeNull()
  })
})

describe('gain, and which basis answers it', () => {
  it('uses the server’s basis when there is one', () => {
    const n = accountNumbers(account({ heldBasis: 100 }), timeline(), NOW)
    /* 120.80 of priced value against a basis of 100 */
    expect(n.gain?.dollars).toBeCloseTo(20.8, 6)
    expect(n.gain?.pct).toBeCloseTo(20.8, 6)
  })

  /** the event walk is a FALLBACK — it must not be consulted while the server has answered */
  it('ignores the timeline’s own cost history when the server sent a basis', () => {
    const a = account({ heldBasis: 100 })
    const withEvents = accountNumbers(a, timeline(), NOW).gain
    const withNone = accountNumbers(a, timeline({ events: [] }), NOW).gain
    expect(withEvents).toEqual(withNone)
  })

  it('falls back to the timeline when the server sent no basis', () => {
    const n = accountNumbers(account({ heldBasis: undefined }), timeline(), NOW)
    /* VOO cost 80 for 2 units = 40/sh, now 50 → +20; AAPL 25/sh, now 20 → −5 */
    expect(n.gain?.dollars).toBeCloseTo(15, 6)
  })

  it('says nothing rather than “up ∞%” when there is no basis anywhere', () => {
    const n = accountNumbers(account({ heldBasis: undefined }), timeline({ events: [] }), NOW)
    expect(n.gain).toBeNull()
  })

  it('leaves a holding out of the per-row figures when its cost is unknowable', () => {
    const n = accountNumbers(account(), timeline(), NOW)
    expect(n.pl.get('VOO')?.avgCost).toBeCloseTo(40, 6)
    /* no event, so no basis — and so no confident percentage */
    expect(n.pl.has('CRUMB')).toBe(false)
    /* an allocation but no price */
    expect(n.pl.has('PRIV')).toBe(false)
  })
})
