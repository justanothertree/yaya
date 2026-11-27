import type { Finished } from './room'

/**
 * The last game finished at a call table in this browser, as useLabRoom saw it finish
 * (room.ts's finishedOf) — the party tour reads it to report a stop's game (bus.ts).
 *
 * A store rather than a callback because the toy's room and the tour live in different parts of
 * the page: the room is inside whichever toy is mounted, the tour is in the strip above it. Every
 * listener hears every game, in order, at the moment it finishes; nothing is kept beyond the last,
 * and nothing is stored — the same game is never told twice, because finishedOf fires once.
 */
let last: Finished | null = null
const listeners = new Set<() => void>()

export const gameOver = {
  get: (): Finished | null => last,
  tell(f: Finished) {
    last = f
    listeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
