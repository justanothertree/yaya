import type { PostgrestError } from '@supabase/supabase-js'

export function assertOk<T>(result: { data: T; error: PostgrestError | null }): T {
  if (result.error) throw result.error
  return result.data
}
