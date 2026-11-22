import {
  LEVELS,
  SPREAD,
  aimFor,
  dart,
  hitAt,
  land,
  newLeg,
  type Hit,
  type Leg,
  type Level,
  type Who,
} from './darts'
import type { Rules } from '../lab/social/room'

/**
 * Darts as a room game (src/lab/social/room.ts): 501, double out, first to two legs, the first
 * throw of each leg going to each side in turn, as the toy plays the computer. Together, the two
 * seats throw their side's darts in turn and the computer throws the other side's, dart by dart,
 * with darts.ts's own aim and hand.
 *
 * ⚠️ A MOVE IS WHERE A DART LANDED. Your hand's spread is the toy's own — it depends on how long
 * you held, which only your screen knows — so the thrower's page scatters the dart as it always
 * has and sends where it went in. What that scores is not the thrower's to say: the host reads it
 * off the board through darts.ts's `hitAt` and plays it through `dart`. That is the same trust
 * every shot here takes — a putt's line or a stone's weight is the thrower's to send too — and a
 * call is friends.
 *
 * THE MATCH TRAVELS AS ITS DARTS, replayed on every seat, so the scores and the legs can only be
 * what those darts made. Positions go to a tenth of a millimetre, which no ring on the board is
 * near the width of.
 */
export type Pt = { x: number; y: number }
export type DartsGame = {
  darts: Pt[]
  leg: Leg
  /** which leg this is, from 0, and the legs each side has won */
  legNo: number
  legs: [number, number]
  over: boolean
  /** the darts in the board: this turn's, or the last turn's until the next is begun */
  board: (Pt & { who: Who })[]
  /** the last dart — who threw it, what it hit, and the leg as it was before — for the page */
  last: { by: Who; hit: Hit; before: Leg; legWon: boolean } | null
}

export const LEGS_TO_WIN = 2
/** a dart further out than this is nowhere near the board: the sender holds it in */
export const FAR = 300
/** far more darts than any match: three legs of nothing but misses and busts */
export const MAX_DARTS = 900

const fresh = (): DartsGame => ({
  darts: [],
  leg: newLeg(0),
  legNo: 0,
  legs: [0, 0],
  over: false,
  board: [],
  last: null,
})

/** a dart's landing, held to the board's neighbourhood and to a tenth of a millimetre */
export const tidy = (p: Pt): Pt => {
  const r = Math.hypot(p.x, p.y)
  const f = r > FAR ? FAR / r : 1
  return { x: Math.round(p.x * f * 10) / 10, y: Math.round(p.y * f * 10) / 10 }
}

function play(g: DartsGame, p: Pt): DartsGame {
  const by = g.leg.turn
  const hit = hitAt(p.x, p.y)
  const leg = dart(g.leg, hit)
  const board = [...(g.leg.darts.length === 0 ? [] : g.board), { ...p, who: by }]
  const base = { ...g, darts: [...g.darts, p], board }
  if (leg.winner === null) return { ...base, leg, last: { by, hit, before: g.leg, legWon: false } }
  const legs: [number, number] = [g.legs[0], g.legs[1]]
  legs[leg.winner]++
  const over = Math.max(...legs) >= LEGS_TO_WIN
  const legNo = over ? g.legNo : g.legNo + 1
  return {
    ...base,
    leg: over ? leg : newLeg((legNo % 2) as Who),
    legNo,
    legs,
    over,
    last: { by, hit, before: g.leg, legWon: true },
  }
}

/** a dart from the wire or the room: a landing near the board; null otherwise */
export function readDart(x: unknown): Pt | null {
  const [px, py] = Array.isArray(x)
    ? x
    : [(x as Partial<Pt> | null)?.x, (x as Partial<Pt> | null)?.y]
  if (typeof px !== 'number' || typeof py !== 'number') return null
  if (!Number.isFinite(px) || !Number.isFinite(py) || Math.hypot(px, py) > FAR + 0.1) return null
  return { x: px, y: py }
}

const done = (g: DartsGame) => g.over || g.darts.length >= MAX_DARTS

/** the match these darts make, or null at the first that is not a dart there */
export function replay(darts: readonly unknown[]): DartsGame | null {
  if (darts.length > MAX_DARTS) return null
  let g = fresh()
  for (const x of darts) {
    const p = readDart(x)
    if (!p || done(g)) return null
    g = play(g, p)
  }
  return g
}

export const dartsRules: Rules<DartsGame, Pt> = {
  fresh,
  turn: (g) => (done(g) ? null : g.leg.turn),
  legal: (g, p, by) => !done(g) && (by === undefined || by === g.leg.turn) && readDart(p) !== null,
  apply: (g, p) => play(g, p),
  encode: (g) => ({ darts: g.darts.map((p) => [p.x, p.y]) }),
  decode: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !Array.isArray(o.darts)) return null
    return replay(o.darts)
  },
  readMove: readDart,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) =>
      tidy(land(aimFor(g.leg, level as Level), SPREAD[level as Level], Math.random)),
  },
  result: (g) => (!done(g) ? null : g.legs[0] > g.legs[1] ? 0 : g.legs[1] > g.legs[0] ? 1 : 'draw'),
  begun: (g) => g.darts.length > 0,
}

/**
 * ⚠️ A MATCH BY TURNS IS KEPT, IN A STATE CAPPED AT 16 KB. The room above takes any landing near
 * the board, as a call keeps nothing; a match keeps every dart. The toy sends its darts tidied to
 * a tenth of a millimetre, and at that the longest match there can be, MAX_DARTS darts at the
 * widest, is 16,211 bytes — inside the cap, measured on 16 Nov 2026. A dart sent to seventeen
 * places could take a match past it, so in a match only a tidied dart is a dart.
 */
const tidied = (p: Pt) => {
  const t = tidy(p)
  return t.x === p.x && t.y === p.y
}
export const dartsMatchRules: Rules<DartsGame, Pt> = {
  ...dartsRules,
  legal: (g, p, by) => dartsRules.legal(g, p, by) && tidied(p),
  readMove: (x) => {
    const p = readDart(x)
    return p && tidied(p) ? p : null
  },
}
