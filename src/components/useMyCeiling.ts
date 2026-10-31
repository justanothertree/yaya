import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import type { VisibilityTier } from '../circuit/types'

/**
 * The widest level this account is allowed to choose.
 *
 * The ladder is capped per account: only Evan's can choose Anyone, every other adult stops at
 * "anyone with an account", and an account whose age band is unknown or minor stops at Friends.
 * `visibility_ceiling()` on the server is the one authority, and `clamp_visibility` applies it
 * to every write — so nothing here is a security boundary. It exists so the CONTROL agrees with
 * the outcome.
 *
 * ⚠️ WITHOUT THIS, CLAMPING SILENTLY IS A LIE RATHER THAN A SAFETY NET. Every setter narrows a
 * tier above the ceiling without comment, which is correct: refusing would make the profile
 * editor's own default value unsaveable for a brand-new member. But a picker that offers a level
 * the server will quietly narrow lets somebody choose "Anyone", get told it saved, and be wrong
 * about who can see their page. A control that only ever offers reachable levels never has to
 * narrow anything, which is the half that makes the other half honest.
 *
 * Cached for the session: the answer changes only when Evan marks an age band or grants admin,
 * neither of which happens while somebody is looking at a picker. The cache is a plain
 * module-level `let` with no call at module scope, so this file holds no side effect for rollup
 * to keep.
 */
export type Ceiling =
  /** the answer is in */
  | { tier: VisibilityTier; failed: false }
  /** asked and did not get one — NOT the same as not having asked */
  | { tier: undefined; failed: true }
  /** still asking */
  | { tier: undefined; failed: false }

let cached: VisibilityTier | undefined
let inFlight: Promise<VisibilityTier | undefined> | undefined

async function fetchCeiling(): Promise<VisibilityTier | undefined> {
  try {
    const { data, error } = await getSupabaseClient().rpc('my_visibility_ceiling')
    if (error || typeof data !== 'string') return undefined
    return data as VisibilityTier
  } catch {
    return undefined
  }
}

/**
 * ⚠️ A FAILED LOOKUP AND AN UNFINISHED ONE MUST NOT LOOK THE SAME, which is why this returns a
 * shape rather than `VisibilityTier | undefined`. The first version returned the bare union, and
 * a lookup that never answered was indistinguishable from one still in flight — so a picker
 * holding its options disabled "briefly" would have held them disabled for ever. A dead privacy
 * control, on exactly the surface where somebody is trying to shut something off.
 *
 * ⚠️ AND A FAILURE MUST NOT FALL BACK TO OFFERING EVERYTHING. That is the tempting fix, and the
 * argument for it is true as far as it goes: `clamp_visibility` runs on every write, so an
 * over-generous picker cannot actually over-share. But the whole point of knowing the ceiling is
 * that a control should not offer a level the server will quietly narrow — falling back to the
 * full ladder reinstates precisely the lie this exists to remove, and does it on a bad network
 * where nobody is watching. So a failure says so and offers nothing new.
 *
 * ⚠️ IN THE PREVIEW HARNESS IT RESOLVES TO `public`, AND THAT IS NOT A GUESS AT A REAL CEILING.
 * `previewMember` has no session, so the RPC answers nothing; inventing a plausible ceiling there
 * would be the preview harness quietly disagreeing with the site, which is how a workbench
 * reports a feature works when it does not. Offering everything is the visibly-unreal answer.
 *
 * Cached for the session: the answer changes only when Evan marks an age band or grants admin.
 */
export function useMyCeiling(): Ceiling {
  const [state, setState] = useState<Ceiling>(() =>
    previewMember
      ? { tier: 'public', failed: false }
      : cached
        ? { tier: cached, failed: false }
        : { tier: undefined, failed: false },
  )

  useEffect(() => {
    if (previewMember || cached) return
    let alive = true
    inFlight ??= fetchCeiling()
    void inFlight.then((t) => {
      if (t) cached = t
      if (!alive) return
      setState(t ? { tier: t, failed: false } : { tier: undefined, failed: true })
    })
    return () => {
      alive = false
    }
  }, [])

  return state
}
