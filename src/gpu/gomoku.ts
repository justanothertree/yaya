/**
 * Five in a row: two players take turns placing stones on the points of a grid; the first with five
 * or more in a line — across, down or on a diagonal — wins. Black moves first.
 *
 * Pure, so gomoku.test.ts can play hundreds of games without a page. Points are numbered row by
 * row; 1 is black, 2 white.
 */

export type Side = 1 | 2
export const SIZES = [11, 13] as const
export type Size = (typeof SIZES)[number]
export type Game = {
  n: number
  cells: Int8Array
  turn: Side
  winner: Side | 0
  /** the five (or more) that won, for drawing the line */
  line: number[]
  moves: number[]
  over: boolean
}
const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]
export const other = (s: Side): Side => (s === 1 ? 2 : 1)
export function newGame(n: number = 13): Game {
  return {
    n,
    cells: new Int8Array(n * n),
    turn: 1,
    winner: 0,
    line: [],
    moves: [],
    over: false,
  }
}
/** the run through a point in one direction: every stone of that side touching it in a line */
function run(cells: Int8Array, n: number, i: number, dr: number, dc: number): number[] {
  const s = cells[i]
  const r0 = Math.floor(i / n)
  const c0 = i % n
  const out = [i]
  for (const sign of [1, -1]) {
    let r = r0 + dr * sign
    let c = c0 + dc * sign
    while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === s) {
      out.push(r * n + c)
      r += dr * sign
      c += dc * sign
    }
  }
  return out.sort((a, b) => a - b)
}
export function place(g: Game, i: number): Game {
  if (g.over || g.cells[i]) return g
  const cells = g.cells.slice()
  cells[i] = g.turn
  let line: number[] = []
  for (const [dr, dc] of DIRS) {
    const r = run(cells, g.n, i, dr, dc)
    if (r.length >= 5) line = r
  }
  const moves = [...g.moves, i]
  const won = line.length >= 5
  const full = moves.length === g.n * g.n
  return {
    ...g,
    cells,
    turn: other(g.turn),
    winner: won ? g.turn : 0,
    line,
    moves,
    over: won || full,
  }
}
export function undo(g: Game, k = 1): Game {
  let out = newGame(g.n)
  for (const m of g.moves.slice(0, Math.max(0, g.moves.length - k))) out = place(out, m)
  return out
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * What a stone at `i` would make for `side`, line by line: each direction's run is looked at as the
 * stones it would join and whether its two ends are open. Five wins outright; an open four (both
 * ends free) cannot be stopped; a four or an open three must be answered at once.
 */
export function shape(cells: Int8Array, n: number, i: number, side: Side): number {
  let total = 0
  let fours = 0
  let threes = 0
  const r0 = Math.floor(i / n)
  const c0 = i % n
  for (const [dr, dc] of DIRS) {
    let count = 1
    let open = 0
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign
      let c = c0 + dc * sign
      while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === side) {
        count++
        r += dr * sign
        c += dc * sign
      }
      if (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === 0) open++
    }
    if (count >= 5) total += 1e7
    else if (count === 4) {
      total += open === 2 ? 1e6 : open === 1 ? 6e4 : 0
      if (open) fours++
    } else if (count === 3) {
      total += open === 2 ? 5e4 : open === 1 ? 2000 : 0
      if (open === 2) threes++
    } else if (count === 2) total += open === 2 ? 600 : open === 1 ? 80 : 0
    else total += open === 2 ? 20 : open === 1 ? 4 : 0
  }
  // two threats at once cannot both be answered
  if (fours >= 2 || (fours && threes)) total += 8e5
  else if (threes >= 2) total += 3e5
  return total
}
/** the empty points worth considering: those within two of a stone, or the middle on an empty board */
export function candidates(g: Game): number[] {
  const { n, cells } = g
  if (!g.moves.length) return [Math.floor(n / 2) * n + Math.floor(n / 2)]
  const out: number[] = []
  for (let i = 0; i < n * n; i++) {
    if (cells[i]) continue
    const r = Math.floor(i / n)
    const c = i % n
    let near = false
    for (let dr = -2; dr <= 2 && !near; dr++)
      for (let dc = -2; dc <= 2 && !near; dc++) {
        const rr = r + dr
        const cc = c + dc
        if (rr >= 0 && cc >= 0 && rr < n && cc < n && cells[rr * n + cc]) near = true
      }
    if (near) out.push(i)
  }
  return out
}
/** a point's worth to the side to move: what it makes, and what it takes from the other side */
const worth = (g: Game, i: number, defend: number) =>
  shape(g.cells, g.n, i, g.turn) + defend * shape(g.cells, g.n, i, other(g.turn))

