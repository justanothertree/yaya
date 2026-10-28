/**
 * Every figure the one-account card draws, derived in one place.
 *
 * ⚠️ IT IS A MODULE BECAUSE THE CARD BECAME THREE CARDS. The hero, the chart and "What you own"
 * are separate cards in the member layout now, and two of them need the same derivations — the
 * total, the daily price series, the per-holding basis. Deriving them twice is two answers to one
 * question, which is the bug this fund's money math keeps producing; deriving them once in a
 * parent and handing them down is one answer.
 *
 * ⚠️ AND PURE, SO THE NUMBERS CAN BE ASKED A QUESTION WITHOUT A BROWSER. This room does not open
 * without an account, so anything that exists only inside its JSX is unverifiable — which is how
 * a member's cash came to appear nowhere at all for weeks. `now` is a parameter for the same
 * reason: the two-day staleness rule is a rule, and a rule with a clock buried inside it cannot
 * be tested.
 */
import {
  accountGain,
  accountReserved,
  aheadBehind,
  type AccountPortfolio,
  type Holding,
} from './portfolio'
import { avgCostBySymbol, type PricePoint, type Timeline } from './timeline'
import { isDust } from './dust'

/** What a holding is worth now. An unpriced one contributes nothing — see `isDust`. */
export const holdingWorth = (h: Holding): number => (h.price != null ? h.units * h.price : 0)

/** Per-holding gain against the broker-style average cost. */
export type HoldingPl = { avgCost: number; pct: number; dollars: number }

/**
 * Two days, not one.
 *
 * The price sweep captures daily including weekends (crypto trades round the clock), so a single
 * missed run is worth tolerating quietly while two in a row means something broke. It did break,
 * for two days in August 2026, and the only clue anywhere on screen was a date inside a collapsed
 * panel phrased as neutral detail.
 */
export const STALE_AFTER_DAYS = 2

export type AccountNumbers = {
  /** "Worth today" — the priced shares only, cash excluded on purpose. */
  total: number
  /** Proceeds of sales not yet reinvested. Still theirs. */
  cash: number
  /** Fresh money put in, or null when the server could not say. Never defaulted to zero. */
  putIn: number | null
  /** Money put in minus money promised. Null when there is no honest answer. */
  ab: number | null
  /** Gain on the shares held against what they cost. */
  gain: { dollars: number; pct: number | null } | null
  /** Move between the last two price captures, or null when there is no second capture. */
  dayChange: number | null
  pricedAsOf: string | null
  pricesStale: boolean
  /** How many holdings the price sweep has never seen. */
  unpriced: number
  /** Every holding, biggest first. */
  holdings: Holding[]
  /** The ones worth a row of their own. */
  big: Holding[]
  /** The crumbs. */
  small: Holding[]
  smallWorth: number
  /** Whether the crumbs are worth their own summary row — two up, see below. */
  folds: boolean
  /** What the list actually renders above the fold. */
  shown: Holding[]
  /** Daily prices per symbol, oldest first — for the sparklines and `dayChange`. */
  series: Map<string, PricePoint[]>
  pl: Map<string, HoldingPl>
}

