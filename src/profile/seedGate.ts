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

export type Seed<B> = { ok: true; blocks: B[] } | { ok: false; why: 'failed' | 'not-yours' }

/**
 * The blocks the editor may start from, or why it may not.
 *
 * ⚠️ AN EMPTY PAGE IS ACCEPTED ON THE PROFILE'S WORD. `[]` carries no `certain` to prove whose it
 * is, and the server answers `[]` for a name nobody has; the caller only asks this for a page the
 * profile request just said is yours (`is_me`), from the same navigation.
 */
export function seedFrom<B>(read: BlocksRead): Seed<B> {
  if (read.error || !Array.isArray(read.data)) return { ok: false, why: 'failed' }
  for (const b of read.data as unknown[]) {
    if (!b || typeof b !== 'object' || !Array.isArray((b as { certain?: unknown }).certain))
      return { ok: false, why: 'not-yours' }
  }
  return { ok: true, blocks: read.data as B[] }
}

/** What stands where the editor goes on your own page. */
export type Door = 'editor' | 'opening' | 'failed' | 'not-yours'

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
  refused: { for: string; why: 'failed' | 'not-yours' } | null,
): Door {
  if (seededFor === u) return 'editor'
  if (refused && refused.for === u) return refused.why
  return 'opening'
}
