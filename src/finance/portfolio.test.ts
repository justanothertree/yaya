import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountGain,
  accountReserved,
  accountValue,
  aheadBehind,
  daysBetween,
  daysOnPlan,
  portfolioTotals,
  promisedToDate,
  runwayDays,
  type AccountPortfolio,
  type Holding,
} from './portfolio'
import { fundToday } from './fundDay'

/**
 * The money maths.
 *
 * ⚠️ THIS IS THE ONE MODULE WHERE A WRONG ANSWER LOOKS RIGHT. Every other number on the site is
 * checkable by looking — a creature is the size it is, a cast lands where it lands. A fund
 * figure is plausible at almost any value, so nobody catches it by reading the page, and the
 * page is read by family about their own money.
 *
 * ⚠️ AND IT HAS BEEN WRONG IN PUBLIC BEFORE, four times that its own comments record: two
 * definitions of "how many days" that disagreed by one, a gain measured against money-in that
 * read "+127.8%" while the holdings were down 11.9%, an ahead/behind that fell back to market
 * value and so called a depreciation a broken promise, and a rollup that read `?? 0` on an
 * unknown and reported an account as behind by its entire promise. Each test below is one of
 * those, so the fix cannot quietly come undone.
 */

const holding = (over: Partial<Holding> = {}): Holding => ({
  symbol: 'VTI',
  assetType: 'equity',
  units: 10,
  netCash: 1000,
  price: 100,
  ...over,
})

const account = (over: Partial<AccountPortfolio> = {}): AccountPortfolio => ({
  id: 'a1',
  name: 'Someone',
  dollarPerDay: 1,
  startDate: '2026-01-01',
  contributed: 500,
  heldBasis: 900,
  holdings: [holding()],
  ...over,
})

afterEach(() => vi.useRealTimers())

describe('how many days', () => {
  it('counts whole days between two calendar dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1)
    expect(daysBetween('2026-01-01', '2026-02-01')).toBe(31)
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('and a day is zero days from itself', () => {
    expect(daysBetween('2026-06-15', '2026-06-15')).toBe(0)
  })

  it('and never goes backwards', () => {
    expect(daysBetween('2026-06-15', '2026-01-01')).toBe(0)
  })

  it('and refuses to guess at rubbish', () => {
    expect(daysBetween('not a date', '2026-01-01')).toBe(0)
    expect(daysBetween('2026-01-01', '')).toBe(0)
  })

  /**
   * ⚠️ IT MUST NOT CONSULT THE CLOCK, which is the half its own note says keeps going wrong.
   * There were two definitions of this and they disagreed by one day — with 33 accounts at a
   * dollar a day that is $33 between the chart's Promised line and the card's behind figure,
   * for no reason a reader could ever discover.
   *
   * ⚠️ AND THE CLOCK IS THE PART THAT DID IT, NOT THE PARSING, which I had backwards until I
   * tried to break this on purpose. `Date.parse('2026-06-15')` is already UTC: the spec parses
   * a DATE-ONLY string as UTC and only a date-TIME without a zone as local, so dropping the
   * explicit `T00:00:00Z` changes nothing and this test does not move. Even genuinely local
   * midnight survives, because a daylight-saving hour inside a 31-day span is 30.958 days and
   * rounds straight back to 31. What actually broke it was measuring to an INSTANT — a time of
   * day against a midnight — which is the mutation this catches and the one the note describes
   * as folding "what day is it" into "how far apart are these two days".
   *
   * So: two dates in, one number out, and moving the clock underneath it changes nothing.
   */
  it('and the answer does not move when the clock does', () => {
    const asked = () => daysBetween('2026-01-01', '2026-03-01')
    const first = asked()
    for (const when of ['2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z', '1999-06-01T12:00:00Z']) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(when))
      expect(asked(), `it consulted the clock at ${when}`).toBe(first)
      vi.useRealTimers()
    }
    expect(first).toBe(59)
  })

  /**
   * ⚠️ AND A MONTH THAT LOSES AN HOUR IS STILL ITS OWN NUMBER OF DAYS. Parsed at local midnight
   * across a daylight-saving change the arithmetic comes out at 30.958 days, which rounds back
   * to 31 and hides the bug — until the offset and the time of day line up so that it does not.
   * Asserted against the calendar rather than against a subtraction.
   */
  it('and spans a daylight-saving change exactly', () => {
    expect(daysBetween('2026-03-01', '2026-04-01'), 'March is 31 days').toBe(31)
    expect(daysBetween('2026-10-01', '2026-11-01'), 'October is 31 days').toBe(31)
    expect(daysBetween('2026-02-01', '2026-03-01'), '2026 is not a leap year').toBe(28)
    expect(daysBetween('2024-02-01', '2024-03-01'), '2024 is').toBe(29)
  })

  /** ⚠️ today on the FUND's calendar, so the card and the server name the same day */
  it('and days-on-plan asks the fund what day it is', () => {
    const at = new Date('2026-06-15T12:00:00Z')
    expect(daysOnPlan('2026-01-01', at.getTime())).toBe(daysBetween('2026-01-01', fundToday(at)))
  })
})