/**
 * The computer's stone. Every level wins at once when it can and blocks a five when it must; past
 * that, Easy weighs its own lines and half-notices the other side's, Fair weighs both, and Hard also
 * looks at the other side's best answer to each of its ten best points.
 */
export function choose(g: Game, level: Level, rand: () => number = Math.random): number {
  const list = candidates(g)
  const me = g.turn
  // a win now, then a five to stop
  for (const i of list) if (shape(g.cells, g.n, i, me) >= 1e7) return i
  for (const i of list) if (shape(g.cells, g.n, i, other(me)) >= 1e7) return i
  if (level !== 'easy') {
    // then an open four or two threats at once of its own, which wins next move; then the other
    // side's, which must be blocked now or never. Without this Hard, busy planning against the
    // answers Fair would give, lost 27 games in 40 to Easy, who simply did not give them
    const winNext = list.find((i) => shape(g.cells, g.n, i, me) >= 3e5)
    if (winNext !== undefined) return winNext
    const threat = list
      .map((i) => ({ i, v: shape(g.cells, g.n, i, other(me)) }))
      .filter((x) => x.v >= 3e5)
      .sort((x, y) => y.v - x.v)[0]
    if (threat) return threat.i
  }
  const defend = level === 'easy' ? 0.5 : 0.95
  const ranked = list.map((i) => ({ i, v: worth(g, i, defend) })).sort((a, b) => b.v - a.v)
  if (level === 'easy') {
    // and often a lesser point: it plays by eye, not by count
    const k = rand() < 0.4 ? Math.min(4, ranked.length) : 1
    return ranked[Math.floor(rand() * k)].i
  }
  if (level === 'fair') {
    const top = ranked.filter((x) => x.v === ranked[0].v)
    return top[Math.floor(rand() * top.length)].i
  }
  // Hard: each of its ten best points, the other side's answer as Fair would choose it, and then
  // how the board stands with Hard to move — its best line against half the other side's, since it
  // moves first. Two earlier tries scored the point against the other side's best answer straight
  // away; weighed either way, that made Hard so busy defending that it never won a game of 100
  // against Fair
  let best = ranked[0].i
  let bv = -Infinity
  for (const { i } of ranked.slice(0, 10)) {
    const after = place(g, i)
    if (after.winner === me) return i
    // the last point on a full board: nothing to answer
    if (after.over) continue
    const reply = choose(after, 'fair', rand)
    const back = place(after, reply)
    if (back.winner) continue
    const list2 = candidates(back)
    const mine = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, me)), 0)
    const theirs = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, other(me))), 0)
    const score = mine - theirs * 0.5
    if (score > bv) {
      bv = score
      best = i
    }
  }
  return best
}
/** a whole game between two levels, for the tests */
export function match(a: Level, b: Level, rand: () => number, n = 13) {
  let g = newGame(n)
  const lv: Record<Side, Level> = { 1: a, 2: b }
  while (!g.over) g = place(g, choose(g, lv[g.turn], rand))
  return { winner: g.winner, moves: g.moves.length }
}

/* --------------------------------------------------------------------------- what is kept */

export const GOMOKU_KEY = 'lab_gomoku_v1'
export const LOOKS = ['wood', 'paper', 'night'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  size: Size
  look: (typeof LOOKS)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 13,
  look: 'wood',
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), drawn: whole(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    look: pick(LOOKS, o.look, EMPTY.look),
    record,
  }
}
