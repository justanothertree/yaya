import {
  LEVELS,
  R,
  TH,
  TW,
  canPlace,
  newGame,
  place,
  plan,
  shoot,
  type Ball,
  type Game,
  type Group,
  type Level,
} from './pool'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Eight-ball as a game by turns (docs/2026-11-14-lab-async-matches-plan.md, "Pool by turns").
 *
 * ⚠️ THE MOVE IS THE SHOT, AND THE SERVER PLAYS IT. A shot is its aim, its strength and, with
 * the cue ball in hand, where the cue ball was put. `apply` plays it through with pool.ts's own
 * `shoot`, so wherever this runs — the edge function, or a browser watching — it is the same
 * function on the same numbers. The server's answer is the board; a browser only ever shows it.
 *
 * ⚠️ THE GAME TRAVELS AS THE TABLE, NOT AS A LIST OF SHOTS. Chess replays its move list, but a
 * pool game replayed from the rack would run the toy's most expensive function once per shot ever
 * played, on every move. Only the service role writes the state, so `decode` checks it is a
 * table the game could be in (sixteen balls, each once, on the cloth or down, none overlapping)
 * rather than proving how it got there.
 *
 * ⚠️ AND IT CARRIES THE LAST SHOT AND THE TABLE BEFORE IT, so the other player can watch the shot
 * they missed: their browser plays `last` from `prev` with `shoot`'s own frames, then lays the
 * balls where the server says. Chrome, Edge and Deno run the same engine, so that lands where the
 * server did; anywhere it does not, the balls are put where the server says at the end.
 */
export type PoolShot = { a: number; p: number; x?: number; y?: number }
export type PoolGame = Game & { last: PoolShot | null; prev: Ball[] | null }

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** a shot from the wire, or null: an aim, a strength over nothing and at most full, and a spot */
export function readShot(x: unknown): PoolShot | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  if (!finite(o.a) || Math.abs(o.a) > 8 || !finite(o.p) || o.p <= 0 || o.p > 1) return null
  const spot = o.x !== undefined || o.y !== undefined
  if (spot && (!finite(o.x) || !finite(o.y))) return null
  return spot ? { a: o.a, p: o.p, x: o.x as number, y: o.y as number } : { a: o.a, p: o.p }
}

/** sixteen balls as the wire carries them: [n, x, y, down] */
const packBalls = (bs: Ball[]) => bs.map((b) => [b.n, b.x, b.y, b.down ? 1 : 0])
function readBalls(x: unknown): Ball[] | null {
  if (!Array.isArray(x) || x.length !== 16) return null
  const seen = new Set<number>()
  const out: Ball[] = []
  for (const b of x) {
    if (!Array.isArray(b) || b.length !== 4) return null
    const [n, bx, by, d] = b
    if (!Number.isInteger(n) || n < 0 || n > 15 || seen.has(n)) return null
    if (!finite(bx) || !finite(by) || (d !== 0 && d !== 1)) return null
    // a ball on the cloth may sit in a pocket's mouth, just past the cushion line; a ball that went
    // down stops where it fell, a little further into the pocket
    const slack = d === 1 ? 4 * R : R
    if (bx < -slack || bx > TW + slack || by < -slack || by > TH + slack) return null
    seen.add(n)
    out.push({ n, x: bx, y: by, vx: 0, vy: 0, down: d === 1 })
  }
  /* ⚠️ HALF A BALL, NOT A WHOLE ONE: the simulation separates balls by sharing the overlap, and two
     can come to rest a fifth of a width into each other. Measured over sixty computer games on
     15 Nov: the closest pair at rest was 0.805 of a width apart. Half a width is damage. */
  const up = out.filter((b) => !b.down)
  for (let i = 0; i < up.length; i++)
    for (let j = i + 1; j < up.length; j++)
      if (Math.hypot(up[i].x - up[j].x, up[i].y - up[j].y) < R) return null
  return out.sort((p, q) => p.n - q.n)
}

const GROUPS: readonly (Group | null)[] = ['solids', 'stripes', null]

export function readPoolGame(x: unknown): PoolGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const balls = readBalls(o.balls)
  if (!balls) return null
  const g = o.groups
  if (!Array.isArray(g) || g.length !== 2 || !g.every((v) => GROUPS.includes(v as Group | null)))
    return null
  const groups = g as [Group | null, Group | null]
  // the table is open, or each side has the other's group
  if ((groups[0] === null) !== (groups[1] === null)) return null
  if (groups[0] !== null && groups[0] === groups[1]) return null
  if (o.turn !== 0 && o.turn !== 1) return null
  if (o.winner !== null && o.winner !== 0 && o.winner !== 1) return null
  if (typeof o.inHand !== 'boolean' || typeof o.broken !== 'boolean') return null
  if (typeof o.said !== 'string' || o.said.length > 200) return null
  const cue = balls.find((b) => b.n === 0)!
  const black = balls.find((b) => b.n === 8)!
  // the cue ball is back on the table after any shot but the last; the black down means it is over
  if ((cue.down || black.down) && o.winner === null) return null
  const last = o.last === null ? null : readShot(o.last)
  if (o.last !== null && !last) return null
  const prev = o.prev === null ? null : readBalls(o.prev)
  if (o.prev !== null && !prev) return null
  return {
    balls,
    groups,
    turn: o.turn,
    winner: o.winner as Seat | null,
    inHand: o.inHand,
    broken: o.broken,
    said: o.said,
    last,
    prev,
  }
}

/** a fresh rack, from a seed the caller does not choose */
const seed = (): number => Math.floor(Math.random() * 2 ** 31)

export const poolRules: Rules<PoolGame, PoolShot> = {
  fresh: () => ({ ...newGame(seed(), 0), last: null, prev: null }),
  turn: (g) => (g.winner !== null ? null : g.turn),
  legal: (g, m, by) =>
    g.winner === null &&
    (by === undefined || by === g.turn) &&
    readShot(m) !== null &&
    (m.x === undefined || (g.inHand && canPlace(g, m.x, m.y!))),
  apply: (g, m) => {
    const base = m.x !== undefined && g.inHand ? place(g, m.x, m.y!) : g
    const { game } = shoot(base, m.a, m.p)
    return { ...game, last: m, prev: base.balls }
  },
  encode: (g) => ({
    balls: packBalls(g.balls),
    groups: g.groups,
    turn: g.turn,
    winner: g.winner,
    inHand: g.inHand,
    broken: g.broken,
    said: g.said,
    last: g.last,
    prev: g.prev ? packBalls(g.prev) : null,
  }),
  decode: readPoolGame,
  readMove: readShot,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => {
      const s = plan(g, level as Level)
      return s.place ? { a: s.angle, p: s.power, ...s.place } : { a: s.angle, p: s.power }
    },
  },
  result: (g) => g.winner,
  begun: (g) => g.broken,
}
