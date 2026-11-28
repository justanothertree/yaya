/**
 * What a `visibility_certain_get` reply says, and whether a tap may change the list.
 *
 * ⚠️ A FAILED READ IS NOT "NOBODY CHOSEN", AND THE DIFFERENCE IS A DELETE. supabase-js answers a
 * network blip, a timeout or a refusal with `data: null` rather than throwing, and this picker
 * used to read that null as an empty list. Two things followed, both found by the 27 Nov 2026
 * audit (docs/2026-11-27-supabase-failure-audit.md): the owner was told "only you" about an item
 * their friends can see, and the next tap ran `visibility_certain_set` — which deletes the item's
 * whole list and inserts exactly what it is sent — so one tap on one friend took the thing away
 * from everybody else on it.
 *
 * Its own module so `CertainChooser.tsx` only exports components, and so this can be asked.
 */

/** the list the server holds for one item, or the admission that we do not know it */
export type CertainRead = { ok: true; names: string[] } | { ok: false }

/**
 * A list only when the server sent one. `visibility_certain_get` always answers an array on
 * success — `coalesce(..., '[]'::jsonb)` — so a null with no error did not come from it either.
 */
export function readCertain(reply: { data: unknown; error: unknown }): CertainRead {
  if (reply.error || !Array.isArray(reply.data)) return { ok: false }
  return { ok: true, names: (reply.data as { username: string }[]).map((r) => r.username) }
}

/**
 * May a tap change the list? Only one the server has told us — `null` is a read still in flight —
 * because the tap is sent as the WHOLE list, and a list we do not know is a list we would erase.
 */
export function mayChangeCertain(read: CertainRead | null): boolean {
  return read !== null && read.ok
}
