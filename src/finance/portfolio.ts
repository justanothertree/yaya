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
  /**
   * Fresh money Evan put in for this account, derived from the trades — see
   * finance.account_ledger. A purchase funded by their OWN sale proceeds is not a contribution,
   * so rotating a position never inflates this.
   *
   * (It used to come from a typed ledger on the theory that a commingled fund made it
   * underivable. That was true until family/personal was designated per symbol; once each trade
   * is marked, the walk is exact — and a number nobody has to remember to type is a number that
   * stays right.)
   */
  contributed?: number
  /**
   * Proceeds from selling THEIR shares. Still theirs, waiting to be reinvested.
   *
   * Without this an account was shares and nothing else, so a sale made it shrink and the money
   * disappeared — the opposite of "they keep their own profits".
   */
  cash?: number
  /**
   * What the shares STILL HELD cost, at average basis — the broker's measure.
   *
   * ⚠️ Not the sum of `cost` across holdings: that is net cash (buys minus sells) and for a
   * churned symbol it can be negative while real shares are still held.
   */
  heldBasis?: number
  /** false while an account has no allocated trades at all; suppresses ahead/behind entirely */
  ready?: boolean
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
    contributed: a.contributed == null ? undefined : Number(a.contributed),
    cash: a.cash == null ? undefined : Number(a.cash),
    heldBasis: a.heldBasis == null ? undefined : Number(a.heldBasis),
    ready: a.ready == null ? undefined : Boolean(a.ready),
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

// ⚠️ REMOVED 2026-08-24: accountMarket() and accountTotalCost(). Both were dead — no caller
// anywhere in src, server or scripts — and both summed `h.cost` across holdings, which is NET
// CASH (buys minus sells). `heldBasis` six lines up says in as many words why that is the wrong
// quantity: for a churned symbol it can be negative while real shares are still held.
//
// accountMarket() went further and returned `gain: value - cost` from it — the superseded
// formula that reported this fund as "+127.8%" while its holdings were down 11.9%.
//
// Left in place they were a loaded gun sitting beside the right answer, with a docstring
// advertising themselves as "market value + gain/loss". Use accountValue() and accountGain().
// docs/2026-08-24-dead-exports-in-the-money-math.md has the full bodies if either is ever wanted.

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

/**
 * What this account is worth today: the shares, at market. NOT including cash.
 *
 * ⚠️ Cash from sales is deliberately kept OUT of the headline and shown beside it as "still to
 * be invested". Folding it in asserts money is theirs that may since have been spent — the fund
 * is commingled, and $7,191 of assumed cash is a large thing to claim on a page family read.
 * Conservative on purpose: never overstate what somebody has.
 */
export const accountValue = (a: AccountPortfolio): number => accountReserved(a)

/**
 * Gain or loss on the shares actually held, against what those shares cost.
 *
 * ⚠️ Against heldBasis, never against money-in. Against money-in this fund read "+127.8%" while
 * its holdings were down 11.9% — six years of recycling the same dollars ($51,428 bought,
 * $49,221 sold, only $2,207 genuinely new) shrinks the denominator until the percentage
 * describes the churn instead of the investment. Against basis, churn cannot distort it: the
 * question becomes "are these shares up or down", which is what anyone is actually asking.
 */
export function accountGain(
  a: AccountPortfolio,
): { dollars: number; percent: number | null } | null {
  const basis = a.heldBasis
  if (basis == null) return null
  const dollars = accountValue(a) - basis
  return { dollars, percent: basis > 0 ? (dollars / basis) * 100 : null }
}

/** Ahead/behind schedule = reserved value minus promised-to-date. Positive = more value is
 *  reserved than promised so far; negative = owe more. Null when there's no promise to compare. */
/**
 * ⚠️ Measured against what was DECLARED as set aside, not against the market value of whichever
 * trades happened to get designated family.
 *
 * The fund is commingled with personal trading, so designation is guesswork and any figure
 * derived from it is guesswork too. Three derivations over the same trades gave "behind
 * $8,376", "ahead $41,313" and "$770 invested" — not competing answers, all noise from a
 * missing input.
 *
 * Returns null when nothing has been declared yet, which the UI must render as "still being set
 * up" rather than a confident zero.
 */
