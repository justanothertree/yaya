import { IDLE, type FightInput } from './fight'

/**
 * Two people running the same fight.
 *
 * ⚠️ NOBODY IS AUTHORITATIVE, AND NOTHING ABOUT THE FIGHT CROSSES THE WIRE. Both machines run the
 * identical simulation from the identical inputs, so all that travels is which buttons were down
 * on which frame. That is only possible because `stepFight` is a pure function of state and inputs
 * with a fixed timestep, using only exactly-specified arithmetic — checked bit-identical across
 * 20,000 frames before a line of this was written. The alternative, one player simulating and
 * telling the other what happened to them, gives the host an advantage you can feel and the guest
 * a character that argues with their own keyboard.
 *
 * ⚠️ DELAY, NOT PREDICTION. What you press takes effect a few frames later, for both of you
 * equally, and in exchange neither of you ever sees something happen and then un-happen. Rollback
 * hides the delay and costs a save-and-resimulate of every frame plus a rule for every piece of
 * state that must not be rolled back; it is the right next step if the delay is felt, and it needs
 * this to exist first either way.
 *
 * ⚠️ PURE, so a whole bout can be played out between two of these with no browser and no network —
 * which is how the stall, the catch-up and the desync check below were tested at all.
 */

/**
 * How far ahead of the simulation your inputs are sent.
 *
 * ⚠️ IT HAS TO COVER THE ROUND TRIP OR THE FIGHT STALLS EVERY FRAME. Four frames is 67ms, which
 * covers a relay round trip between friends in the same country with room to spare. Too low and
 * the fight stutters constantly; too high and the controls feel like wading. This is the one
 * number worth changing once two people have actually played.
 */
export const DELAY = 4

/** Six buttons, one number — the whole of what crosses the wire per frame. */
export const packInput = (i: FightInput): number =>
  (i.left ? 1 : 0) |
  (i.right ? 2 : 0) |
  (i.jump ? 4 : 0) |
  (i.down ? 8 : 0) |
  (i.quick ? 16 : 0) |
  (i.heavy ? 32 : 0)

export const readInput = (v: number): FightInput => ({
  left: !!(v & 1),
  right: !!(v & 2),
  jump: !!(v & 4),
  down: !!(v & 8),
  quick: !!(v & 16),
  heavy: !!(v & 32),
})

export type Tape = {
  /** frame number → the input that was pressed on it, for each seat */
  seen: Array<Map<number, number>>
  /** the next frame to simulate */
  at: number
  /** frames this side has queued up but not yet had answered */
  waiting: number
}

/**
 * ⚠️ THE FIRST `delay` FRAMES ARE BORN EMPTY-HANDED AND HAVE TO BE FILLED IN, or a bout deadlocks
 * before it starts. Each side queues its buttons for frame `at + DELAY`, so nobody ever sends
 * anything for frames 0 to DELAY-1 — and the rule is that nobody advances until every seat has
 * spoken for the frame. Watched it happen: two clients, 240,000 ticks, zero frames simulated, no
 * error anywhere, both of them perfectly in sync about nothing.
 *
 * Nobody is pressing anything in the first sixtieth of a second of a fight anyway, so the opening
 * frames are idle for everybody and the simulation starts at once.
 */
export const newTape = (seats = 2, delay = DELAY): Tape => {
  const seen = Array.from({ length: seats }, () => new Map<number, number>())
  for (const lane of seen) for (let n = 0; n < delay; n++) lane.set(n, 0)
  return { seen, at: 0, waiting: 0 }
}

/** Remember somebody's buttons for a frame. Late and duplicate arrivals are harmless. */
export function heard(tape: Tape, seat: number, frame: number, input: number): void {
  const lane = tape.seen[seat]
  if (!lane || frame < tape.at) return
  if (!lane.has(frame)) lane.set(frame, input & 63)
}

/**
 * Is every seat's input for the next frame in hand?
 *
 * ⚠️ THIS IS THE WHOLE OF THE LOCKSTEP RULE. Nobody advances until everybody has spoken for that
 * frame, which is why both screens always show the same fight and why a dropped connection shows
 * as a pause rather than as two diverging worlds.
 */
export const ready = (tape: Tape): boolean => tape.seen.every((lane) => lane.has(tape.at))

/** The inputs for the frame about to be simulated. */
export function take(tape: Tape): FightInput[] {
  const out = tape.seen.map((lane) => readInput(lane.get(tape.at) ?? 0))
  return out.length ? out : [IDLE, IDLE]
}

/**
 * Move past the frame just simulated, and forget it.
 *
 * ⚠️ FORGETTING MATTERS. A bout is minutes long at sixty frames a second; keeping every input
 * either way is a map that grows for the whole fight, for nothing — nobody re-simulates the past
 * without rollback, and rollback would keep a bounded window rather than all of it.
 */
export function advance(tape: Tape): void {
  for (const lane of tape.seen) lane.delete(tape.at)
  tape.at++
}

/**
 * How many frames to run this tick, given how much real time has passed.
 *
 * ⚠️ CAPPED, because a backgrounded tab hands you seconds at once and a fixed step turns that into
 * hundreds of frames in one go — which locks the page and, in a bout, fast-forwards one player
 * through a fight the other watched at normal speed. Dropping the excess is the honest answer.
 */
export const framesFor = (owed: number, cap: number): number => Math.min(Math.floor(owed), cap)

/**
 * Which seat is which, decided without asking anybody.
 *
 * ⚠️ BOTH SIDES MUST AGREE AND THERE IS NOBODY TO ARBITRATE. The relay has a host, but a host is
 * whoever arrived first and changes when they leave — so seats derived from it would swap
 * mid-bout. Sorting the two connection ids is a rule both machines can apply to the same two
 * strings and get the same answer, with no message and no race.
 */
export const seatOf = (me: string, them: string): number => (me < them ? 0 : 1)

/**
 * Is this bout stuck, and for how long?
 *
 * ⚠️ A STALL IS NORMAL AND A STALL IS ALSO HOW A DROPPED PLAYER LOOKS, and the two have to be told
 * apart by nothing but a clock. Below a second it is the network breathing and deserves no words;
 * past that it deserves saying, because a frozen fight with no explanation reads as the game
 * having crashed.
 */
export const STALL_SAYS = 1

/**
 * How long after a knockout the next round begins, in frames.
 *
 * ⚠️ A REMATCH NEEDS NO NEGOTIATION, because both machines already agree on the frame the round
 * ended — they agree on everything, that is the whole point of running the same simulation. So
 * "three seconds after that frame" is a fact each side works out alone and arrives at together,
 * with no message, no handshake and nothing to get out of step.
 *
 * ⚠️ AND WITHOUT IT, PRESSING AGAIN DEADLOCKED THE BOUT. A local reset put my tape back to frame
 * zero while the other side was still posting inputs for frame three thousand — so I sat waiting
 * for frame four, which nobody was ever going to send again, and the fight simply stopped. The
 * frame counter must never go backwards while a bout is connected; only the fighters reset.
 */
export const REMATCH_AFTER = 180
