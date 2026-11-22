import {
  SET,
  choose,
  deal,
  drawOrPass,
  fits,
  handPips,
  lay,
  playable,
  same,
  type Laid,
  type Level,
  type Round,
  type Side,
  type Tile,
} from './dominoes'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Dominoes as a match by turns (src/lab/matches): rounds of the toy's own draw game, first to so
 * many points. A move lays a tile at an end, or draws: from the boneyard until something will go
 * (the toy's own rule, taken in one move rather than one tile at a time), or a pass when it is
 * empty. Out first scores the pips left in the other hand; a blocked line goes to the lighter hand.
 *
 * ⚠️ THE HANDS AND THE BONEYARD ARE KEPT BACK (Rules.hidden): in the match's secret, never the
 * state. The server deals each round (the first with the friend's yes, the rest through Rules.roll,
 * the sides taking turns to lead), and each player fetches their own hand from lab-move. What
 * travels is the table: the line, how many tiles each holds and the boneyard has, and the numbers
 * each has had to draw or pass on — which the toy's Hard is allowed to count on, as a player at the
 * table would. A finished round travels with both hands as they ended, so its points are what they
 * show; a stored round in play is refused unless line, hands and boneyard make one set exactly.
 */
export type Ended = {
  winner: Seat | null
  points: number
  why: 'out' | 'blocked'
  /** both hands as the round ended, and how long the line was */
  hands: [Tile[], Tile[]]
  laid: number
}
export type DominoGame = {
  target: number
  done: Ended[]
  first: Seat
  between: boolean
  line: Laid[]
  turn: Seat
  passes: number
  lacks: [number[], number[]]
  sizes: [number, number]
  yardLeft: number
  hands: [Tile[] | null, Tile[] | null]
  yard: Tile[] | null
}
export type DominoMove = { lay: Tile; side: Side } | { draw: true }

export const TARGETS = [50, 100] as const
/** rounds past this many, the match ends where it stands */
export const MAX_ROUNDS = 30

export function readDominoSettings(s: Record<string, unknown>): { target: number } | null {
  const target = s.target ?? 100
  return (TARGETS as readonly unknown[]).includes(target) ? { target: target as number } : null
}

export const totals = (g: DominoGame): [number, number] => {
  const t: [number, number] = [0, 0]
  for (const r of g.done) if (r.winner !== null) t[r.winner] += r.points
  return t
}
const matchOver = (g: DominoGame) =>
  Math.max(...totals(g)) >= g.target || g.done.length >= MAX_ROUNDS
export const whoseMove = (g: DominoGame): Seat | null => (g.between ? null : g.turn)

const fresh = (target: number): DominoGame => ({
  target,
  done: [],
  first: 1,
  between: true,
  line: [],
  turn: 0,
  passes: 0,
  lacks: [[], []],
  sizes: [0, 0],
  yardLeft: 0,
  hands: [null, null],
  yard: null,
})

const known = (g: DominoGame) => !!g.hands[0] && !!g.hands[1] && !!g.yard
const toRound = (g: DominoGame): Round => ({
  hands: [g.hands[0]!, g.hands[1]!],
  yard: g.yard!,
  line: g.line,
  turn: g.turn,
  passes: g.passes,
  lacks: [new Set(g.lacks[0]), new Set(g.lacks[1])],
  over: null,
})
function fromRound(g: DominoGame, r: Round): DominoGame {
  const next: DominoGame = {
    ...g,
    line: r.line,
    turn: r.turn,
    passes: r.passes,
    lacks: [[...r.lacks[0]].sort(), [...r.lacks[1]].sort()],
    sizes: [r.hands[0].length, r.hands[1].length],
    yardLeft: r.yard.length,
    hands: r.hands,
    yard: r.yard,
  }
  if (!r.over) return next
  const ended: Ended = {
    winner: r.over.winner,
    points: r.over.points,
    why: r.over.why,
    hands: [r.hands[0].map((t) => [...t] as Tile), r.hands[1].map((t) => [...t] as Tile)],
    laid: r.line.length,
  }
  return { ...next, done: [...g.done, ended], between: true }
}

function dealt(g: DominoGame, rand: () => number): DominoGame {
  const first: Seat = g.first === 0 ? 1 : 0
  const r = deal(Math.floor(rand() * 2 ** 32), first)
  return { ...fromRound({ ...g, between: false }, r), first, between: false }
}

const isTile = (x: unknown): x is Tile =>
  Array.isArray(x) &&
  x.length === 2 &&
  x.every((v) => Number.isInteger(v) && v >= 0 && v <= 6) &&
  x[0] <= x[1]
const onLine = (g: DominoGame, t: Tile) =>
  g.line.some((l) => same([Math.min(l.a, l.b), Math.max(l.a, l.b)], t))

/** the move, or null if it is not one; on the server, with the hands known, every rule */
function moved(g: DominoGame, m: DominoMove, s: Seat): DominoGame | null {
  if (whoseMove(g) !== s) return null
  if ('lay' in m) {
    if (onLine(g, m.lay)) return null
    // where it may go is a fact about the table, which everybody can see
    const pub = { line: g.line } as unknown as Round
    if (!fits(pub, m.lay).includes(m.side)) return null
    if (!known(g)) return g
    const r = toRound(g)
    const next = lay(r, m.lay, m.side)
    return next === r ? null : fromRound(g, next)
  }
  if (!known(g)) return g
  let r = toRound(g)
  if (playable(r).length) return null
  // draw until something will go, or pass with the boneyard empty
  for (let k = 0; k < 28 && !r.over && r.turn === s && !playable(r).length; k++) r = drawOrPass(r)
  return fromRound(g, r)
}

/* ---------------------------------------------------------------- the wire ------------------ */

const tileList = (x: unknown, max = 28): x is Tile[] =>
  Array.isArray(x) &&
  x.length <= max &&
  x.every(isTile) &&
  new Set(x.map((t) => t.join())).size === x.length

function readEnded(x: unknown): Ended | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { winner, points, why, hands, laid } = o
  if (why !== 'out' && why !== 'blocked') return null
  if (!Array.isArray(hands) || hands.length !== 2 || !tileList(hands[0]) || !tileList(hands[1]))
    return null
  if (!Number.isInteger(laid) || (laid as number) < 1 || (laid as number) > 28) return null
  const all = [...hands[0], ...hands[1]].map((t) => t.join())
  if (new Set(all).size !== all.length || all.length + (laid as number) > 28) return null
  const [pa, pb] = [handPips(hands[0]), handPips(hands[1])]
  const ok =
    why === 'out'
      ? (winner === 0 || winner === 1) &&
        hands[winner].length === 0 &&
        points === (winner === 0 ? pb : pa)
      : points === Math.abs(pa - pb) &&
        winner === (pa === pb ? null : pa < pb ? 0 : 1) &&
        hands[0].length > 0 &&
        hands[1].length > 0
  if (!ok) return null
  return {
    winner: winner as Seat | null,
    points: points as number,
    why,
    hands: [hands[0].map((t) => [...t] as Tile), hands[1].map((t) => [...t] as Tile)],
    laid: laid as number,
  }
}
function readLine(x: unknown): Laid[] | null {
  if (!Array.isArray(x) || x.length > 28) return null
  const line: Laid[] = []
  for (const e of x) {
    const v = e as { a?: unknown; b?: unknown } | null
    if (!v || !Number.isInteger(v.a) || !Number.isInteger(v.b)) return null
    const a = v.a as number
    const b = v.b as number
    if (a < 0 || a > 6 || b < 0 || b > 6) return null
    // each tile meets the one before it
    if (line.length && line[line.length - 1].b !== a) return null
    line.push({ a, b })
  }
  const keys = line.map((l) => `${Math.min(l.a, l.b)},${Math.max(l.a, l.b)}`)
  return new Set(keys).size === keys.length ? line : null
}

