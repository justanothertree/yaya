import type { BusButton, Line, View } from './busWords'
import type { Place } from './tour'

/**
 * The party tour as this browser shows it now, and the one way to press any of its buttons — a
 * store in held.ts's shape, so what is drawn away from the strip can read the bus without
 * re-rendering the Lab round it: the line above the toy (BusLine) and the stars on the chips
 * (steps 6 and 7 of the plan), and a second Lab mounted at once, which draws from this and never
 * drives (useBus's owner token).
 *
 * useBus writes it, and only the Lab that drives the bus. Nothing here is sent or stored.
 */

/** a hop that did not move you, offered instead (bus.ts's rideStep and hopPlan) */
export type Offer = {
  /** the departure it is about, `tour:n` */
  key: string
  toy: string
  why: 'seat' | 'match' | 'away' | 'late' | 'unopenable'
}

/** one rider on the scoreboard (busWords's riderWords), with where their token stands */
export type RiderEntry = {
  id: string
  name: string
  stars: string
  starsSr: string
  rolls: string
  rollsSr: string
  note: string
  lead: boolean
  place: Place
  me: boolean
}

/** a face of the roll: a button for the guide, a card for everybody else */
export type FaceEntry = {
  toy: string
  name: string
  kind: string
  star: string
  press: BusButton | null
}

/** everything the panel draws, already in words */
export type BusModel = {
  view: View
  /** "🚌 Party tour · 5 stops" */
  heading: string
  /** what is happening and what you can do: the phase line, or an offer, or the hop itself */
  line: Line
  /** the same, as a phone's one row says it */
  row: string
  faces: FaceEntry[] | null
  riders: RiderEntry[]
  /** the big 3-2-1 before your own hop, or null */
  count: number | null
  /** a request in flight, whose button reads "Rolling…" or "Going…" for at most 3 s */
  pending: 'roll' | 'go' | null
  /** you are on the bus, on a tour that has not ended: 🎲 Surprise us gives way to the bus's 🎲 */
  riding: boolean
  /** the finale closed here, until the next state */
  closed: boolean
}

export type BusNow = {
  /** null while there is nothing to draw: no tour held, or not listening */
  model: BusModel | null
  /** may you start one: listened long enough, live, and no live tour to find */
  canStart: boolean
  act: (b: BusButton) => void
}

const IDLE: BusNow = { model: null, canStart: false, act: () => {} }
let now: BusNow = IDLE
const listeners = new Set<() => void>()

export const busNow = {
  get: (): BusNow => now,
  set(next: BusNow) {
    if (next.model === now.model && next.canStart === now.canStart && next.act === now.act) return
    now = next
    listeners.forEach((l) => l())
  },
  clear() {
    busNow.set(IDLE)
  },
  /** press one of the bus's buttons, as whichever Lab drives it */
  act: (b: BusButton) => now.act(b),
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
