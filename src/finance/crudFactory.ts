import type { SupabaseClient } from '@supabase/supabase-js'
import { getFinanceClient } from './client'
import { requireUser } from './auth'

export type CrudOptions = {
  /**
   * Primary key column used by update/delete helpers.
   * Must match your table schema.
   */
  primaryKey?: string

  /**
   * Optional owner column for per-user scoping (commonly `user_id`).
   * When provided, helpers can add `eq(ownerColumn, authUserId)` as a
   * defense-in-depth filter in addition to RLS.
   */
  ownerColumn?: string

  /**
   * If true and `ownerColumn` is set, list/get/update/delete will add an
   * explicit owner filter. This should match your RLS policy condition.
   *
   * Default: true when ownerColumn is provided.
   */
  scopeToUser?: boolean

  /**
   * If true and `ownerColumn` is set, insert() will automatically set
   * `{ [ownerColumn]: authUserId }` unless the caller already provided a value.
   *
   * Default: true when ownerColumn is provided.
   */
  setOwnerOnInsert?: boolean
}

/**
 * Generic CRUD builder for a table in the `finance` schema.
 *
 * Security model:
 * - Uses the anon key in the browser.
 * - Requires an authenticated session before every operation.
 * - Relies on Supabase RLS policies to ensure user-specific access (auth.uid()).
 *
 * IMPORTANT: Do not add “service role” keys in the frontend. That would bypass RLS.
 */
export function createFinanceTableCrud<TRow extends Record<string, unknown>, TInsert, TUpdate>(
  table: string,
  options: CrudOptions = {},
) {
  const pk = options.primaryKey ?? 'id'
  const ownerColumn = options.ownerColumn
  const scopeToUser = options.scopeToUser ?? !!ownerColumn
  const setOwnerOnInsert = options.setOwnerOnInsert ?? !!ownerColumn

  function client(): SupabaseClient {
    return getFinanceClient()
  }

  return {
    table,

    async list(params?: {
      limit?: number
      orderBy?: string
      ascending?: boolean
    }): Promise<TRow[]> {
      const user = await requireUser()
      const { limit = 100, orderBy = pk, ascending = false } = params || {}
      let q = client().from(table).select('*').order(orderBy, { ascending }).limit(limit)
      if (ownerColumn && scopeToUser) q = q.eq(ownerColumn, user.id)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as TRow[]
    },

    async getById(id: string | number, params?: { select?: string }): Promise<TRow | null> {
      const user = await requireUser()
      const sel = params?.select ?? '*'
      let q = client().from(table).select(sel).eq(pk, id)
      if (ownerColumn && scopeToUser) q = q.eq(ownerColumn, user.id)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as TRow | null
    },

    async insert(row: TInsert, params?: { returning?: string }): Promise<TRow> {
      const user = await requireUser()
      const returning = params?.returning ?? '*'
      const toInsert: Record<string, unknown> = {
        ...(row as unknown as Record<string, unknown>),
      }
      if (ownerColumn && setOwnerOnInsert && toInsert[ownerColumn] == null) {
        toInsert[ownerColumn] = user.id
      }
      const { data, error } = await client()
        .from(table)
        .insert(toInsert as never)
        .select(returning)
        .single()
      if (error) throw error
      return data as unknown as TRow
    },

    async updateById(
      id: string | number,
      patch: TUpdate,
      params?: { returning?: string },
    ): Promise<TRow> {
      const user = await requireUser()
      const returning = params?.returning ?? '*'
      let q = client()
        .from(table)
        .update(patch as never)
        .eq(pk, id)
      if (ownerColumn && scopeToUser) q = q.eq(ownerColumn, user.id)
      const { data, error } = await q.select(returning).single()
      if (error) throw error
      return data as unknown as TRow
    },

    async deleteById(id: string | number): Promise<void> {
      const user = await requireUser()
      let q = client().from(table).delete().eq(pk, id)
      if (ownerColumn && scopeToUser) q = q.eq(ownerColumn, user.id)
      const { error } = await q
      if (error) throw error
    },
  }
}
