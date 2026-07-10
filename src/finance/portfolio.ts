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
  /** Latest cached market price (null until the price sweep has seen this symbol). */
  price?: number | null
  /** When that price was cached. */
  priceAt?: string | null
}

export type AccountPortfolio = {
  id: string
  name: string | null
  dollarPerDay: number
  startDate: string | null
  holdings: Holding[]
  /** Owner info — only present in the admin (all-accounts) view. */
  ownerUserId?: string | null
  ownerName?: string | null
  ownerUsername?: string | null
}

function mapAccount(a: Record<string, unknown>): AccountPortfolio {
  return {
    id: String(a.id),
    name: (a.name as string | null) ?? null,
    dollarPerDay: Number(a.dollarPerDay ?? 0),
    startDate: (a.startDate as string | null) ?? null,
    ownerUserId: (a.ownerUserId as string | null) ?? null,
    ownerName: (a.ownerName as string | null) ?? null,
    ownerUsername: (a.ownerUsername as string | null) ?? null,
    holdings: ((a.holdings as Array<Record<string, unknown>> | null) ?? []).map((h) => ({
      symbol: String(h.symbol ?? ''),
      assetType: (h.assetType as string | null) ?? null,
      units: Number(h.units ?? 0),
      cost: Number(h.cost ?? 0),
      price: h.price == null ? null : Number(h.price),
      priceAt: (h.priceAt as string | null) ?? null,
    })),
  }
}

/** The signed-in member's own portfolio. */
export async function fetchMyPortfolio(): Promise<AccountPortfolio[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.rpc('get_my_portfolio')
  if (error) throw error
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapAccount)
}

/** Admin only: every family account's portfolio, with owner info. Throws for non-admins. */
export async function fetchAllPortfolios(): Promise<AccountPortfolio[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.rpc('admin_get_portfolios')
  if (error) throw error
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(mapAccount)
}

export async function checkIsAdmin(): Promise<boolean> {
  const { data } = await getSupabaseClient().rpc('is_admin')
  return data === true
}

// ── Admin: manage family accounts ──────────────────────────────────────────
export type Member = {
  userId: string
  username: string | null
  displayName: string | null
  role: string | null
}

/** Admin only: the member roster, for linking an account to a person. */
export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await getSupabaseClient().rpc('list_members')
  if (error) throw error
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((m) => ({
    userId: String(m.user_id),
    username: (m.username as string | null) ?? null,
    displayName: (m.display_name as string | null) ?? null,
    role: (m.role as string | null) ?? null,
  }))
}

export async function adminCreateAccount(
  ownerUid: string,
  name: string,
  dollarPerDay: number,
  startDate: string | null,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_create_family_account', {
    p_owner: ownerUid,
    p_name: name,
    p_dollar_per_day: dollarPerDay,
    p_start_date: startDate || null,
  })
  if (error) throw error
}

export async function adminUpdateAccount(
  accountId: string,
  name: string,
  dollarPerDay: number,
  startDate: string | null,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_update_family_account', {
    p_account: accountId,
    p_name: name,
    p_dollar_per_day: dollarPerDay,
    p_start_date: startDate || null,
  })
  if (error) throw error
}

export async function adminDeleteAccount(accountId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_delete_family_account', {
    p_account: accountId,
  })
  if (error) throw error
}

/** Hand an account (with all its holdings/history) to a different member — the
 *  test-slot → real-family transition. */
export async function adminReassignAccount(accountId: string, newOwnerUid: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_reassign_family_account', {
    p_account: accountId,
    p_new_owner: newOwnerUid,
  })
  if (error) throw error
}

/** Turn on a member's Investments access. Done automatically when an account is created for them
 *  so "add their account to the fund" also lets them see it. */
export async function adminEnableFinance(userId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_set_feature', {
    p_user_id: userId,
    p_feature: 'finance',
    p_enabled: true,
  })
  if (error) throw error
}

// ── Admin: the trades ledger (what's allocated to the family fund vs still yours) ──
export type Trade = {
  id: string
  symbol: string
  assetType: string | null
  platform: string | null
  /** ISO date (yyyy-mm-dd) of execution. */
  date: string
  dollars: number
  price: number
  units: number
}

