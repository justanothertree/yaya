// Time-series data for the portfolio chart: dated allocation events (cost/units deltas)
// plus daily price points, fetched via the timeline RPCs and folded into cumulative
// invested / promised / value curves. Value only spans days a price is known for —
// history accrues from the daily price sweep, so that line grows richer over time.
import { getSupabaseClient } from './client'

export type TimelineAccount = { dollarPerDay: number; startDate: string | null }
export type TimelineEvent = { date: string; symbol: string; units: number; cost: number }
export type PricePoint = { symbol: string; date: string; price: number }
export type Timeline = {
  accounts: TimelineAccount[]
  events: TimelineEvent[]
  prices: PricePoint[]
}

function mapTimeline(data: Record<string, unknown>): Timeline {
  return {
    accounts: ((data.accounts as Array<Record<string, unknown>> | null) ?? []).map((a) => ({
      dollarPerDay: Number(a.dollarPerDay ?? 0),
      startDate: (a.startDate as string | null) ?? null,
    })),
    events: ((data.events as Array<Record<string, unknown>> | null) ?? []).map((e) => ({
      date: String(e.date ?? ''),
      symbol: String(e.symbol ?? ''),
      units: Number(e.units ?? 0),
      cost: Number(e.cost ?? 0),
    })),
    prices: ((data.prices as Array<Record<string, unknown>> | null) ?? []).map((p) => ({
      symbol: String(p.symbol ?? ''),
      date: String(p.date ?? ''),
      price: Number(p.price ?? 0),
    })),
  }
}

/** The signed-in member's own timeline (their accounts). */
export async function fetchMyTimeline(): Promise<Timeline> {
  const { data, error } = await getSupabaseClient().rpc('get_my_timeline')
  if (error) throw error
  return mapTimeline((data as Record<string, unknown>) ?? {})
}

/** Admin: the whole fund's timeline. */
export async function fetchFundTimeline(): Promise<Timeline> {
  const { data, error } = await getSupabaseClient().rpc('admin_get_timeline')
  if (error) throw error
  return mapTimeline((data as Record<string, unknown>) ?? {})
}

export type SeriesPoint = {
  date: string
  invested: number
  promised: number
  /** Market value that day — null before any price history exists. */
  value: number | null
}

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Fold the timeline into one point per day from `fromISO` to `toISO` (inclusive). */
export function buildDailySeries(t: Timeline, fromISO: string, toISO: string): SeriesPoint[] {
  const from = Date.parse(fromISO + 'T00:00:00Z')
  const to = Date.parse(toISO + 'T00:00:00Z')
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return []

  const events = [...t.events].sort((a, b) => a.date.localeCompare(b.date))
  const pricesBySymbol = new Map<string, PricePoint[]>()
  for (const p of [...t.prices].sort((a, b) => a.date.localeCompare(b.date))) {
    const arr = pricesBySymbol.get(p.symbol) ?? []
    arr.push(p)
    pricesBySymbol.set(p.symbol, arr)
  }

  const units = new Map<string, number>()
  let invested = 0
  let ei = 0
  const pi = new Map<string, number>() // per-symbol pointer into its price list
  const lastPrice = new Map<string, number>()

  // replay everything before the window so cumulative state is correct at `from`
  const advance = (dayISO: string) => {
    while (ei < events.length && events[ei].date <= dayISO) {
      const e = events[ei++]
      invested += e.cost
      units.set(e.symbol, (units.get(e.symbol) ?? 0) + e.units)
    }
    for (const [sym, list] of pricesBySymbol) {
      let i = pi.get(sym) ?? 0
      while (i < list.length && list[i].date <= dayISO) {
        lastPrice.set(sym, list[i].price)
        i++
      }
      pi.set(sym, i)
    }
  }
  advance(iso(from - DAY))

  const out: SeriesPoint[] = []
  for (let d = from; d <= to; d += DAY) {
    const dayISO = iso(d)
    advance(dayISO)

    let promised = 0
    for (const a of t.accounts) {
      if (!a.dollarPerDay || !a.startDate) continue
      const start = Date.parse(a.startDate + 'T00:00:00Z')
      if (!Number.isFinite(start)) continue
      const days = Math.floor((d - start) / DAY)
      if (days > 0) promised += a.dollarPerDay * days
    }

    let value: number | null = null
    for (const [sym, u] of units) {
      const p = lastPrice.get(sym)
      if (p == null || u <= 0) continue
      value = (value ?? 0) + u * p
    }

    out.push({ date: dayISO, invested, promised, value })
  }
  return out
}

// ── Demo timeline (signed-out) ─────────────────────────────────────────────
// Derived from the demo holdings so the chart's endpoints match the demo cards
// exactly: each holding accrues in equal weekly buys, and each symbol's price
// follows a seeded random walk that ends at its demo price.
import { DEMO_PORTFOLIO } from './demoPortfolio'

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function demoTimeline(): Timeline {
  const start = Date.parse('2026-01-02T00:00:00Z')
  const end = Date.parse('2026-07-01T00:00:00Z')
  const weeks = 26

  // aggregate demo holdings by symbol
  const totals = new Map<string, { units: number; cost: number; price: number }>()
  for (const acct of DEMO_PORTFOLIO) {
    for (const h of acct.holdings) {
      const cur = totals.get(h.symbol) ?? { units: 0, cost: 0, price: h.price ?? 0 }
      cur.units += h.units
      cur.cost += h.cost
      if (h.price != null) cur.price = h.price
      totals.set(h.symbol, cur)
    }
  }

  const events: TimelineEvent[] = []
  for (let w = 0; w < weeks; w++) {
    const date = iso(start + w * 7 * DAY)
    for (const [symbol, tot] of totals) {
      events.push({ date, symbol, units: tot.units / weeks, cost: tot.cost / weeks })
    }
  }

  // price walks: generate backwards from the demo end price, then reverse
  const prices: PricePoint[] = []
  let seed = 7
  for (const [symbol, tot] of totals) {
    const rand = mulberry32(seed++ * 1013)
    const days: number[] = []
    for (let d = start; d <= end; d += DAY) days.push(d)
    const walk: number[] = new Array(days.length)
    walk[days.length - 1] = tot.price
    for (let i = days.length - 2; i >= 0; i--) {
      walk[i] = walk[i + 1] / (1 + (rand() - 0.48) * 0.03)
    }
    days.forEach((d, i) => prices.push({ symbol, date: iso(d), price: walk[i] }))
  }

  const accounts: TimelineAccount[] = DEMO_PORTFOLIO.map((a) => ({
    dollarPerDay: a.dollarPerDay,
    startDate: a.startDate,
  }))
  return { accounts, events, prices }
}
