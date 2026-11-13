/**
 * Chinese checkers, for two: the six-pointed star board of 121 holes, two players in opposite points with ten pegs
 * each. A peg steps to a neighbouring empty hole, or hops over a neighbouring peg — anybody's — to
 * the empty hole beyond, and may keep hopping as long as it can. First to fill the far point wins.
 *
 * Pure, so halma.test.ts can play hundreds of games without a page. Holes are cube coordinates on a
 * hexagonal grid, q + r + s = 0; the star is the two big triangles of side 13 laid over each other.
 * Side 1 starts at the bottom point and races to the top; side 2 the other way.
 */

import { whole } from './kept'

export type Side = 1 | 2
export type Hole = { q: number; r: number; s: number }
export const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
]

/** the 121 holes, in reading order (top row first) */
export const HOLES: Hole[] = (() => {
  const out: Hole[] = []
  for (let r = -8; r <= 8; r++)
    for (let q = -8; q <= 8; q++) {
      const s = -q - r
      const up = q >= -4 && r >= -4 && s >= -4
      const down = q <= 4 && r <= 4 && s <= 4
      if (up || down) out.push({ q, r, s })
    }
  return out
})()
const index = new Map(HOLES.map((h, i) => [`${h.q},${h.r}`, i]))
export const at = (q: number, r: number) => index.get(`${q},${r}`) ?? -1
/** each hole's neighbours, one per direction, -1 off the board */
export const NEAR: number[][] = HOLES.map((h) => DIRS.map(([dq, dr]) => at(h.q + dq, h.r + dr)))
/** the bottom point (r ≥ 5) and the top point (r ≤ −5): ten holes each */
export const HOME: Record<Side, number[]> = {
  1: HOLES.map((h, i) => (h.r >= 5 ? i : -1)).filter((i) => i >= 0),
  2: HOLES.map((h, i) => (h.r <= -5 ? i : -1)).filter((i) => i >= 0),
}
export const goalOf = (s: Side) => HOME[s === 1 ? 2 : 1]
export const other = (s: Side): Side => (s === 1 ? 2 : 1)

export type Game = { cells: Int8Array; turn: Side; winner: Side | 0; plies: number }
export function newGame(first: Side = 1): Game {
  const cells = new Int8Array(HOLES.length)
  for (const i of HOME[1]) cells[i] = 1
  for (const i of HOME[2]) cells[i] = 2
  return { cells, turn: first, winner: 0, plies: 0 }
}

export type Move = { from: number; to: number; path: number[] }
/** every move for one peg: a step, or any chain of hops, each landing reached the shortest way */
export function movesFrom(cells: Int8Array, from: number): Move[] {
  const out: Move[] = []
  for (const n of NEAR[from]) if (n >= 0 && !cells[n]) out.push({ from, to: n, path: [from, n] })
  // hops: breadth first, so each landing is reached by its shortest chain
  const seen = new Set([from])
  let frontier: number[][] = [[from]]
  while (frontier.length) {
    const next: number[][] = []
    for (const path of frontier) {
      const here = path[path.length - 1]
      for (let d = 0; d < 6; d++) {
        const over = NEAR[here][d]
        if (over < 0 || !cells[over] || over === from) continue
        const land = NEAR[over][d]
        if (land < 0 || (cells[land] && land !== from) || seen.has(land) || land === from) continue
        seen.add(land)
        const p = [...path, land]
        out.push({ from, to: land, path: p })
        next.push(p)
      }
    }
    frontier = next
  }
  return out
}
export function movesOf(cells: Int8Array, side: Side): Move[] {
  const out: Move[] = []
  for (let i = 0; i < cells.length; i++) if (cells[i] === side) out.push(...movesFrom(cells, i))
  return out
}
export const moves = (g: Game) => (g.winner ? [] : movesOf(g.cells, g.turn))

/**
 * Whether a side has won: every hole of its goal filled, and at least one by its own pegs — so a
 * player cannot stop the other winning by leaving a peg at home for ever.
 */
export function won(cells: Int8Array, side: Side): boolean {
  const goal = goalOf(side)
  return goal.every((i) => cells[i]) && goal.some((i) => cells[i] === side)
}
export const DRAW_AFTER = 400
export function play(g: Game, m: Move): Game {
  const cells = g.cells.slice()
  cells[m.to] = g.turn
  cells[m.from] = 0
  const winner: Side | 0 = won(cells, g.turn) ? g.turn : 0
  return { cells, turn: other(g.turn), winner, plies: g.plies + 1 }
}