export type AllocationRow = {
  id: string
  familyAccountId: string
  executedTradeId: string
  unitsAllocated: number
}

/** PostgREST caps any single response at 1000 rows — with 1,500+ trades and 7,000+
 *  allocations that silently truncated the ledger and corrupted its family/yours math.
 *  Page through the RPC until a short page says we have everything. */
async function rpcAllRows(
  fn: 'get_executed_trades' | 'get_allocations',
  uid: string,
): Promise<Array<Record<string, unknown>>> {
  const sb = getSupabaseClient()
  const PAGE = 1000
  const out: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.rpc(fn, { uid }).range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data as Array<Record<string, unknown>> | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** The signed-in owner's executed trades — all of them (paged past the row cap). */
export async function fetchMyTrades(): Promise<Trade[]> {
  const sb = getSupabaseClient()
  const { data: u } = await sb.auth.getUser()
  const uid = u.user?.id
  if (!uid) return []
  const rows = await rpcAllRows('get_executed_trades', uid)
  return rows.map((t) => ({
    id: String(t.id),
    symbol: String(t.asset_symbol ?? ''),
    assetType: (t.asset_type as string | null) ?? null,
    platform: (t.platform as string | null) ?? null,
    date: String(t.execution_time ?? '').slice(0, 10),
    dollars: Number(t.dollar_amount ?? 0),
    price: Number(t.price ?? 0),
    units: Number(t.units_acquired ?? 0),
  }))
}

/** The signed-in owner's allocations — all of them (paged past the row cap). */
export async function fetchMyAllocations(): Promise<AllocationRow[]> {
  const sb = getSupabaseClient()
  const { data: u } = await sb.auth.getUser()
  const uid = u.user?.id
  if (!uid) return []
  const rows = await rpcAllRows('get_allocations', uid)
  return rows.map((a) => ({
    id: String(a.id),
    familyAccountId: String(a.family_account_id),
    executedTradeId: String(a.executed_trade_id),
    unitsAllocated: Number(a.units_allocated ?? 0),
  }))
}

// ── Positions: family vs personal designation, per broker ──────────────────
export type Position = {
  symbol: string
  /** Which broker this holding is on — the same ticker can differ per broker. */
  platform: string
  assetType: string | null
  /** Net units held (buys minus sells). */
  units: number
  /** Net dollars in (buys minus sell proceeds). */
  dollars: number
  trades: number
  price: number | null
  /** Current market value (units × cached price), null until priced. */
  value: number | null
  isFamily: boolean
}

/** Admin: every holding (per broker) with totals and its family/personal designation. */
export async function fetchPositions(): Promise<Position[]> {
  const { data, error } = await getSupabaseClient().rpc('admin_list_positions')
  if (error) throw error
  return ((data as Array<Record<string, unknown>> | null) ?? []).map((p) => ({
    symbol: String(p.symbol ?? ''),
    platform: String(p.platform ?? 'unknown'),
    assetType: (p.assetType as string | null) ?? null,
    units: Number(p.units ?? 0),
    dollars: Number(p.dollars ?? 0),
    trades: Number(p.trades ?? 0),
    price: p.price == null ? null : Number(p.price),
    value: p.value == null ? null : Number(p.value),
    isFamily: p.isFamily !== false,
  }))
}

/** Flip one broker's holding of a symbol family/personal — allocations re-sync to match. */
export async function setSymbolDesignation(
  symbol: string,
  platform: string,
  family: boolean,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_set_symbol_designation', {
    p_symbol: symbol,
    p_platform: platform,
    p_family: family,
  })
  if (error) throw error
}

/** Assert one broker's TRUE current units for a symbol (exports miss some events — Cash App
 *  has no split rows at all). The delta lands as a zero-dollar adjustment on that broker. */
export async function correctPosition(
  symbol: string,
  platform: string,
  trueUnits: number,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_correct_position', {
    p_symbol: symbol,
    p_platform: platform,
    p_true_units: trueUnits,
  })
  if (error) throw error
}

/** Set (or clear, with 0/null) the true average cost per share for a position — the basis
 *  for percent P/L when the trade history can't reconstruct it (churn, missing early buys). */