export function accountNumbers(
  account: AccountPortfolio,
  timeline?: Timeline | null,
  now: number = Date.now(),
): AccountNumbers {
  const total = accountReserved(account)
  const holdings = [...account.holdings].sort((x, y) => holdingWorth(y) - holdingWorth(x))

  /**
   * ⚠️ SMALL PIECES FOLD, "SHOW ALL" GOES. "Show all" handed a child a list of 76 rows, 37 of
   * them worth under a dollar — measured on the live fund, those 37 cost $33.86 and are now worth
   * $15.69 between them. The length was never the problem; the noise was.
   *
   * ⚠️ AND THE CRUMBS ARE NOT A BUG TO FIX. At 33 accounts any buy under $33 is under $1 a head
   * on the day it settles. That is the fund's shape, so the row says what they are rather than
   * hiding them: they still count toward the total.
   *
   * ⚠️ AN UNPRICED HOLDING IS NEVER FOLDED — unknown is the opposite of small.
   */
  const big = holdings.filter((h) => !isDust(h.price != null ? holdingWorth(h) : null))
  const small = holdings.filter((h) => isDust(h.price != null ? holdingWorth(h) : null))
  const smallWorth = small.reduce((n, h) => n + holdingWorth(h), 0)
  /* one crumb is just a holding; a fold is only worth its own row from two up */
  const folds = small.length >= 2

  const series = new Map<string, PricePoint[]>()
  if (timeline) {
    for (const p of timeline.prices) {
      const arr = series.get(p.symbol) ?? []
      arr.push(p)
      series.set(p.symbol, arr)
    }
    for (const arr of series.values()) arr.sort((a, b) => a.date.localeCompare(b.date))
  }

  let dayMove = 0
  let anyMove = false
  for (const h of account.holdings) {
    const s = series.get(h.symbol)
    if (!s || s.length < 2) continue
    anyMove = true
    dayMove += h.units * (s[s.length - 1].price - s[s.length - 2].price)
  }

  // Broker-style average cost per share (buys blend in, sells leave at the average), so each
  // held position gets a percent gain from its cost to the current price.
  const avgCost = timeline ? avgCostBySymbol(timeline) : new Map<string, number>()
  const pl = new Map<string, HoldingPl>()
  for (const h of holdings) {
    const ac = avgCost.get(h.symbol)
    if (ac == null || ac <= 0 || h.price == null) continue
    pl.set(h.symbol, {
      avgCost: ac,
      pct: ((h.price - ac) / ac) * 100,
      dollars: (h.price - ac) * h.units,
    })
  }

  /**
   * Account-wide gain.
   *
   * ⚠️ THE SERVER'S BASIS IS THE AUTHORITY. `accountGain()` measures against `heldBasis` — the
   * average-cost walk over this account's allocations — and it exists because measuring against
   * money-in reported this fund as "+127.8%" while its holdings were down 11.9%.
   *
   * The event walk below stays only as a fallback for the case the server sent no basis at all.
   * When the card rolled its own basis as the PRIMARY answer it silently yielded null whenever
   * the timeline carried no events for these symbols, so the member's card simply omitted whether
   * they were up or down — no error, no empty state, just a missing line.
   *
   * ⚠️ Known and disclosed: this compares PRICED value against the basis of everything held, so
   * an unpriced holding drags it down. The ⓘ panel says how many are unpriced.
   */
  const gain = (() => {
    const authoritative = accountGain(account)
    if (authoritative != null) {
      return { dollars: authoritative.dollars, pct: authoritative.percent }
    }
    let basis = 0
    let val = 0
    for (const h of holdings) {
      const ac = avgCost.get(h.symbol)
      if (ac != null && ac > 0 && h.price != null) {
        basis += h.units * ac
        val += h.units * h.price
      }
    }
    return basis > 0 ? { dollars: val - basis, pct: ((val - basis) / basis) * 100 } : null
  })()

  const pricedAsOf = account.holdings.reduce<string | null>(
    (acc, h) => (h.priceAt && (!acc || h.priceAt > acc) ? h.priceAt : acc),
    null,
  )
  const ageDays = pricedAsOf ? (now - new Date(pricedAsOf).getTime()) / 86_400_000 : null

  return {
    total,
    cash: account.cash ?? 0,
    putIn: account.contributed ?? null,
    ab: aheadBehind(account),
    gain,
    dayChange: anyMove ? dayMove : null,
    pricedAsOf,
    pricesStale: ageDays != null && ageDays >= STALE_AFTER_DAYS,
    unpriced: account.holdings.filter((h) => h.price == null).length,
    holdings,
    big,
    small,
    smallWorth,
    folds,
    shown: folds ? big : holdings,
    series,
    pl,
  }
}
