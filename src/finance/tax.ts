/**
 * When may the family fund sell without it costing Evan money.
 *
 * This is a DECISION TOOL, not a report. Every other number on the Investments page answers
 * "what is this worth" for the family; these answer "what would selling it cost me" for the one
 * person who pays the tax. That is why it lives behind the admin gate and never appears on a
 * member's card.
 *
 * ⚠️ THE DOLLARS ARE THE PAGE'S DOLLARS. `basis` here is the same average-cost figure the rest
 * of the page shows -- admin_tax_status() splits it by acquisition date rather than recomputing
 * it -- so longBasis + shortBasis === the heldBasis already on screen, always. `brokerBasis` is
 * the FIFO number a 1099 will carry; it is displayed where it differs and used for nothing.
 *
 * ⚠️ AND AN UNPRICED HOLDING IS NOT WORTH ZERO. `value` covers only positions the price sweep
 * has reached, so it is reported alongside `pricedBasis` -- a denominator over the same
 * holdings -- and never against `basis`, which covers all of them. Comparing the two would
 * report a missing price as a total loss. See docs/2026-08-24-an-unknown-is-not-a-zero.md.
 */

import { getSupabaseClient } from './client'
import { usd } from './portfolio'

export type TaxPosition = {
  symbol: string
  platform: string
  assetType: string | null
  units: number
  avgCost: number
  price: number | null
  priceAt: string | null
  /** average-cost basis of everything still held -- the page's own number */
  basis: number
  /** null when this symbol has no cached price; NOT zero */
  value: number | null
  longUnits: number
  longBasis: number
  longValue: number | null
  shortUnits: number
  shortBasis: number
  shortValue: number | null
  /** the day the next short-term tranche becomes long-term, and how much basis crosses with it */
  nextCross: string | null
  nextCrossBasis: number
  daysToNextCross: number | null
  oldestLot: string | null
  lastBuy: string | null
  daysSinceBuy: number | null
  buys30d: number
  buys61d: number
  /** what FIFO says the remaining shares cost -- i.e. what the broker will report */
  brokerBasis: number
  /** brokerBasis minus basis; non-zero only where a real sale has left shares behind */
  brokerGap: number
}

export type TaxCrossing = { month: string; basis: number; cumulative: number }

export type TaxTotals = {
  positions: number
  unpriced: number
  /** across every position -- basis comes from the trades, so it is always known */
  basis: number
  longBasis: number
  shortBasis: number
  /** across PRICED positions only */
  value: number
  longValue: number
  shortValue: number
  /** the basis of those same priced positions, so a gain has an honest denominator */
  pricedBasis: number
  pricedLongBasis: number
  pricedShortBasis: number
  /** basis sitting in positions the price sweep has not reached */
  unpricedBasis: number
  nextCross: string | null
}

export type TaxStatus = {
  asOf: string
  totals: TaxTotals
  crossings: TaxCrossing[]
  positions: TaxPosition[]
}

/** Admin only. Throws "admin only" for anyone else -- the gate is the RPC's, not this file's. */
export async function fetchTaxStatus(): Promise<TaxStatus> {
  const { data, error } = await getSupabaseClient().rpc('admin_tax_status')
  if (error) throw error
  return data as TaxStatus
}

// ── what the numbers mean, in words, in one place ──────────────────────────
// Same reasoning as voice/callWords.ts: the summary row and the per-holding row must never be
// able to describe the same situation differently, so neither of them gets to phrase it.

export type HoldingVerdict = {
  level: 'long' | 'mixed' | 'short'
  text: string
}

const fmtDate = (iso: string): string =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const days = (n: number): string => (n === 1 ? '1 day' : `${n} days`)

/**
 * What fraction of a position is long-term, MEASURED IN BASIS rather than in units.
 *
 * Units and dollars disagree whenever the lots were bought at different prices, and the summary
 * card above is in dollars — so a row reading "80% long-term" beside a total that disagreed
 * would be the same quantity answered two ways, one screen apart. Dollars win because dollars
 * are what gets taxed.
 */
