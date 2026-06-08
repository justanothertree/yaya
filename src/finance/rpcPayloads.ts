/**
 * Finance RPC payload shapes for Supabase `rpc(...)` calls.
 *
 * This module is intended to be the single, authoritative TypeScript contract for the
 * JSON `payload` consumed by the public RPCs defined in `docs/supabase-rpcs.sql`.
 *
 * Canonical vs Accepted:
 * - `...PayloadCanonical` is the recommended shape to construct in the frontend.
 *   It uses the canonical SQL-backed keys and makes defaults/optional fields obvious.
 * - `...PayloadAccepted` matches what the SQL currently accepts.
 *
 * Guardrails:
 * - Never send `user_id` in JSON payloads. Ownership is derived from `auth.uid()` in SQL.
 *
 * Wiring guidance (compile-time safety):
 * - Always construct a `payload` object and apply `satisfies ...PayloadCanonical`.
 * - Then pass it into `sb.rpc('fn', { payload })`.
 *
 * Example:
 *   const payload = { display_name: 'Brokerage' } satisfies InsertFamilyAccountPayloadCanonical
 *   await sb.rpc('insert_family_account', { payload })
 */

export type Uuid = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]

/**
 * Disallow keys that must not appear inside the JSON `payload`.
 *
 * Why:
 * - `user_id` is set by SQL using `uid`/`target_uid`.
 * - `uid`/`target_uid` are RPC args, not payload keys.
 */
export type ForbidServerAssignedFields = {
  user_id?: never
}

/** Alias mapping table for quick reference (aliases -> canonical). */
export const RPC_PAYLOAD_ALIASES = {
  // Currently no payload aliases are supported by the finance insert RPCs.
} as const

// -----------------------------------------------------
// insert_family_account(payload)
// -----------------------------------------------------

/**
 * One-line: required `display_name` (trimmed, non-empty).
 *
 * Summary (SQL):
 * - Required: `display_name`
 * - Defaults: none
 *
 * Exact RPC call signature:
 *   sb.rpc('insert_family_account', { payload })
 */

export type InsertFamilyAccountPayloadCanonical = ForbidServerAssignedFields & {
  display_name: string
}

/** What the SQL accepts today (no aliases). */
export type InsertFamilyAccountPayloadAccepted = InsertFamilyAccountPayloadCanonical

export type InsertFamilyAccountRpcArgs = {
  payload: InsertFamilyAccountPayloadAccepted
}

/** Same call signature as SQL, but requires canonical payload keys. */
export type InsertFamilyAccountRpcArgsCanonical = {
  payload: InsertFamilyAccountPayloadCanonical
}

// -----------------------------------------------------
// insert_allocation(payload)
// -----------------------------------------------------

/**
 * One-line: required `family_account_id`, `executed_trade_id`, `units_allocated` (> 0).
 *
 * Summary (SQL):
 * - Required: `family_account_id` uuid
 * - Required: `executed_trade_id` uuid
 * - Required: `units_allocated` numeric > 0
 *
 * Exact RPC call signature:
 *   sb.rpc('insert_allocation', { payload })
 */

export type InsertAllocationPayloadCanonical = ForbidServerAssignedFields & {
  family_account_id: Uuid
  executed_trade_id: Uuid
  units_allocated: number | string
}

/** What the SQL accepts today (no aliases). */
export type InsertAllocationPayloadAccepted = InsertAllocationPayloadCanonical

export type InsertAllocationRpcArgs = {
  payload: InsertAllocationPayloadAccepted
}

/** Same call signature as SQL, but requires canonical payload keys. */
export type InsertAllocationRpcArgsCanonical = {
  payload: InsertAllocationPayloadCanonical
}

// -----------------------------------------------------
// insert_executed_trade(payload)
// -----------------------------------------------------

/**
 * One-line: required `asset_symbol`, `price` (> 0), `units_acquired` (> 0); optional `asset_type`, `platform`, `execution_time` (default now), `fee` (default 0), `dollar_amount` (default computed).
 *
 * Summary (SQL):
 * - Required: `asset_symbol`
 * - Required: `price` numeric > 0
 * - Required: `units_acquired` numeric > 0
 * - Optional: `asset_type`
 * - Optional: `platform`
 * - Optional: `execution_time` (defaults to now)
 * - Optional: `fee` (defaults to 0)
 * - Optional: `dollar_amount` (defaults to `(price * units_acquired) + fee`)
 *
 * Exact RPC call signature:
 *   sb.rpc('insert_executed_trade', { payload })
 */

export type InsertExecutedTradePayloadCanonical = ForbidServerAssignedFields & {
  asset_symbol: string
  asset_type?: string
  platform?: string
  /** Optional: defaults to `now()` if missing/empty */
  execution_time?: string
  dollar_amount?: number | string
  price: number | string
  units_acquired: number | string
  fee?: number | string
}

/** What the SQL accepts today (no aliases). */
export type InsertExecutedTradePayloadAccepted = InsertExecutedTradePayloadCanonical

export type InsertExecutedTradeRpcArgs = {
  payload: InsertExecutedTradePayloadAccepted
}

/** Same call signature as SQL, but requires canonical payload keys. */
export type InsertExecutedTradeRpcArgsCanonical = {
  payload: InsertExecutedTradePayloadCanonical
}

// -----------------------------------------------------
// insert_trade_even_split(payload)
// -----------------------------------------------------

/**
 * One-line: inserts an executed trade and auto-creates even-split allocations across all family accounts.
 *
 * Summary (SQL):
 * - Required: `asset_symbol`
 * - Required: `price` numeric > 0
 * - Required: `units_acquired` numeric > 0
 * - Optional: `asset_type`
 * - Optional: `platform`
 * - Optional: `execution_time` (defaults to now)
 * - Optional: `fee` (defaults to 0)
 * - Optional: `dollar_amount` (defaults to `(price * units_acquired) + fee`)
 */
export type InsertTradeEvenSplitPayloadCanonical = ForbidServerAssignedFields & {
  asset_symbol: string
  asset_type?: string
  platform?: string
  execution_time?: string
  dollar_amount?: number | string
  price: number | string
  units_acquired: number | string
  fee?: number | string
}

export type InsertTradeEvenSplitPayloadAccepted = InsertTradeEvenSplitPayloadCanonical

export type InsertTradeEvenSplitRpcArgs = {
  payload: InsertTradeEvenSplitPayloadAccepted
}

export type InsertTradeEvenSplitRpcArgsCanonical = {
  payload: InsertTradeEvenSplitPayloadCanonical
}

// -----------------------------------------------------
// schedule_trade_even_split(payload)
// -----------------------------------------------------

/**
 * One-line: queues an even-split trade for future execution.
 *
 * Summary (SQL):
 * - All fields from `insert_trade_even_split(payload)`
 * - Required: `schedule_at` (ISO date/time)
 */
export type ScheduleTradeEvenSplitPayloadCanonical = InsertTradeEvenSplitPayloadCanonical & {
  schedule_at: string
}

export type ScheduleTradeEvenSplitPayloadAccepted = ScheduleTradeEvenSplitPayloadCanonical

export type ScheduleTradeEvenSplitRpcArgs = {
  payload: ScheduleTradeEvenSplitPayloadAccepted
}

export type ScheduleTradeEvenSplitRpcArgsCanonical = {
  payload: ScheduleTradeEvenSplitPayloadCanonical
}

// -----------------------------------------------------
// run_due_scheduled_trades(limit_count)
// -----------------------------------------------------

export type RunDueScheduledTradesRpcArgs = {
  limit_count?: number
}
