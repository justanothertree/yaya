// Read-only portfolio for the signed-in member: the family accounts they own, each with its
// dollars/day promise and holdings rolled up from allocations. Computed server-side by the
// get_my_portfolio RPC so a member sees their holdings without owning the host's raw trades.
// Profit/loss is intentionally absent for now (no live prices) — `cost` is the dollars allocated.
import { getSupabaseClient } from './client'

export type Holding = {
  symbol: string
  assetType: string | null
  units: number
  /** Dollars allocated to this account for this asset (cost basis). */
  cost: number
}

export type AccountPortfolio = {
  id: string
  name: string | null
  dollarPerDay: number
  startDate: string | null
  holdings: Holding[]
}

export async function fetchMyPortfolio(): Promise<AccountPortfolio[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.rpc('get_my_portfolio')
  if (error) throw error
  const raw = (data as Array<Record<string, unknown>> | null) ?? []
  return raw.map((a) => ({
    id: String(a.id),
    name: (a.name as string | null) ?? null,
    dollarPerDay: Number(a.dollarPerDay ?? 0),
    startDate: (a.startDate as string | null) ?? null,
    holdings: ((a.holdings as Array<Record<string, unknown>> | null) ?? []).map((h) => ({
      symbol: String(h.symbol ?? ''),
      assetType: (h.assetType as string | null) ?? null,
      units: Number(h.units ?? 0),
      cost: Number(h.cost ?? 0),
    })),
  }))
}

/** Total dollars invested (at cost) across an account's holdings. */
export const accountTotalCost = (a: AccountPortfolio): number =>
  a.holdings.reduce((s, h) => s + h.cost, 0)

/** Dollars promised to date = rate × days since the account's start date (null if unset). */
export function promisedToDate(a: AccountPortfolio): number | null {
  if (!a.dollarPerDay || !a.startDate) return null
  const start = new Date(a.startDate + 'T00:00:00').getTime()
  if (Number.isNaN(start)) return null
  const days = Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
  return a.dollarPerDay * days
}

/** Stable, pleasant color per asset symbol (for bars + dots). */
export function assetColor(symbol: string): string {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
  return `hsl(${h} 62% 52%)`
}

export const usd = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