export function longFraction(p: TaxPosition): number {
  const total = p.longBasis + p.shortBasis
  return total > 0 ? p.longBasis / total : 0
}

/** How much of this position is long-term, and what that means for selling it. */
export function holdingVerdict(p: TaxPosition): HoldingVerdict {
  if (p.longUnits + p.shortUnits <= 0) return { level: 'short', text: 'Nothing held.' }
  if (p.shortUnits <= 0.000001) {
    return { level: 'long', text: 'All long-term — a sale is taxed at capital-gains rates.' }
  }
  if (p.longUnits <= 0.000001) {
    const when =
      p.nextCross && p.daysToNextCross != null
        ? ` The first shares turn long-term on ${fmtDate(p.nextCross)}, in ${days(p.daysToNextCross)}.`
        : ''
    return {
      level: 'short',
      text: `All short-term — a gain would be taxed as ordinary income.${when}`,
    }
  }
  const pct = Math.round(longFraction(p) * 100)
  const when =
    p.nextCross && p.daysToNextCross != null
      ? ` Another ${usd(p.nextCrossBasis)} crosses on ${fmtDate(p.nextCross)}.`
      : ''
  return { level: 'mixed', text: `${pct}% long-term, by cost.${when}` }
}

export type WashVerdict = { level: 'none' | 'watch' | 'wash' | 'exempt'; text: string }

/**
 * Whether a loss taken on this position would actually be deductible.
 *
 * ⚠️ The crypto case is a statement about what the law says today, deliberately worded as such.
 * §1091 covers "stocks or securities" and the IRS treats digital assets as property, so it does
 * not currently reach them; extending it has been proposed more than once and has not passed.
 * Saying "exempt" flatly would be asserting something that could stop being true between one
 * page load and the next.
 */
export function washVerdict(p: TaxPosition): WashVerdict {
  if (p.assetType === 'crypto') {
    return {
      level: 'exempt',
      text:
        'Crypto. The wash-sale rule covers stocks and securities, and digital assets are ' +
        'currently treated as property — so a loss here is not disallowed by it today. That has ' +
        'been proposed to change; worth checking before you rely on it.',
    }
  }
  if (p.daysSinceBuy != null && p.daysSinceBuy <= 30) {
    const drip =
      p.buys30d >= 3
        ? ` You have bought it ${p.buys30d} times in the last 30 days, so this is not a one-off.`
        : ''
    return {
      level: 'wash',
      text: `Bought ${days(p.daysSinceBuy)} ago — a loss sold today is disallowed and rolls into the basis of those shares.${drip}`,
    }
  }
  if (p.daysSinceBuy != null && p.daysSinceBuy <= 61) {
    return {
      level: 'watch',
      text: `Last bought ${days(p.daysSinceBuy)} ago. Clear of the 30 days before — but buying again within 30 days after a loss sale would disallow it just the same.`,
    }
  }
  return { level: 'none', text: '' }
}

/**
 * What waiting is worth: the extra tax on selling the short-term half TODAY rather than after
 * it crosses. Null when there is no short-term gain to tax — a loss has nothing to wait for,
 * and this is the one question a rate can answer.
 */
export function costOfSellingNow(
  p: TaxPosition,
  ordinaryPct: number | null,
  longPct: number,
): number | null {
  if (ordinaryPct == null) return null
  if (p.shortValue == null) return null
  const gain = p.shortValue - p.shortBasis
  if (gain <= 0) return null
  return (gain * (ordinaryPct - longPct)) / 100
}

/** Unrealized gain or loss on what is still held, split the way the tax treats it. */
export function unrealized(p: TaxPosition): {
  total: number | null
  long: number | null
  short: number | null
} {
  return {
    total: p.value == null ? null : p.value - p.basis,
    long: p.longValue == null ? null : p.longValue - p.longBasis,
    short: p.shortValue == null ? null : p.shortValue - p.shortBasis,
  }
}

export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}