/* --------------------------------------------------------------------------- the computer */

/** how far up the board a hole is for a side: 0 at its own far tip, 16 at the goal's tip */
export const progress = (i: number, s: Side) => (s === 1 ? 8 - HOLES[i].r : HOLES[i].r + 8)
/** how far from the middle line of the board, which is the fast lane */
const wide = (i: number) => Math.abs(HOLES[i].q - HOLES[i].s)

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * How a position stands for a side: its pegs' progress against the other side's, and a little for
 * keeping to the middle. A penalty for the peg furthest behind was tried, on the reasoning that a
 * straggler costs more turns at the end than any one hop saves; it made the computer weaker — the
 * same level without it won 48 games in 60 against it — so it is not here.
 */
export function value(cells: Int8Array, side: Side): number {
  const sum = (s: Side) => {
    let t = 0
    for (let i = 0; i < cells.length; i++)
      // a peg already in the goal counts as all the way there
      if (cells[i] === s) t += (goalOf(s).includes(i) ? 18 : progress(i, s)) * 10 - wide(i)
    return t
  }
  if (won(cells, side)) return 1e6
  if (won(cells, other(side))) return -1e6
  return sum(side) - sum(other(side))
}
const gain = (m: Move, s: Side) => progress(m.to, s) - progress(m.from, s)

/** the computer's move */
export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const s = g.turn
  const list = moves(g)
  const apply = (cells: Int8Array, m: Move, who: Side) => {
    const c = cells.slice()
    c[m.to] = who
    c[m.from] = 0
    return c
  }
  // the moves worth a look: forward ones first, backward ones only if there is nothing else
  const shortlist = (cells: Int8Array, who: Side, k: number) => {
    const ms = movesOf(cells, who)
    ms.sort((a, b) => gain(b, who) - gain(a, who) || wide(a.to) - wide(b.to))
    return ms.slice(0, k)
  }
  if (level === 'easy') {
    // judged as Fair judges it, but any of its best few will do. Taking simply the longest leap
    // was tried first: it strands its back pegs, and two such players drew a game in three
    const ranked = list
      .map((m) => ({ m, v: value(apply(g.cells, m, s), s) }))
      .sort((x, y) => y.v - x.v)
    return ranked[Math.floor(rand() * Math.min(4, ranked.length))].m
  }
  let best: Move[] = []
  let bv = -Infinity
  for (const m of shortlist(g.cells, s, level === 'hard' ? 14 : 40)) {
    const c1 = apply(g.cells, m, s)
    let v: number
    if (won(c1, s)) v = 1e6
    else if (level === 'fair') v = value(c1, s)
    else {
      // Hard: the other side's best answer, and then its own best move after that
      let worst = Infinity
      for (const r of shortlist(c1, other(s), 8)) {
        const c2 = apply(c1, r, other(s))
        let after = -Infinity
        for (const m2 of shortlist(c2, s, 8)) after = Math.max(after, value(apply(c2, m2, s), s))
        worst = Math.min(worst, after === -Infinity ? value(c2, s) : after)
      }
      v = worst
    }
    if (v > bv) {
      bv = v
      best = [m]
    } else if (v === bv) best.push(m)
  }
  return best[Math.floor(rand() * best.length)]
}

/** a whole game between two levels, for the tests */
export function match(a: Level, b: Level, rand: () => number, first: Side = 1) {
  let g = newGame(first)
  const lv: Record<Side, Level> = { 1: a, 2: b }
  while (!g.winner && g.plies < DRAW_AFTER) g = play(g, choose(g, lv[g.turn], rand))
  return { winner: g.winner, plies: g.plies }
}

/* --------------------------------------------------------------------------- what is kept */

export const HALMA_KEY = 'lab_halma_v1'
export const LOOKS = ['wood', 'marble', 'night'] as const
export type Tally = { won: number; lost: number; fewest: number }
export type Saved = {
  level: Level
  look: (typeof LOOKS)[number]
  /** mark where a picked peg can go */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, fewest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  look: 'wood',
  hints: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = { won: whole(x.won), lost: whole(x.lost), fewest: whole(x.fewest) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
