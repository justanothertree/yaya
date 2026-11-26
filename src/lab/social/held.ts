/**
 * The toy on which you hold a seat in an unfinished call-table game, if any: useLabRoom says so,
 * and the tour's Follow reads it, because a follow move remounts the toy and would throw the seat
 * and the game away (docs/2026-11-22-lab-tour.md). A seat at a game that is over, or not yet begun,
 * is not held — moving on from one costs nothing.
 */
let held: string | null = null
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())

export const heldSeat = {
  get: (): string | null => held,
  set(sub: string) {
    if (held === sub) return
    held = sub
    tell()
  },
  /** only the toy that set it can clear it, so a toy unmounting late cannot clear its successor's */
  clear(sub: string) {
    if (held !== sub) return
    held = null
    tell()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
