/**
 * The three things the navigation needs to know about a signed-in member — admin, Investments,
 * paused — and what the browser remembers of them so the next visit can paint before it asks.
 *
 * ⚠️ A CHECK THAT FAILED IS NOT AN ANSWER, AND IT USED TO BE THREE OF THEM. supabase-js does not
 * throw: a dropped connection, a 5xx, a timeout and an abort all RESOLVE, as `{ data: null,
 * error }`. App.tsx read only `data`, so a blip during `is_admin` was "not an admin", during
 * `my_features` was "Investments is off" (and bounced a member off #investments), and during
 * `my_account` was "not paused" — over a cached true, which opened a paused member's UI back up.
 * All three were then STORED, so the next visit painted the wrong answer too.
 *
 * So a failure here changes nothing at all: not the screen, not the stored flags. The checks are
 * asked again on every sign-in event (including each token refresh), which is the existing
 * re-ask; the server still decides what anyone may actually do either way.
 */

export type NavFlags = { uid: string; admin: boolean; finance: boolean; suspended: boolean }
export type FlagKey = 'admin' | 'finance' | 'suspended'
/** What a supabase-js rpc resolves to — it never throws, so a failure arrives as `error`. */
export type CheckAnswer = { data: unknown; error: unknown }

export const NAV_FLAGS_KEY = 'nav_flags_v1'

export function readNavFlags(uid: string): NavFlags | null {
  try {
    const f = JSON.parse(localStorage.getItem(NAV_FLAGS_KEY) || 'null') as NavFlags | null
    return f && f.uid === uid ? f : null
  } catch {
    return null
  }
}

export function storeNavFlags(flags: NavFlags): void {
  try {
    localStorage.setItem(NAV_FLAGS_KEY, JSON.stringify(flags))
  } catch {
    /* ignore */
  }
}

/**
 * What one check says, or null when it did not say anything.
 *
 * ⚠️ The SHAPE is checked as well as the error: is_admin answers yes or no, the other two answer
 * with rows. Anything else is not a reply this code knows how to read, and guessing from it is
 * the bug above with a different cause.
 */
function answerOf(key: FlagKey, res: CheckAnswer): boolean | null {
  if (res.error) return null
  if (key === 'admin') return typeof res.data === 'boolean' ? res.data : null
  if (!Array.isArray(res.data)) return null
  if (key === 'finance') {
    const rows = res.data as { feature?: unknown; enabled?: unknown }[]
    return rows.some((f) => f?.feature === 'finance' && f?.enabled === true)
  }
  /* no account row is not a pause — the answer this always gave */
  return (res.data as { suspended?: unknown }[])[0]?.suspended === true
}

/**
 * One check's answer, applied: the value to show and the flags to store — or null, meaning the
 * check did not answer and the caller must change nothing, on screen or in storage.
 */
export function settleNavFlag(
  stored: NavFlags | null,
  uid: string,
  key: FlagKey,
  res: CheckAnswer,
): { value: boolean; flags: NavFlags } | null {
  const value = answerOf(key, res)
  if (value === null) return null
  const cur =
    stored && stored.uid === uid ? stored : { uid, admin: false, finance: false, suspended: false }
  return { value, flags: { ...cur, [key]: value } }
}
