/**
 * Whether the profile editor may start from what has been read of your page.
 *
 * ⚠️ THE EDITOR STARTS FROM ITS BLOCKS ONCE, WHEN IT MOUNTS, AND ITS SAVE REPLACES THE WHOLE PAGE.
 * `ProfileBlocksEditor` copies `initial` into its own state and `save_my_profile_blocks` deletes
 * every block and inserts what it is sent. So an editor that mounts on anything but your page as
 * the server holds it is a delete waiting for its first keystroke:
 *
 * - **Before the blocks have arrived.** Your own page opens straight into the editor when the
 *   profile answers, and the blocks are a separate request that starts as `[]`. When the profile
 *   answered first, the editor opened on an empty page with the starters showing, and the first
 *   starter picked or block added saved a page of only that.
 * - **When the read failed.** The blocks stayed `[]` for good, with the same result.
 * - **On a read that is not yours.** `get_profile_blocks` gives the owner an array of names in
 *   `certain` on every block (`[]` when there are none) and everybody else `null`. A read with a
 *   `null` there is a visitor's view: a name that changed hands between the two requests. Saved
 *   from, it would put somebody else's blocks on your page.
 *
 * Pure, so the rule can be asked without a page (seedGate.test.ts).
 */

/** A read of `get_profile_blocks`, as the client gets it back. */
export type BlocksRead = { data: unknown; error: unknown }

/**
 * Whether an empty page is yours, from `get_member_profile` asked AFTER the empty read — so a name
 * that stopped being yours in between answers no. `is_me` is worked out from the session making
 * the call, so it also says no after the account was switched in another tab.
 */
export function proveEmpty(answer: {
  data: unknown
  error: unknown
}): 'yours' | 'not-yours' | 'failed' {
  if (answer.error) return 'failed'
  const d = answer.data as { is_me?: unknown } | null
  return d && typeof d === 'object' && d.is_me === true ? 'yours' : 'not-yours'
}

/** What stands where the editor goes on your own page. */
export type Door = 'editor' | 'opening' | 'failed' | 'not-yours' | 'not-you'

/**
 * The editor, or what stands in its place until it may open.
 *
 * @param u the page being shown
 * @param seededFor whose page the last good read was of — null while one is on its way
 * @param refused whose page the last read failed for, and why
 */
export function doorFor(
  u: string,
  seededFor: string | null,
  refused: { for: string; why: 'failed' | 'not-yours' | 'not-you' } | null,
): Door {
  if (seededFor === u) return 'editor'
  if (refused && refused.for === u) return refused.why
  return 'opening'
}
