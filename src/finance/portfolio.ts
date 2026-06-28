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

/** Ahead/behind schedule = invested-at-cost minus promised-to-date. Positive = pre-funded (can
 *  pause buying); negative = owe more. Null when there's no promise rate/start to compare against. */
export function aheadBehind(a: AccountPortfolio): number | null {
  const promised = promisedToDate(a)
  if (promised == null) return null
  return accountTotalCost(a) - promised
}

/** Roll up invested / promised / ahead-behind across a set of accounts (only those with a promise). */
export function portfolioTotals(accounts: AccountPortfolio[]): {
  invested: number
  promised: number
  aheadBehind: number
  tracked: number
} {
  let invested = 0
  let promised = 0
  let tracked = 0
  for (const a of accounts) {
    const p = promisedToDate(a)
    if (p == null) continue
    tracked++
    invested += accountTotalCost(a)
    promised += p
  }
  return { invested, promised, aheadBehind: invested - promised, tracked }
}

/** Stable, pleasant color per asset symbol (for bars + dots). */
export function assetColor(symbol: string): string {
  let h = 0
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
  return `hsl(${h} 62% 52%)`
}

export const usd = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