export async function setPositionCost(
  symbol: string,
  platform: string,
  avgCost: number | null,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_set_position_cost', {
    p_symbol: symbol,
    p_platform: platform,
    p_avg_cost: avgCost,
  })
  if (error) throw error
}

/** Assign units of one trade to one account (manual allocation — e.g. a single share). */
export async function assignAllocation(
  accountId: string,
  tradeId: string,
  units: number,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('insert_allocation', {
    payload: {
      family_account_id: accountId,
      executed_trade_id: tradeId,
      units_allocated: units,
    },
  })
  if (error) throw error
}

/** Manually cache a price (the keyless fallback when no free source covers a symbol). */
export async function adminSetPrice(symbol: string, price: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc('admin_set_price', {
    p_symbol: symbol,
    p_price: price,
  })
  if (error) throw error
}

/** Market value + gain/loss across an account's PRICED holdings. Null until any price is
 *  cached. Deliberately separate from the ahead/behind schedule, which stays cost-vs-promised. */
export function accountMarket(a: AccountPortfolio): {
  value: number
  gain: number
  priced: number
  unpriced: number
} | null {
  let value = 0
  let cost = 0
  let priced = 0
  let unpriced = 0
  for (const h of a.holdings) {
    if (h.price == null) {
      unpriced++
      continue
    }
    priced++
    value += h.units * h.price
    cost += h.cost
  }
  if (priced === 0) return null
  return { value, gain: value - cost, priced, unpriced }
}

/** Total dollars invested (at cost) across an account's holdings. */
export const accountTotalCost = (a: AccountPortfolio): number =>
  a.holdings.reduce((s, h) => s + h.cost, 0)

/** Current worth of what's reserved for this account = units × price (priced holdings only).
 *  This is the family fund's basis instead of at-cost: a churned symbol (bought and sold over
 *  years) can have a negative net cash cost while still holding shares worth a positive amount,
 *  so we value what's reserved by what it's worth today. */
export const accountReserved = (a: AccountPortfolio): number =>
  a.holdings.reduce((s, h) => (h.price != null ? s + h.units * h.price : s), 0)

/** Dollars promised to date = rate × days since the account's start date (null if unset). */
export function promisedToDate(a: AccountPortfolio): number | null {
  if (!a.dollarPerDay || !a.startDate) return null
  const start = new Date(a.startDate + 'T00:00:00').getTime()
  if (Number.isNaN(start)) return null
  const days = Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
  return a.dollarPerDay * days
}

/** Ahead/behind schedule = reserved value minus promised-to-date. Positive = more value is
 *  reserved than promised so far; negative = owe more. Null when there's no promise to compare. */
export function aheadBehind(a: AccountPortfolio): number | null {
  const promised = promisedToDate(a)
  if (promised == null) return null
  return accountReserved(a) - promised
}

/** Roll up invested / promised / ahead-behind across a set of accounts (only those with a promise). */
export function portfolioTotals(accounts: AccountPortfolio[]): {
  invested: number
  promised: number
  aheadBehind: number
  tracked: number
  /** Combined $/day promise across the tracked accounts (for the runway figure). */
  dailyRate: number
} {
  let invested = 0
  let promised = 0
  let tracked = 0
  let dailyRate = 0
  for (const a of accounts) {
    const p = promisedToDate(a)
    if (p == null) continue
    tracked++
    invested += accountReserved(a)
    promised += p
    dailyRate += a.dollarPerDay
  }
  return { invested, promised, aheadBehind: invested - promised, tracked, dailyRate }
}

/** How many days ahead of / behind the dollar-a-day plan you are = |ahead$| ÷ daily rate.
 *  Ahead → days you could pause buying; behind → days of buying to catch up. */
export function runwayDays(aheadBehind: number, dailyRate: number): number | null {
  if (!dailyRate) return null
  return Math.round(Math.abs(aheadBehind) / dailyRate)
}

/** Stable, pleasant color per asset symbol (for bars + dots). */
export function assetColor(symbol: string): string {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
  return `hsl(${h} 62% 52%)`
}

export const usd = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
