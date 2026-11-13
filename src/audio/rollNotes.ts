import type { Note } from './noteEdit'

/**
 * The note editor's collision rules — whether a note runs into another of its pitch, how long it
 * may grow, and which note a selection names — moved out of PianoRoll.tsx unchanged on
 * 11 Nov 2026 so they can be asked a question without a browser.
 */

/** Two notes never share a pitch and a start, so this identifies one exactly. */
export const isSame = (n: Note, sel: { midi: number; t: number } | null) =>
  !!sel && n.midi === sel.midi && Math.abs(n.t - sel.t) < 1e-6

/** Does this note run into another of the same pitch? */
export function hits(list: Note[], self: number, n: Note): boolean {
  return list.some(
    (o, i) =>
      i !== self && o.midi === n.midi && n.t < o.t + o.dur - 1e-6 && n.t + n.dur > o.t + 1e-6,
  )
}

/** How long this note may be before it would touch the next one of the same pitch. */
export function roomAfter(list: Note[], self: number, n: Note): number {
  let limit = Infinity
  for (let i = 0; i < list.length; i++) {
    const o = list[i]
    if (i === self || o.midi !== n.midi || o.t <= n.t) continue
    limit = Math.min(limit, o.t - n.t)
  }
  return limit
}