describe('what an account is worth', () => {
  it('is units times price', () => {
    const a = account({
      holdings: [holding({ units: 3, price: 50 }), holding({ units: 2, price: 10 })],
    })
    expect(accountReserved(a)).toBe(170)
  })

  /** ⚠️ a symbol the price sweep has not seen yet contributes nothing, rather than zero-priced */
  it('and a holding with no price is left out rather than counted at nothing', () => {
    const priced = account({ holdings: [holding({ units: 3, price: 50 })] })
    const alsoUnpriced = account({
      holdings: [
        holding({ units: 3, price: 50 }),
        holding({ symbol: 'XYZ', units: 99, price: null }),
      ],
    })
    expect(accountReserved(alsoUnpriced)).toBe(accountReserved(priced))
  })

  /**
   * ⚠️ CASH IS DELIBERATELY NOT IN THE HEADLINE. Folding it in asserts money is theirs that may
   * since have been spent, and the fund is commingled — a large thing to claim on a page family
   * read. Conservative on purpose: never overstate what somebody has.
   */
  it('and money waiting to be reinvested is not in the headline', () => {
    const dry = account({ cash: 0 })
    const flush = account({ cash: 7191 })
    expect(accountValue(flush)).toBe(accountValue(dry))
  })
})

describe('gain on the shares actually held', () => {
  /**
   * ⚠️ THE +127.8% THAT WAS ON THE PAGE. Six years of recycling the same dollars — $51,428
   * bought, $49,221 sold, only $2,207 genuinely new — shrinks money-in until the percentage
   * describes the churn instead of the investment. Measured against money-in this fund read
   * "+127.8%" while its holdings were down 11.9%.
   *
   * The numbers below are that fund. The test is not "the gain is -11.9%" — it is that the
   * denominator is the BASIS, proved by showing what the other denominator would have said.
   */
  it('is measured against basis, never against money in', () => {
    const basis = 13422.09
    const value = basis * 0.881
    const a = account({
      contributed: 2207,
      heldBasis: basis,
      holdings: [holding({ units: 1, price: value })],
    })
    const gain = accountGain(a)!
    expect(gain.percent).toBeCloseTo(-11.9, 1)

    /* the same dollars against money-in, which is the reading that shipped */
    const againstMoneyIn = ((value - a.contributed!) / a.contributed!) * 100
    expect(againstMoneyIn).toBeGreaterThan(400)
    expect(gain.percent!, 'it is reading the churn, not the investment').toBeLessThan(0)
  })

  it('and refuses to answer when the basis is unknown', () => {
    expect(accountGain(account({ heldBasis: undefined }))).toBeNull()
  })

  it('and gives dollars without a percentage when the basis is nothing', () => {
    const a = account({ heldBasis: 0, holdings: [holding({ units: 1, price: 250 })] })
    expect(accountGain(a)).toEqual({ dollars: 250, percent: null })
  })
})

describe('ahead of or behind the promise', () => {
  it('is money put in minus money promised', () => {
    const a = account({ startDate: '2026-01-01', dollarPerDay: 1, contributed: 500 })
    expect(aheadBehind(a)).toBe(500 - promisedToDate(a)!)
  })

  /**
   * ⚠️ EVAN'S RULE, IN HIS WORDS: they are only behind if the initial investment did not meet
   * the dollar-a-day promise — not if it met it and then depreciated. A holding that falls is a
   * loss, shown as a loss; it is not a broken promise, and conflating the two tells somebody
   * they were short-changed when they were not. There used to be a fallback here that used
   * reserved VALUE when no contribution was known, which was exactly that conflation.
   */
  it('and a holding that collapses does not become a broken promise', () => {
    const before = account({ holdings: [holding({ units: 10, price: 100 })] })
    const crashed = account({ holdings: [holding({ units: 10, price: 1 })] })
    expect(accountValue(crashed)).toBeLessThan(accountValue(before))
    expect(aheadBehind(crashed)).toBe(aheadBehind(before))
  })

  it('and says nothing rather than something wrong when the facts are missing', () => {
    expect(aheadBehind(account({ contributed: undefined })), 'no contribution known').toBeNull()
    expect(aheadBehind(account({ ready: false })), 'no allocated trades yet').toBeNull()
    expect(aheadBehind(account({ startDate: null })), 'no promise to compare').toBeNull()
    expect(aheadBehind(account({ dollarPerDay: 0 })), 'no rate to compare').toBeNull()
  })
})

