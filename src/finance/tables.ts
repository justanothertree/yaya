import { createFinanceTableCrud } from './crudFactory'

/**
 * Table helpers for the `finance` schema.
 *
 * NOTE ON TYPES:
 * These types are intentionally minimal because this repo does not include
 * generated Supabase types for the `finance` schema.
 *
 * For best DX/safety, generate `Database` types from Supabase and replace
 * the `Record<string, unknown>` shapes with concrete Row/Insert/Update types.
 */

/**
 * Shared column conventions (as provided):
 * - primary key: `id`
 * - owner column: `user_id` (auth.uid())
 * - created_at / updated_at timestamps (ISO strings)
 */

export type IsoDateTime = string

// -------------------------
// family_accounts
// -------------------------
export type FamilyAccountRow = {
  id: string
  user_id: string
  account_name: string
  /**
   * “balances” can be a single number or a structured object depending on your schema.
   * Keep it flexible until DB types are generated.
   */
  balances: unknown
  created_at: IsoDateTime
  updated_at: IsoDateTime
}

export type FamilyAccountInsert = {
  user_id?: string
  account_name: string
  balances: unknown
}

export type FamilyAccountUpdate = Partial<Pick<FamilyAccountRow, 'account_name' | 'balances'>>

// -------------------------
// executed_trades
// -------------------------
export type TradeType = 'buy' | 'sell'

export type ExecutedTradeRow = {
  id: string
  user_id: string
  executed_at: IsoDateTime
  symbol: string
  quantity: number
  price: number
  type: TradeType
  created_at: IsoDateTime
  updated_at: IsoDateTime
}

export type ExecutedTradeInsert = {
  user_id?: string
  executed_at: IsoDateTime
  symbol: string
  quantity: number
  price: number
  type: TradeType
}

export type ExecutedTradeUpdate = Partial<
  Pick<ExecutedTradeRow, 'executed_at' | 'symbol' | 'quantity' | 'price' | 'type'>
>

// -------------------------
// allocations
// -------------------------
export type AllocationRow = {
  id: string
  user_id: string
  allocation_type: string
  target_percent: number
  created_at: IsoDateTime
  updated_at: IsoDateTime
  // Allow additional allocation dimensions without breaking the type.
  [k: string]: unknown
}

export type AllocationInsert = {
  user_id?: string
  allocation_type: string
  target_percent: number
  [k: string]: unknown
}

export type AllocationUpdate = Partial<
  Pick<AllocationRow, 'allocation_type' | 'target_percent'>
> & {
  [k: string]: unknown
}

// -------------------------
// price_cache
// -------------------------
export type PriceCacheRow = {
  id: string
  symbol: string
  price: number
  updated_at: IsoDateTime
  [k: string]: unknown
}

export type PriceCacheInsert = {
  symbol: string
  price: number
}

export type PriceCacheUpdate = Partial<Pick<PriceCacheRow, 'price'>>

export const familyAccounts = createFinanceTableCrud<
  FamilyAccountRow,
  FamilyAccountInsert,
  FamilyAccountUpdate
>('family_accounts', {
  primaryKey: 'id',
  ownerColumn: 'user_id',
})

export const executedTrades = createFinanceTableCrud<
  ExecutedTradeRow,
  ExecutedTradeInsert,
  ExecutedTradeUpdate
>('executed_trades', {
  primaryKey: 'id',
  ownerColumn: 'user_id',
})

export const allocations = createFinanceTableCrud<
  AllocationRow,
  AllocationInsert,
  AllocationUpdate
>('allocations', {
  primaryKey: 'id',
  ownerColumn: 'user_id',
})

// price_cache is typically shared/global; do not scope to a single user unless your schema has user_id.
export const priceCache = createFinanceTableCrud<PriceCacheRow, PriceCacheInsert, PriceCacheUpdate>(
  'price_cache',
  {
    primaryKey: 'id',
    scopeToUser: false,
    setOwnerOnInsert: false,
  },
)