/**
 * Ahead or behind the dollar-a-day promise = MONEY PUT IN minus money promised.
 *
 * ⚠️ Never market value. Evan's rule, in his words: they are only behind if the initial
 * investment did not meet the dollar-a-day promise — not if it met it and then depreciated. A
 * holding that falls in value is a loss, shown as a loss; it is not a broken promise, and
 * conflating the two would tell someone they were short-changed when they were not.
 *
 * There used to be a fallback here that used reserved VALUE when no contribution was known.
 * That was exactly the conflation above, so it now returns null instead: no answer beats a
 * wrong one.
 */
export function aheadBehind(a: AccountPortfolio): number | null {
  const promised = promisedToDate(a)
  if (promised == null) return null
  if (a.ready === false) return null
  if (a.contributed == null) return null
  return a.contributed - promised
}

/**
 * Roll up invested / promised / ahead-behind across a set of accounts (only those with a promise).
 *
 * ⚠️ AN UNKNOWN IS NOT A ZERO. This used to add `a.contributed ?? 0` and `a.heldBasis ?? 0`,
 * which quietly turned "we don't know what was put in" into "nothing was put in". The
 * single-account `aheadBehind()` three functions up refuses to answer in exactly that case —
 * the rollup answered anyway, and answered wrong in the most alarming possible direction:
 * behind by the ENTIRE promise, plus a gain equal to the entire portfolio (value minus a basis
 * of zero). The signed-out demo showed exactly that, contradicting its own chart on the same
 * screen.
 *
 * The same drift has now bitten this module twice — get_my_portfolio vs admin_get_portfolios,
 * and now aheadBehind vs portfolioTotals. Two functions answering one question must agree about
 * what they don't know, not just about what they do.
 *
 * So the derived figures are nullable, and null means "not knowable", which the UI must render
 * as a sentence rather than a number.
 */
export function portfolioTotals(accounts: AccountPortfolio[]): {
  /** null when any tracked account has no contribution figure — see above */
  invested: number | null
  promised: number
  /** null when `invested` is */
  aheadBehind: number | null
  tracked: number
  /** Combined $/day promise across the tracked accounts (for the runway figure). */
  dailyRate: number
  /** what the shares are worth today, at market. Cash is reported separately. */
  value: number
  /** proceeds from sales not yet reinvested — theirs, but not yet invested */
  cash: number
  /** what the held shares cost, at average basis; null when any account's basis is unknown */
  basis: number | null
  /** value minus basis, and the same as a percentage (null when either is unknown) */
  gain: number | null
  gainPercent: number | null
  /** false when no account has any allocated trades — show "being set up", not a number */
  ready: boolean
} {
  let invested = 0
  let promised = 0
  let tracked = 0
  let dailyRate = 0
  let value = 0
  let cash = 0
  let basis = 0
  let knowContributed = true
  let knowBasis = true
  // Same rule as aheadBehind(): money IN versus money promised, never market value.
  let ready = true
  for (const a of accounts) {
    const p = promisedToDate(a)
    if (p == null) continue
    if (a.ready === false) ready = false
    tracked++
    if (a.contributed == null) knowContributed = false
    else invested += a.contributed
    if (a.heldBasis == null) knowBasis = false
    else basis += a.heldBasis
    value += accountValue(a)
    cash += a.cash ?? 0
    promised += p
    dailyRate += a.dollarPerDay
  }
  const investedOrNull = knowContributed ? invested : null
  const basisOrNull = knowBasis ? basis : null
  const gain = basisOrNull == null ? null : value - basisOrNull
  return {
    invested: investedOrNull,
    promised,
    aheadBehind: investedOrNull == null ? null : investedOrNull - promised,
    value,
    cash,
    basis: basisOrNull,
    gain,
    gainPercent:
      gain != null && basisOrNull != null && basisOrNull > 0 ? (gain / basisOrNull) * 100 : null,
    tracked,
    dailyRate,
    ready,
  }
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