describe('the rollup', () => {
  it('adds up only the accounts that have a promise', () => {
    const t = portfolioTotals([account(), account({ id: 'a2', startDate: null })])
    expect(t.tracked).toBe(1)
  })

  /**
   * ⚠️ AN UNKNOWN IS NOT A ZERO. This used to read `a.contributed ?? 0`, which turned "we don't
   * know what was put in" into "nothing was put in" — and then reported the account as behind by
   * its ENTIRE promise, with a gain equal to the whole portfolio (value minus a basis of zero).
   * The signed-out demo showed exactly that, contradicting its own chart on the same screen.
   */
  it('and one unknown contribution makes the total unknown, not smaller', () => {
    const t = portfolioTotals([account(), account({ id: 'a2', contributed: undefined })])
    expect(t.invested).toBeNull()
    expect(t.aheadBehind).toBeNull()
    expect(t.promised, 'what was promised is still known').toBeGreaterThan(0)
  })

  it('and one unknown basis makes the gain unknown, not the whole portfolio', () => {
    const t = portfolioTotals([account(), account({ id: 'a2', heldBasis: undefined })])
    expect(t.basis).toBeNull()
    expect(t.gain).toBeNull()
    expect(t.gainPercent).toBeNull()
    expect(t.value, 'what the shares are worth is still known').toBeGreaterThan(0)
  })

  /**
   * ⚠️ TWO FUNCTIONS ANSWERING ONE QUESTION MUST AGREE ABOUT WHAT THEY DON'T KNOW, not just
   * about what they do. That is this module's own words, after the drift bit it twice —
   * get_my_portfolio against admin_get_portfolios, then aheadBehind against portfolioTotals.
   *
   * They still encode the refusal differently: `aheadBehind(a)` returns null when an account is
   * not ready, while the rollup keeps counting and reports `ready: false` beside the number. So
   * the guarantee the page depends on is that `!ready || aheadBehind == null` catches every case
   * the single-account answer refuses — which today lives in a comment in Investments.tsx.
   * This is that guarantee, asserted over every combination of the things that can be missing.
   */
  it('and never shows a confident number where the single account refuses', () => {
    const missing = [
      { contributed: undefined },
      { heldBasis: undefined },
      { ready: false },
      { contributed: undefined, ready: false },
      {},
    ]
    for (const gap of missing) {
      const a = account({ ...gap })
      const t = portfolioTotals([a])
      if (aheadBehind(a) === null) {
        expect(
          !t.ready || t.aheadBehind === null,
          `the rollup answered ${t.aheadBehind} where the account refused, for ${JSON.stringify(gap)}`,
        ).toBe(true)
      } else {
        expect(t.aheadBehind).toBe(aheadBehind(a))
      }
    }
  })

  it('and an account still being set up makes the whole rollup say so', () => {
    expect(portfolioTotals([account(), account({ id: 'a2', ready: false })]).ready).toBe(false)
    expect(portfolioTotals([account(), account({ id: 'a2' })]).ready).toBe(true)
  })

  it('and cash is reported beside the value rather than inside it', () => {
    const t = portfolioTotals([account({ cash: 250 })])
    expect(t.cash).toBe(250)
    expect(t.value).toBe(accountValue(account()))
  })
})

describe('the runway', () => {
  it('is how many days the gap is worth at the daily rate', () => {
    expect(runwayDays(100, 1)).toBe(100)
    expect(runwayDays(100, 4)).toBe(25)
  })

  /** ⚠️ behind is a distance too — how many days of buying to catch up */
  it('and being behind reads as a distance, not a negative', () => {
    expect(runwayDays(-100, 1)).toBe(100)
  })

  it('and there is no runway without a rate', () => {
    expect(runwayDays(100, 0)).toBeNull()
  })
})
