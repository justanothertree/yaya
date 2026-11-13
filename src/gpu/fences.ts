/**
 * Fences: a race across a square board, for you and the computer. Each of you starts in the
 * middle of your own edge and wins by reaching the far one. On your turn either step one square,
 * or put down a fence two squares long in a groove between squares to lengthen the other side's
 * way — but never to close it: every fence must leave both of you a way through. Meeting face to
 * face, you may hop over; with a fence or the edge behind, step aside past them instead.
 *
 * Pure, so fences.test.ts can play a few hundred games without a page. Distances are a
 * breadth-first search over at most 81 squares, cheap enough to run a few thousand times a move.
 */
import { rng } from './bricks'
import { whole } from './kept'

export type Who = 0 | 1
export type Sq = [number, number]
export type Orient = 'h' | 'v'
export type Move = { kind: 'step'; to: Sq } | { kind: 'fence'; o: Orient; r: number; c: number }
export type Game = {
  n: number
  pos: [Sq, Sq]
  /** fences each side has left to put down */
  left: [number, number]
  /**
   * fences, by the groove crossing they are centred on: (r, c) is the corner shared by squares
   * (r, c) and (r+1, c+1). A flat one runs under squares (r, c) and (r, c+1); a standing one
   * runs beside squares (r, c) and (r+1, c).
   */
  h: Uint8Array
  v: Uint8Array
  turn: Who
  winner: Who | null
  plies: number
}
export const SIZES = [7, 9] as const
export type Size = (typeof SIZES)[number]
/** fences to a side: ten on the full board, fewer on the small one where each counts for more */
export const FENCES: Record<Size, number> = { 7: 7, 9: 10 }
/** the row each side is racing to: you start at the bottom, so yours is the top */
export const goalRow = (g: Game, w: Who) => (w === 0 ? 0 : g.n - 1)

export function newGame(n: Size = 9, first: Who = 0): Game {
  const mid = n >> 1
  return {
    n,
    pos: [
      [n - 1, mid],
      [0, mid],
    ],
    left: [FENCES[n], FENCES[n]],
    h: new Uint8Array((n - 1) * (n - 1)),
    v: new Uint8Array((n - 1) * (n - 1)),
    turn: first,
    winner: null,
    plies: 0,
  }
}

const inside = (g: Game, r: number, c: number) => r >= 0 && c >= 0 && r < g.n && c < g.n
const slot = (g: Game, r: number, c: number) => r * (g.n - 1) + c
const hAt = (g: Game, r: number, c: number) =>
  r >= 0 && c >= 0 && r < g.n - 1 && c < g.n - 1 && g.h[slot(g, r, c)] === 1
const vAt = (g: Game, r: number, c: number) =>
  r >= 0 && c >= 0 && r < g.n - 1 && c < g.n - 1 && g.v[slot(g, r, c)] === 1

