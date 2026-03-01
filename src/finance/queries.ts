import { requireUser } from './auth'
import { getFinanceClient } from './client'
import { allocations, executedTrades, familyAccounts, priceCache } from './tables'

/**
 * Higher-level query helpers for UI screens.
 *
 * These helpers:
 * - Require auth before querying.
 * - Do not pass user_id filters in code (we don’t assume column names).
 * - Depend on RLS policies using auth.uid() to scope rows to the signed-in user.
 */

export async function fetchFamilyAccountsOverview(params?: { limit?: number }) {
  // A simple “overview” is just a list; UI can compute totals/rollups.
  return familyAccounts.list({
    limit: params?.limit ?? 100,
    orderBy: 'updated_at',
    ascending: false,
  })
}

export async function fetchExecutedTradesHistory(params?: {
  limit?: number
  orderBy?: string
  ascending?: boolean
}) {
  // Default assumes an `executed_at` or similar column; override via orderBy if needed.
  return executedTrades.list({
    limit: params?.limit ?? 250,
    orderBy: params?.orderBy ?? 'executed_at',
    ascending: params?.ascending ?? false,
  })
}

export async function fetchAllocationBreakdowns(params?: {
  limit?: number
  orderBy?: string
  ascending?: boolean
}) {
  return allocations.list({
    limit: params?.limit ?? 500,
    orderBy: params?.orderBy ?? 'id',
    ascending: params?.ascending ?? false,
  })
}

export async function lookupPriceCache(params: {
  /** Column name for the instrument identifier (e.g. symbol/ticker/isin). */
  symbolColumn?: string
  /** Column name for price timestamp/date (e.g. as_of, priced_at). */
  asOfColumn?: string
  symbols: string[]
  /** Optional ISO date/time string for a point-in-time lookup. */
  asOf?: string
  limitPerSymbol?: number
}) {
  await requireUser()
  const sb = getFinanceClient()
  const symbolColumn = params.symbolColumn ?? 'symbol'
  const asOfColumn = params.asOfColumn ?? 'updated_at'
  const limitPerSymbol = params.limitPerSymbol ?? 1

  // Generic implementation: fetch the most recent cached row(s) per symbol.
  // If you need “closest <= asOf”, you may want a dedicated RPC for performance.
  const q = sb.from(priceCache.table).select('*').in(symbolColumn, params.symbols)

  const ordered = q
    .order(asOfColumn, { ascending: false })
    .limit(Math.max(1, limitPerSymbol) * params.symbols.length)
  if (params.asOf) {
    // Fetch rows at/after a specific time is schema-dependent.
    // Many schemas use <= for point-in-time; adjust as needed.
    ordered.lte(asOfColumn, params.asOf)
  }

  const { data, error } = await ordered
  if (error) throw error

  const rows = data ?? []
  // Common UI need: “latest row per symbol”.
  // If limitPerSymbol > 1, keep up to that many rows per symbol.
  const bySymbol = new Map<string, unknown[]>()
  for (const r of rows) {
    const sym = String((r as Record<string, unknown>)[symbolColumn] ?? '')
    if (!sym) continue
    const arr = bySymbol.get(sym) ?? []
    if (arr.length < limitPerSymbol) arr.push(r)
    bySymbol.set(sym, arr)
  }
  // Flatten in requested symbol order.
  const out: unknown[] = []
  for (const sym of params.symbols) {
    const arr = bySymbol.get(sym) ?? []
    out.push(...arr)
  }
  return out
}

/**
 * Portfolio growth over time.
 *
 * This project does not yet define a canonical “portfolio values” table.
 * The UI typically derives growth from executed_trades + price_cache, or you add an RPC.
 *
 * This helper provides the raw building blocks you’ll usually need.
 */
export async function fetchPortfolioGrowthInputs(params?: {
  tradeLimit?: number
  priceSymbols?: string[]
}) {
  const [trades, accounts] = await Promise.all([
    fetchExecutedTradesHistory({ limit: params?.tradeLimit ?? 1000 }),
    fetchFamilyAccountsOverview({ limit: 500 }),
  ])

  const prices = params?.priceSymbols?.length
    ? await lookupPriceCache({ symbols: params.priceSymbols, limitPerSymbol: 1 })
    : []

  return { accounts, trades, prices }
}
