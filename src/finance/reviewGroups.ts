/**
 * The trade review, as arithmetic rather than as JSX.
 *
 * ⚠️ THE SCREEN THIS SERVES IS THE ONE THAT MOVES REAL MONEY WITH ONE TAP, and it had no tests of
 * any kind. `admin_set_trade_allocation` deletes a trade's allocations, stamps `reviewed_at` and
 * re-splits `units × fraction` across every account that had started by the trade's date — so a
 * mis-read fraction is somebody's shares. Measured on 29 Oct 2026: 103 trades were answered in
 * about seven minutes, 109 of the 113 ever answered say "Mine". At roughly four seconds a tap,
 * the thing worth being careful about is not speed.
 *
 * ⚠️ AND IT IS PURE BECAUSE THE PANEL NEEDS AN ADMIN SESSION. `#dev-admin` renders the real panel
 * with no token, so every RPC answers nothing and the review list is empty — a room with nothing
 * in it passes every check there is. The parsing and the grouping live here so vitest can ask
 * them; the wiring stays in the component.
 */

/** One trade still waiting on "was this for the family?", as `admin_unallocated_trades` sends it. */
export type ReviewTrade = {
  id: string
  date: string
  symbol: string
  platform: string
  dollars: number
  units: number
  isFamilySymbol: boolean
  alreadyHeld: number
  /** how many accounts the split will actually reach — per trade, because start dates differ */
  eligibleAccounts?: number
}

export type ReviewGroup = {
  /** symbol and platform together: designation is per broker, so SOFI is two different questions */
  key: string
  symbol: string
  platform: string
  broker: string
  trades: ReviewTrade[]
  /** signed sums, so a buy and a sell in the same symbol do not pretend to be one big buy */
  dollars: number
  units: number
  alreadyHeld: number
  isFamilySymbol: boolean
}

/** The broker, in the words the page uses elsewhere. An unknown one is shown as it arrived. */
export function brokerName(platform: string): string {
  if (platform === 'cashapp') return 'Cash App'
  if (platform === 'robinhood') return 'Robinhood'
  return platform
}

/**
 * Group by symbol AND platform, newest first.
 *
 * ⚠️ NOT BY SYMBOL ALONE, which is the tempting version and would be wrong in a way that is hard
 * to see afterwards. `symbol_designations` is keyed `(asset_symbol, platform)` and so is every
 * allocation question built on it: PEP is family on Robinhood and untouched on Cash App, where it
 * is a closed position of four unallocated trades. Grouping those together would offer one
 * "All theirs" over two different holdings.
 *
 * The order within a group is the order it arrived in — `admin_unallocated_trades` already sorts
 * newest first — and groups are ordered by their newest trade, so a fresh import stays at the top.
 */
export function groupForReview(trades: ReviewTrade[]): ReviewGroup[] {
  const by = new Map<string, ReviewGroup>()
  for (const t of trades) {
    const key = `${t.symbol}|${t.platform}`
    const g = by.get(key)
    if (!g) {
      by.set(key, {
        key,
        symbol: t.symbol,
        platform: t.platform,
        broker: brokerName(t.platform),
        trades: [t],
        dollars: t.dollars,
        units: t.units,
        alreadyHeld: t.alreadyHeld,
        isFamilySymbol: t.isFamilySymbol,
      })
      continue
    }
    g.trades.push(t)
    g.dollars += t.dollars
    g.units += t.units
    /* `alreadyHeld` is a property of the SYMBOL, not of the trade — every row in a group carries
       the same figure, so it is taken once rather than summed into nonsense */
    g.alreadyHeld = Math.max(g.alreadyHeld, t.alreadyHeld)
  }
  return [...by.values()]
}

export type PartAnswer =
  | { ok: true; part: number; fraction: number }
  | { ok: false; why: string | null }

/**
 * What a typed dollar amount means for one trade.
 *
 * ⚠️ `why: null` IS "NOT YET", NOT "WRONG". An empty box is the state the field starts in and the
 * state it returns to on backspace; colouring that red would make the control shout at somebody
 * for having begun. Only a value that cannot be acted on gets a sentence.
 *
 * ⚠️ AND THE OLD VERSION STRIPPED EVERYTHING IT DID NOT LIKE, which turned typos into silent
 * numbers: `raw.replace(/[^0-9.]/g, '')` reads "1.2.3" as "1.2.3" → NaN, but it also reads
 * "12 or 13" as 1213, and "$1,200" as 1200 — one of those is a kindness and the other is a
 * hundredfold error nobody would see before pressing the button. Commas and currency signs are
 * forgiven because they are formatting; anything else is a question, not an amount.
 */
export function partOf(dollars: number, typed: string): PartAnswer {
  const cleaned = typed.trim().replace(/^\$/, '').replace(/,/g, '')
  if (cleaned === '') return { ok: false, why: null }
  if (!/^\d*\.?\d*$/.test(cleaned)) return { ok: false, why: 'Numbers only, please.' }
  const part = Number(cleaned)
  const whole = Math.abs(dollars)
  if (!Number.isFinite(part)) return { ok: false, why: 'Numbers only, please.' }
  if (part <= 0) return { ok: false, why: 'That has to be more than zero.' }
  if (part > whole) {
    return { ok: false, why: `That trade was only ${money(whole)}.` }
  }
  return { ok: true, part, fraction: part / whole }
}

/** Dollars, the way the rest of the finance screens write them. */
function money(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

/**
 * The sentence under the Part… box: what pressing it will actually do.
 *
 * ⚠️ IT SPELLS OUT THE PER-ACCOUNT SHARE BECAUSE THAT IS THE NUMBER NOBODY HAS IN THEIR HEAD.
 * "33% theirs" sounds like a third of something; 0.0101 shares each is what gets written, 33
 * times, and seeing it is the difference between answering and guessing. The count is the
 * server's own per-trade figure, so this cannot promise a split that will not happen.
 */
export function partPreview(
  t: Pick<ReviewTrade, 'dollars' | 'units' | 'eligibleAccounts'>,
  fraction: number,
): string {
  const whole = Math.abs(t.dollars)
  const pct = Math.round(fraction * 100)
  const familyUnits = Math.abs(t.units) * fraction
  const n = t.eligibleAccounts ?? 0
  const head = `${money(whole * fraction)} of ${money(whole)} → ${pct}% theirs`
  if (n <= 0) return `${head} · ${familyUnits.toFixed(4)} units in total`
  const each = familyUnits / n
  return `${head} ≈ ${each.toFixed(4)} sh each × ${n}`
}

/**
 * How an already-answered trade reads back.
 *
 * ⚠️ A RESTATEMENT HAS NO ANSWERABLE FRACTION and must not be given one. `admin_recent_reviews`
 * sends `fraction: null` for a zero-dollar row because `admin_set_trade_allocation` scales those
 * by the family's share of the position first — dividing the allocations back out would produce a
 * percentage nobody ever typed, printed as though they had.
 */
export function answerLabel(a: { fraction: number | null; familyUnits: number }): string {
  if (a.fraction == null) {
    return a.familyUnits === 0 ? 'kept yours' : `${a.familyUnits.toFixed(4)} units theirs`
  }
  if (a.fraction <= 0) return 'kept yours'
  if (a.fraction >= 0.9999) return 'all theirs'
  return `${(a.fraction * 100).toFixed(0)}% theirs`
}
