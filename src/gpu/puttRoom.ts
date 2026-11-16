import { COURSE, LEVELS, PICK_UP, roll, stroke, type Level, type Pt, type Roll } from './putt'
import type { Rules } from '../lab/social/room'

/**
 * Putt as a room game (src/lab/social/room.ts), on the toy's own course. Each hole, seat 0 putts
 * out and then seat 1, as you and the computer do alone; the lower total over the round wins.
 * Together, the two seats take their ball's putts in turn and the computer plays the other ball,
 * putt by putt, with putt.ts's own `stroke`.
 *
 * A move is a putt — a direction and a strength — and where it rolls is not the putter's to say:
 * the host rolls it through putt.ts's `roll` from where that ball lies. A hole ends for a ball when
 * it drops, or at PICK_UP strokes, the toy's own rule; water costs a stroke and plays again from
 * the same spot, as it does alone.
 *
 * THE GAME TRAVELS AS ITS PUTTS, replayed on every seat, so the scorecard can only say what those
 * putts did.
 */
export type Side = 0 | 1
export type Putt = { angle: number; power: number }
export type PuttGame = {
  putts: Putt[]
  /** the hole being played; COURSE.length once the round is over */
  hole: number
  /** whose ball is to play, or null once the round is over */
  up: Side | null
  /** where that ball lies, and the strokes it has taken on this hole */
  at: Pt
  strokes: number
  /** each hole's score for each side, null until that side has holed out */
  card: [number | null, number | null][]
  /** the last putt — who, where from, how it rolled, what it made the hole — for showing it */
  last: { by: Side; hole: number; from: Pt; roll: Roll; strokes: number; out: boolean } | null
}

/** far more putts than a round takes: every ball picked up on every hole */
export const MAX_PUTTS = COURSE.length * 2 * PICK_UP

const fresh = (): PuttGame => ({
  putts: [],
  hole: 0,
  up: 0,
  at: { ...COURSE[0].tee },
  strokes: 0,
  card: COURSE.map(() => [null, null]),
  last: null,
})

function play(g: PuttGame, p: Putt, keep = true): PuttGame {
  const by = g.up!
  const h = COURSE[g.hole]
  const r = roll(h, g.at, p.angle, p.power, keep)
  const n = g.strokes + (r.wet ? 2 : 1)
  const out = r.sunk || n >= PICK_UP
  const last = { by, hole: g.hole, from: g.at, roll: r, strokes: Math.min(n, PICK_UP), out }
  if (!out) return { ...g, putts: [...g.putts, p], at: r.end, strokes: n, last }
  const card = g.card.map((c, i) =>
    i === g.hole
      ? ((by === 0 ? [last.strokes, c[1]] : [c[0], last.strokes]) as PuttGame['card'][number])
      : c,
  )
  // the other ball plays the same hole; after both, the next hole, seat 0 first again
  const hole = by === 0 ? g.hole : g.hole + 1
  const up: Side | null = by === 0 ? 1 : hole < COURSE.length ? 0 : null
  return {
    putts: [...g.putts, p],
    hole,
    up,
    at: up === null ? { ...COURSE[COURSE.length - 1].cup } : { ...COURSE[hole].tee },
    strokes: 0,
    card,
    last,
  }
}

/** a putt from the wire or the room, inside what any putter here could send; null otherwise */
export function readPutt(x: unknown): Putt | null {
  const [angle, power] = Array.isArray(x)
    ? x
    : [(x as Partial<Putt> | null)?.angle, (x as Partial<Putt> | null)?.power]
  if (typeof angle !== 'number' || typeof power !== 'number') return null
  if (!(Math.abs(angle) <= 10 && power > 0 && power <= 1)) return null
  return { angle, power }
}

/** the round these putts make, or null at the first that is not a putt there */
export function replay(putts: readonly unknown[]): PuttGame | null {
  if (putts.length > MAX_PUTTS) return null
  let g = fresh()
  for (let i = 0; i < putts.length; i++) {
    const p = readPutt(putts[i])
    if (!p || g.up === null) return null
    // only the last putt's roll is shown, so only the last is kept
    g = play(g, p, i === putts.length - 1)
  }
  return g
}

export const totals = (g: PuttGame): [number, number] =>
  g.card.reduce<[number, number]>((t, c) => [t[0] + (c[0] ?? 0), t[1] + (c[1] ?? 0)], [0, 0])

export const puttRules: Rules<PuttGame, Putt> = {
  fresh,
  turn: (g) => g.up,
  legal: (g, p, by) => g.up !== null && (by === undefined || by === g.up) && readPutt(p) !== null,
  apply: (g, p) => play(g, p),
  encode: (g) => ({ putts: g.putts.map((p) => [p.angle, p.power]) }),
  decode: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !Array.isArray(o.putts)) return null
    return replay(o.putts)
  },
  readMove: readPutt,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => stroke(COURSE[g.hole], g.at, level as Level),
  },
  result: (g) => {
    if (g.up !== null) return null
    const [a, b] = totals(g)
    return a < b ? 0 : b < a ? 1 : 'draw'
  },
  begun: (g) => g.putts.length > 0,
}