/** the match anybody in it may see, or null if no deal and no play could have made it */
export function replayPublic(target: number, x: unknown): DominoGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.done) || o.done.length > MAX_ROUNDS)
    return null
  const done = o.done.map(readEnded)
  if (done.some((r) => !r)) return null
  const { first, between, turn, passes, lacks, sizes, yardLeft } = o
  const line = readLine(o.line)
  if (!line || (first !== 0 && first !== 1) || typeof between !== 'boolean') return null
  if ((turn !== 0 && turn !== 1) || !Number.isInteger(passes) || (passes as number) < 0) return null
  if (!Array.isArray(lacks) || lacks.length !== 2) return null
  const lk = lacks.map((l) =>
    Array.isArray(l) && l.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) ? [...l] : null,
  )
  if (!lk[0] || !lk[1]) return null
  if (
    !Array.isArray(sizes) ||
    sizes.length !== 2 ||
    !sizes.every((n) => Number.isInteger(n) && n >= 0)
  )
    return null
  if (!Number.isInteger(yardLeft) || (yardLeft as number) < 0) return null
  const g: DominoGame = {
    target,
    done: done as Ended[],
    first,
    between,
    line,
    turn,
    passes: passes as number,
    lacks: [lk[0] as number[], lk[1] as number[]],
    sizes: [sizes[0], sizes[1]],
    yardLeft: yardLeft as number,
    hands: [null, null],
    yard: null,
  }
  if (g.between) return matchOver(g) && g.done.length > 0 ? g : null
  if (matchOver(g)) return null
  // one set: the line, both hands and the boneyard
  if (line.length + g.sizes[0] + g.sizes[1] + g.yardLeft !== 28) return null
  return g
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function dominoRules(target: number): Rules<DominoGame, DominoMove> & {
  roll: (g: DominoGame, rand: () => number) => DominoGame
} {
  return {
    fresh: () => fresh(target),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && moved(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      return s === null ? g : (moved(g, m, s) ?? g)
    },
    roll: (g, rand) => (g.between && !matchOver(g) ? dealt(g, rand) : g),
    encode: (g) => ({
      done: g.done,
      first: g.first,
      between: g.between,
      line: g.line,
      turn: g.turn,
      passes: g.passes,
      lacks: g.lacks,
      sizes: g.sizes,
      yardLeft: g.yardLeft,
    }),
    decode: (x) => replayPublic(target, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return null
      const keys = Object.keys(o).sort().join()
      if (keys === 'draw' && o.draw === true) return { draw: true }
      if (keys === 'lay,side' && isTile(o.lay) && (o.side === 'left' || o.side === 'right'))
        return { lay: [o.lay[0], o.lay[1]], side: o.side }
      return null
    },
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g, level) => {
        const c = choose(toRound(g), level as Level, Math.random)
        return c ? { lay: c.tile, side: c.side } : { draw: true }
      },
    },
    result: (g) => {
      if (whoseMove(g) !== null) return null
      const [a, b] = totals(g)
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (g) => g.done.length > 0 || g.line.length > 0,
    hidden: {
      secret: (g) => ({ hands: g.hands, yard: g.yard }),
      join: (g, secret) => {
        const o = secret as { hands?: unknown; yard?: unknown } | null
        if (!o || !Array.isArray(o.hands) || o.hands.length !== 2) return null
        if (g.between) return { ...g }
        const [a, b] = o.hands
        if (!tileList(a) || !tileList(b) || !tileList(o.yard)) return null
        if (a.length !== g.sizes[0] || b.length !== g.sizes[1] || o.yard.length !== g.yardLeft)
          return null
        // with the line, one double-six set exactly
        const keys = [
          ...a,
          ...b,
          ...o.yard,
          ...g.line.map((l) => [Math.min(l.a, l.b), Math.max(l.a, l.b)] as Tile),
        ].map((t) => t.join())
        if (keys.length !== SET.length || new Set(keys).size !== SET.length) return null
        return {
          ...g,
          hands: [a.map((t) => [...t] as Tile), b.map((t) => [...t] as Tile)],
          yard: o.yard.map((t) => [...t] as Tile),
        }
      },
      mine: (g, side) => g.hands[side],
      // nothing in a move is hidden: a tile laid is face up, and a draw names no tile
      logged: (m) => m,
      accept: (g) => dealt(g, Math.random),
    },
  }
}