/** whether a single step from (r, c) by (dr, dc) stays on the board and crosses no fence */
export function open(g: Game, r: number, c: number, dr: number, dc: number): boolean {
  const nr = r + dr
  const nc = c + dc
  if (!inside(g, nr, nc)) return false
  if (dr === 1) return !hAt(g, r, c) && !hAt(g, r, c - 1)
  if (dr === -1) return !hAt(g, nr, c) && !hAt(g, nr, c - 1)
  if (dc === 1) return !vAt(g, r, c) && !vAt(g, r - 1, c)
  return !vAt(g, r, nc) && !vAt(g, r - 1, nc)
}
const DIRS: Sq[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

/** the squares a side can move to: a step, a hop over the other side, or a sidestep past them */
export function steps(g: Game, w: Who = g.turn): Sq[] {
  const [r, c] = g.pos[w]
  const [or, oc] = g.pos[w === 0 ? 1 : 0]
  const out: Sq[] = []
  for (const [dr, dc] of DIRS) {
    if (!open(g, r, c, dr, dc)) continue
    const nr = r + dr
    const nc = c + dc
    if (nr !== or || nc !== oc) {
      out.push([nr, nc])
      continue
    }
    if (open(g, nr, nc, dr, dc)) {
      out.push([nr + dr, nc + dc])
      continue
    }
    // straight on is shut: step aside past them, either way that is open
    for (const [sr, sc] of dr
      ? ([
          [0, -1],
          [0, 1],
        ] as Sq[])
      : ([
          [-1, 0],
          [1, 0],
        ] as Sq[]))
      if (open(g, nr, nc, sr, sc)) out.push([nr + sr, nc + sc])
  }
  return out
}

/**
 * Squares to the goal for one side, ignoring where the other side stands — which is the honest
 * measure, because they will move. Infinity when walled off, which `fenceOk` never allows.
 */
export function dist(g: Game, w: Who): number {
  return distFrom(g, g.pos[w], goalRow(g, w))
}
function distFrom(g: Game, from: Sq, goal: number): number {
  const n = g.n
  if (from[0] === goal) return 0
  const seen = new Int8Array(n * n)
  let frontier = [from[0] * n + from[1]]
  seen[frontier[0]] = 1
  for (let d = 1; frontier.length; d++) {
    const next: number[] = []
    for (const k of frontier) {
      const r = (k / n) | 0
      const c = k % n
      for (const [dr, dc] of DIRS) {
        if (!open(g, r, c, dr, dc)) continue
        const nk = (r + dr) * n + c + dc
        if (seen[nk]) continue
        if (r + dr === goal) return d
        seen[nk] = 1
        next.push(nk)
      }
    }
    frontier = next
  }
  return Infinity
}
/** one shortest way to the goal, as the squares along it (not the one it starts on) */
export function path(g: Game, w: Who): Sq[] {
  const n = g.n
  const goal = goalRow(g, w)
  const [r0, c0] = g.pos[w]
  if (r0 === goal) return []
  const from = new Int16Array(n * n).fill(-1)
  const start = r0 * n + c0
  from[start] = start
  let frontier = [start]
  while (frontier.length) {
    const next: number[] = []
    for (const k of frontier) {
      const r = (k / n) | 0
      const c = k % n
      for (const [dr, dc] of DIRS) {
        if (!open(g, r, c, dr, dc)) continue
        const nk = (r + dr) * n + c + dc
        if (from[nk] >= 0) continue
        from[nk] = k
        if (r + dr === goal) {
          const out: Sq[] = []
          for (let x = nk; x !== start; x = from[x]) out.unshift([(x / n) | 0, x % n])
          return out
        }
        next.push(nk)
      }
    }
    frontier = next
  }
  return []
}

export type Trouble = 'over' | 'spent' | 'off' | 'cross' | 'overlap' | 'shut'
/**
 * Why a fence may not go here, or null when it may: the game is over, the side has none left,
 * it is off the board, it crosses a fence at the same crossing, it half-overlaps one of the same
 * lie, or it would leave somebody no way through. In that order, so the page can say which.
 */
export function fenceTrouble(
  g: Game,
  o: Orient,
  r: number,
  c: number,
  w: Who = g.turn,
): Trouble | null {
  if (g.winner !== null) return 'over'
  if (g.left[w] <= 0) return 'spent'
  if (r < 0 || c < 0 || r >= g.n - 1 || c >= g.n - 1) return 'off'
  if (hAt(g, r, c) || vAt(g, r, c)) return 'cross'
  if (o === 'h' ? hAt(g, r, c - 1) || hAt(g, r, c + 1) : vAt(g, r - 1, c) || vAt(g, r + 1, c))
    return 'overlap'
  const t = withFence(g, o, r, c)
  return dist(t, 0) < Infinity && dist(t, 1) < Infinity ? null : 'shut'
}
export const fenceOk = (g: Game, o: Orient, r: number, c: number, w: Who = g.turn) =>
  fenceTrouble(g, o, r, c, w) === null
function withFence(g: Game, o: Orient, r: number, c: number): Game {
  const h = o === 'h' ? g.h.slice() : g.h
  const v = o === 'v' ? g.v.slice() : g.v
  ;(o === 'h' ? h : v)[slot(g, r, c)] = 1
  return { ...g, h, v }
}

/** play a move for the side whose turn it is; an illegal move hands back the same game */
export function play(g: Game, m: Move): Game {
  if (g.winner !== null) return g
  const w = g.turn
  const other: Who = w === 0 ? 1 : 0
  if (m.kind === 'step') {
    if (!steps(g, w).some(([r, c]) => r === m.to[0] && c === m.to[1])) return g
    const pos = (w === 0 ? [m.to, g.pos[1]] : [g.pos[0], m.to]) as Game['pos']
    const won = m.to[0] === goalRow(g, w)
    return { ...g, pos, turn: other, winner: won ? w : null, plies: g.plies + 1 }
  }
  if (!fenceOk(g, m.o, m.r, m.c, w)) return g
  const t = withFence(g, m.o, m.r, m.c)
  const left = (w === 0 ? [g.left[0] - 1, g.left[1]] : [g.left[0], g.left[1] - 1]) as Game['left']
  return { ...t, left, turn: other, plies: g.plies + 1 }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * How things stand for `w`: the race in squares, from their side. The side to move is a step
 * ahead in any race, so a tie in squares goes to them. A fence in hand is worth something too,
 * since it is a detour the other side has yet to walk — and how much is the difference between
 * Fair and Hard. Fair counts one at a third of a square, so it spends fences freely; Hard counts
 * one at a square and a half, so it keeps them for the endgame, where a fence next to another
 * can cost three or four squares. Swept against Fair over fifty games, then checked on fifty
 * others: 0.1 won 30, 0.6 and 1 won 33, 1.5 won 37 and 38, 2 won 35, 3 won 24.
 */
export function judge(g: Game, w: Who, keep = 0.35): number {
  if (g.winner !== null) return g.winner === w ? 1000 - g.plies : -1000 + g.plies
  const other: Who = w === 0 ? 1 : 0
  const mine = dist(g, w)
  const theirs = dist(g, other)
  const tempo = g.turn === w ? 0.5 : -0.5
  return theirs - mine + tempo + keep * (g.left[w] - g.left[other])
}

/**
 * Fences worth thinking about: the ones that touch the next few squares of the other side's
 * shortest way, which is where a fence costs them something. Searching every groove is about a
 * hundred and thirty options on a full board, nearly all of them pointless.
 */
export function fenceIdeas(g: Game, against: Who, reach = 4): Move[] {
  const way = [g.pos[against], ...path(g, against).slice(0, reach)]
  const seen = new Set<string>()
  const out: Move[] = []
  const add = (o: Orient, r: number, c: number) => {
    const k = `${o}${r},${c}`
    if (seen.has(k)) return
    seen.add(k)
    if (fenceOk(g, o, r, c)) out.push({ kind: 'fence', o, r, c })
  }
  for (let i = 0; i + 1 < way.length; i++) {
    const [r, c] = way[i]
    const [nr, nc] = way[i + 1]
    if (nr !== r) {
      // a step across a flat groove: either of the two flat fences that would cover it
      const gr = Math.min(r, nr)
      add('h', gr, c)
      add('h', gr, c - 1)
    } else {
      const gc = Math.min(c, nc)
      add('v', r, gc)
      add('v', r - 1, gc)
    }
  }
  return out
}

function options(g: Game, reach: number): Move[] {
  const out: Move[] = steps(g).map((to) => ({ kind: 'step', to }) as Move)
  if (g.left[g.turn] > 0) out.push(...fenceIdeas(g, g.turn === 0 ? 1 : 0, reach))
  return out
}

function search(
  g: Game,
  depth: number,
  alpha: number,
  beta: number,
  me: Who,
  reach: number,
  keep: number,
): number {
  if (depth === 0 || g.winner !== null) return judge(g, me, keep)
  const mine = g.turn === me
  const opts = options(g, reach)
  let best = mine ? -Infinity : Infinity
  for (const m of opts) {
    const v = search(play(g, m), depth - 1, alpha, beta, me, reach, keep)
    if (mine) {
      if (v > best) best = v
      if (best > alpha) alpha = best
    } else {
      if (v < best) best = v
      if (best < beta) beta = best
    }
    if (alpha >= beta) break
  }
  return best
}

/**
 * The computer's move. Easy walks its shortest way and now and then drops a fence somewhere in
 * front of you, not always a useful one. Fair and Hard both look three moves ahead — their move,
 * your answer, their reply — which is the least that sees a pair of fences working together: one
 * fence on an open board costs you a square, which is no more than a step of their own gains, so
 * looking one move ahead never fences at all (measured: Fair at that depth used none in ten
 * games, and every game was decided by who got to hop over whom). Hard looks along more of your
 * way, picks its best move rather than any good one, and saves its fences (see `judge`).
 */
/**
 * Per level: how far along your way it looks for fences, how loosely it picks among near-equal
 * moves, how many moves ahead it looks, and what a fence in hand is worth to it (see `judge`).
 * A fourth move of lookahead for Hard was tried: 27 of 40 against Fair rather than 25, for five
 * times the time, so it looks three.
 */
const TUNING: Record<Exclude<Level, 'easy'>, [number, number, number, number]> = {
  fair: [2, 1.2, 3, 0.35],
  hard: [3, 0.01, 3, 1.5],
}

export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const me = g.turn
  const other: Who = me === 0 ? 1 : 0
  const walk = (): Move => {
    const way = path(g, me)
    const ok = steps(g)
    // the next square of the way, or a hop or sidestep when the other side stands on it
    const want = ok.find(([r, c]) => way.some(([wr, wc]) => wr === r && wc === c))
    if (want) return { kind: 'step', to: want }
    let best = ok[0]
    let bd = Infinity
    for (const s of ok) {
      const d = distFrom(g, s, goalRow(g, me))
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return { kind: 'step', to: best }
  }
  // a winning step is always taken, at every level
  const goal = steps(g).find(([r]) => r === goalRow(g, me))
  if (goal) return { kind: 'step', to: goal }
  if (level === 'easy') {
    if (g.left[me] > 0 && rand() < 0.25) {
      const ideas = fenceIdeas(g, other, 6)
      if (ideas.length) return ideas[Math.floor(rand() * ideas.length)]
    }
    return walk()
  }
  const [reach, slack, depth, keep] = TUNING[level]
  let best: Move = walk()
  let bv = -Infinity
  // the walk goes first so that, all else equal, the computer moves rather than fences
  const opts = [best, ...options(g, reach + 2)]
  for (const m of opts) {
    const v = search(play(g, m), depth - 1, -Infinity, Infinity, me, reach, keep) + rand() * slack
    if (v > bv) {
      bv = v
      best = m
    }
  }
  return best
}

/* ---------------------------------------------------------------------------- what is kept */

export const FENCES_KEY = 'lab_fences_v1'
export const THEMES = ['meadow', 'slate', 'sand'] as const
export type Tally = { won: number; lost: number; best: number }
export type Saved = {
  level: Level
  size: Size
  theme: (typeof THEMES)[number]
  /** dot the shortest way for both sides */
  guide: boolean
  /** per level: games won and lost, and the fewest moves you have won in */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 9,
  theme: 'meadow',
  guide: true,
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), best: whole(x.best) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    theme: pick(THEMES, o.theme, EMPTY.theme),
    guide: typeof o.guide === 'boolean' ? o.guide : EMPTY.guide,
    record,
  }
}

/** a seeded game between two levels, for the tests: who won, and in how many plies */
export function match(a: Level, b: Level, seed: number, n: Size = 9, cap = 300) {
  const rand = rng(seed)
  let g = newGame(n, (seed & 1) as Who)
  const lv: [Level, Level] = [a, b]
  while (g.winner === null && g.plies < cap) g = play(g, choose(g, lv[g.turn], rand))
  return { winner: g.winner, plies: g.plies }
}
