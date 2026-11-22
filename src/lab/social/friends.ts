import { getSupabaseClient } from '../../finance/client'

/**
 * Your accepted friends' user ids — the one fact the Lab's friends-only rule needs that a call
 * does not carry (a call knows ids; list_friends knows usernames).
 *
 * ⚠️ FROM list_member_directory's `is_friend`, which is `are_friends()`: accepted only, never a
 * pending request. No SQL was added for this — the directory already returns ids for exactly
 * the people presence may reach, and a friend is always among them.
 *
 * ⚠️ `undefined` MEANS UNKNOWN, NEVER "NO FRIENDS". Not signed in, offline, or the call failed:
 * the gate refuses on undefined (friends-unknown), so a failed load can only stop sharing.
 */
let known: Set<string> | undefined
let override: (() => Set<string>) | null = null

export async function refreshFriendIds(): Promise<Set<string> | undefined> {
  if (override) return (known = override())
  try {
    const { data, error } = await getSupabaseClient().rpc('list_member_directory')
    if (error || !Array.isArray(data)) return (known = undefined)
    known = new Set(
      (data as { user_id?: unknown; is_friend?: unknown }[])
        .filter((r) => r.is_friend === true && typeof r.user_id === 'string')
        .map((r) => r.user_id as string),
    )
  } catch {
    known = undefined
  }
  return known
}

export const friendIdsNow = () => (override ? override() : known)

/** ⚠️ DEV ONLY — the two-tab call (src/dev/labCall.ts) says who counts as a friend. */
export function devFriends(fn: () => Set<string>) {
  if (import.meta.env.DEV) override = fn
}
