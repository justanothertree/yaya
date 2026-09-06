/**
 * Which room each person in your call is standing in, ready to hang off a nav link.
 *
 * ⚠️ THE ROOMS WERE ALREADY BROADCASTING THIS AND NOTHING SHOWED IT. Every pointer sample has
 * carried a `route` since the day co-presence shipped, purely so a cursor is not drawn for
 * someone reading a different page. The fact of where everyone is was on the wire the whole
 * time, one field away from being useful, and the site threw it away.
 *
 * ⚠️ A RING, NOT A BADGE, and the reason is the nav strip's own CSS. `.nav-links` is
 * `overflow-x: auto`, which forces `overflow-y: auto` with it — so anything absolutely
 * positioned that pokes above or beside a link is clipped at the strip's edge and simply never
 * appears. (The cog sits outside the strip for exactly this reason; there is a comment about it
 * in index.css.) An inset box-shadow lives entirely inside the link's own box, cannot be
 * clipped, and costs no layout — the strip does not reflow and nothing shifts when a friend
 * walks into a room.
 *
 * ⚠️ Their own colour, the one they already are. hueFor is what paints their cursor, their notes
 * on the keyboard and their name in the roster, so the green ring round Paint belongs to the
 * same person as the green cursor you just watched leave this page.
 */
import { useSyncExternalStore } from 'react'
import { hueFor, party, type PartyHere } from './party'

/** Everyone in the call, grouped by the room they are in. Empty unless you are sharing too. */
export function usePartyHere(): Record<string, PartyHere[]> {
  const state = useSyncExternalStore(party.subscribe, party.getState, party.getState)
  const by: Record<string, PartyHere[]> = {}
  if (!state.sharing) return by
  // stable order, so two people in one room do not swap rings on every heartbeat
  for (const p of Object.values(state.here).sort((a, b) => a.id.localeCompare(b.id))) {
    ;(by[p.route] ||= []).push(p)
  }
  return by
}

/**
 * The ring, or nothing at all.
 *
 * ⚠️ Two rings maximum. A third would need a 4.5px inset against 4.8px of vertical padding on a
 * nav link — it would sit on the text. Everyone is named in the tooltip regardless, so the cap
 * costs a colour, not the information.
 */
export function occupancy(people: PartyHere[] | undefined): {
  style: { boxShadow: string }
  title: string
  label: string
} | null {
  if (!people || !people.length) return null
  const rings = people
    .slice(0, 2)
    .map((p, i) => `inset 0 0 0 ${1.5 + i * 1.5}px hsl(${hueFor(p.id)} 75% 55% / 0.95)`)
  const names = people.map((p) => p.name)
  const who =
    names.length === 1
      ? names[0]
      : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
  return {
    style: { boxShadow: rings.join(', ') },
    title: `${who} ${names.length === 1 ? 'is' : 'are'} here`,
    label: `${who} ${names.length === 1 ? 'is' : 'are'} in this room`,
  }
}
