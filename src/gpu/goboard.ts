/**
 * Go on a nine-by-nine board against the computer. Pure — the board, captures, the ko rule, the
 * count at the end and a Monte Carlo computer — so goboard.test.ts can play whole games without a
 * page; GoDemo draws the board.
 *
 * The count is area scoring the Tromp–Taylor way: every stone on the board, and every empty region
 * that touches only one colour, is that colour's, with 6.5 to white for moving second — so there
 * are no ties. ⚠️ THE COUNT TAKES THE BOARD AS IT STANDS: a group both players can see is dead is
 * still counted unless it is captured, so the game is played until it is.
 */

import { whole } from './kept'

export const N = 9
export type Stone = 0 | 1 | 2
export type Who = 1 | 2
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
export const KOMI = 6.5
export const PASS = -1

export type Game = {
  board: Stone[]
  turn: Who
  /** the point that may not be taken back this turn, or -1 */
  ko: number
  passes: number
  /** stones each side has taken */
  taken: [number, number, number]
  over: boolean
  last: number
  moves: number
}
export const newGame = (): Game => ({
  board: Array<Stone>(N * N).fill(0),
  turn: 1,
  ko: -1,
  passes: 0,
  taken: [0, 0, 0],
  over: false,
  last: -2,
  moves: 0,
})

const NEIGH: number[][] = Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N)
  const c = i % N
  const out: number[] = []
  if (r > 0) out.push(i - N)
  if (r < N - 1) out.push(i + N)
  if (c > 0) out.push(i - 1)
  if (c < N - 1) out.push(i + 1)
  return out
})
export const neighbours = (i: number) => NEIGH[i]

/** a stone's whole group and how many liberties it has */
export function group(board: Stone[], i: number): { stones: number[]; liberties: number } {
  const colour = board[i]
  const seen = new Set([i])
  const libs = new Set<number>()
  const todo = [i]
  while (todo.length) {
    const p = todo.pop()!
    for (const q of NEIGH[p]) {
      if (board[q] === 0) libs.add(q)
      else if (board[q] === colour && !seen.has(q)) {
        seen.add(q)
        todo.push(q)
      }
    }
  }
  return { stones: [...seen], liberties: libs.size }
}

/**
 * Put a stone down, or pass. Returns null for a move the rules forbid: an occupied point, the ko,
 * or suicide — a stone whose own group would have no liberty after any captures it makes.
 */
export function play(g: Game, at: number): Game | null {
  if (g.over) return null
  const w = g.turn
  if (at === PASS) {
    const passes = g.passes + 1
    return {
      ...g,
      turn: other(w),
      ko: -1,
      passes,
      over: passes >= 2,
      last: PASS,
      moves: g.moves + 1,
    }
  }
  if (g.board[at] !== 0 || at === g.ko) return null
  const board = g.board.slice()
  board[at] = w
  let caught: number[] = []
  for (const q of NEIGH[at])
    if (board[q] === other(w)) {
      const gr = group(board, q)
      if (gr.liberties === 0) {
        for (const s of gr.stones) board[s] = 0
        caught = caught.concat(gr.stones)
      }
    }
  if (group(board, at).liberties === 0) return null
  // a single stone that took a single stone, and stands alone in the hole it made, cannot be
  // taken straight back: that is the ko
  const mine = group(board, at)
  const ko =
    caught.length === 1 && mine.stones.length === 1 && mine.liberties === 1 ? caught[0] : -1
  const taken: Game['taken'] = [0, g.taken[1], g.taken[2]]
  taken[w] += caught.length
  return { board, turn: other(w), ko, passes: 0, taken, over: false, last: at, moves: g.moves + 1 }
}
export const legal = (g: Game) => g.board.map((_, i) => i).filter((i) => play(g, i) !== null)

/** each side's area: stones, and empty regions that reach only that colour */
export function score(board: Stone[]): { black: number; white: number; owner: Stone[] } {
  const owner = board.slice()
  const seen = new Set<number>()
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== 0 || seen.has(i)) continue
    const region: number[] = []
    const touches = new Set<Stone>()
    const todo = [i]
    seen.add(i)
    while (todo.length) {
      const p = todo.pop()!
      region.push(p)
      for (const q of NEIGH[p]) {
        if (board[q] === 0) {
          if (!seen.has(q)) {
            seen.add(q)
            todo.push(q)
          }
        } else touches.add(board[q])
      }
    }
    if (touches.size === 1) for (const p of region) owner[p] = [...touches][0]
  }
  const black = owner.filter((x) => x === 1).length
  const white = owner.filter((x) => x === 2).length + KOMI
  return { black, white, owner }
}
export const winner = (g: Game): Who => {
  const s = score(g.board)
  return s.black > s.white ? 1 : 2
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** random games played out before each move */
export const PLAYOUTS: Record<Level, number> = { easy: 250, fair: 1200, hard: 2500 }

/** a point that is one side's own eye: every neighbour that side's, so filling it is never wise */
function eye(board: ArrayLike<number>, i: number, w: Who) {
  return NEIGH[i].every((q) => board[q] === w)
}

/*
 * ⚠️ THE PLAYOUTS USE THEIR OWN SCRATCH, NOT `group()`. The first version called `group()` — two
 * Sets per call — for every capture check of every move of every random game, and a single
 * measured game at the hard level had not finished after ten minutes. Here a group is walked with
 * a reused stack and a stamp per point, and stops at the first liberty it finds.
 */
/*
 * ⚠️ THE STAMPS ARE 64-BIT FLOATS ON PURPOSE. Every walk takes a new stamp, and a hard move makes
 * over a million walks, so the count passes 2³¹ within a long sitting. In an Int32Array the
 * stored stamps then wrap negative and never equal the count again: a walk pushes the same points
 * for ever, runs off the end of its 81-place stack (a typed array drops those writes in silence),
 * reads back `undefined` as a point, and throws "NEIGH[p] is not iterable" — which one measuring
 * run did, after some hundreds of millions of walks. A float holds every whole number to 2⁵³.
 */
const stamp = new Float64Array(N * N)
const stack = new Int32Array(N * N)
let gen = 0
/** start the stamp count anywhere, so a test can put it past 2³¹ without a billion walks first */
export const stampsFrom = (n: number) => {
  gen = n
}
function breathes(board: Int8Array, i: number): boolean {
  gen++
  const colour = board[i]
  let top = 0
  stack[top++] = i
  stamp[i] = gen
  while (top) {
    const p = stack[--top]
    for (const q of NEIGH[p]) {
      if (board[q] === 0) return true
      if (board[q] === colour && stamp[q] !== gen) {
        stamp[q] = gen
        stack[top++] = q
      }
    }
  }
  return false
}
/** the one liberty of the group at i, or -1 if it has none or more than one */
function lastBreath(board: Int8Array, i: number): number {
  gen++
  const colour = board[i]
  let top = 0
  let found = -1
  stack[top++] = i
  stamp[i] = gen
  while (top) {
    const p = stack[--top]
    for (const q of NEIGH[p]) {
      if (board[q] === 0) {
        if (found >= 0 && found !== q) return -1
        found = q
      } else if (board[q] === colour && stamp[q] !== gen) {
        stamp[q] = gen
        stack[top++] = q
      }
    }
  }
  return found
}
function lift(board: Int8Array, i: number) {
  const colour = board[i]
  let top = 0
  stack[top++] = i
  board[i] = 0
  while (top) {
    const p = stack[--top]
    for (const q of NEIGH[p])
      if (board[q] === colour) {
        board[q] = 0
        stack[top++] = q
      }
  }
}
/**
 * Play a game out at random to the end, quickly: no ko check, a move that would be suicide
 * skipped, and never filling one's own eye — the one rule that keeps random play from killing its
 * own groups. At the end the board is all stones and eyes, so each point's owner is plain.
 * Returns black's margin.
 */
function playout(start: Game, rand: () => number): number {
  const board = Int8Array.from(start.board)
  let turn: Who = start.turn
  let passes = 0
  const empties = new Int32Array(N * N)
  let last = start.last
  for (let k = 0; k < 220 && passes < 2; k++) {
    let n = 0
    // first, nearly always: take a group beside the last stone that is down to its last breath.
    // Without this, random games never capture on purpose, a chain in atari lives or dies by
    // chance whatever is played now, and the computer would not take even four stones
    if (last >= 0 && rand() < 0.9)
      for (const q of [last, ...NEIGH[last]])
        if (board[q] === other(turn)) {
          const lib = lastBreath(board, q)
          if (lib >= 0) {
            empties[n++] = lib
            break
          }
        }
    if (!n)
      for (let i = 0; i < N * N; i++) if (board[i] === 0 && !eye(board, i, turn)) empties[n++] = i
    let moved = false
    while (n) {
      const j = Math.floor(rand() * n)
      const at = empties[j]
      empties[j] = empties[--n]
      board[at] = turn
      let caught = false
      for (const q of NEIGH[at])
        if (board[q] === other(turn) && !breathes(board, q)) {
          lift(board, q)
          caught = true
        }
      if (!caught && !breathes(board, at)) {
        board[at] = 0
        continue
      }
      moved = true
      last = at
      break
    }
    if (!moved) {
      // the capture was not playable after all (rare): fall back to any point, once
      last = -1
    }
    passes = moved ? 0 : passes + 1
    turn = other(turn)
  }
  let black = 0
  let white = KOMI
  for (let i = 0; i < N * N; i++) {
    const x = board[i] || (eye(board, i, 1) ? 1 : eye(board, i, 2) ? 2 : 0)
    if (x === 1) black++
    else if (x === 2) white++
  }
  return black - white
}

/**
 * The computer's move: every legal point, and passing, is tried by playing random games out from
 * it, the playouts shared out by a bandit rule so the promising moves get the most, and the move
 * that won most often is played. It passes when the other side has just passed and it is ahead,
 * and when no move wins a fair share.
 */
export function choose(g: Game, level: Level, rand: () => number = Math.random): number {
  const me = g.turn
  if (g.passes === 1 && winner(g) === me) return PASS
  const options = legal(g).filter((i) => !eye(g.board, i, me))
  if (!options.length) return PASS
  // a bias for what any player sees at a glance, added to each move's average: taking stones,
  // saving a group in atari, not walking into atari. Random games alone could not see it — with
  // one side well ahead every move wins nine games in ten, and taking four stones in atari scored
  // 0.891 against 0.897 for a quiet point
  const stats = options.map((at) => {
    const next = play(g, at)!
    const caught = next.taken[me] - g.taken[me]
    const mine = group(next.board, at)
    const saves =
      NEIGH[at].some((q) => g.board[q] === me && group(g.board, q).liberties === 1) &&
      mine.liberties > 1
    const bias = caught
      ? 0.03 * Math.min(5, caught)
      : saves
        ? 0.05
        : mine.liberties === 1
          ? -0.1
          : 0
    return { at, next, n: 0, wins: 0, bias }
  })
  const total = PLAYOUTS[level]
  for (let k = 0; k < total; k++) {
    // upper confidence bound: the best average so far, plus a bonus for the least tried
    let pick = stats[0]
    let bv = -Infinity
    for (const s of stats) {
      const v =
        s.n === 0 ? Infinity : s.wins / s.n + s.bias + 0.7 * Math.sqrt(Math.log(k + 1) / s.n)
      if (v > bv) {
        bv = v
        pick = s
      }
    }
    pick.n++
    // mostly whether it won, partly by how much: a lopsided position wins (or loses) nearly every
    // random game whatever is played, and win-or-lose alone could not see a stone taken
    const margin = playout(pick.next, rand) * (me === 1 ? 1 : -1)
    pick.wins += (margin > 0 ? 0.7 : 0) + 0.3 * (0.5 + 0.5 * Math.tanh(margin / 10))
  }
  // the best average among the moves tried at least half as often as the most tried: with eighty
  // points sharing the playouts, the visit counts at the top come out nearly tied, and picking by
  // them chose a quiet point over taking a stone in atari, 28 visits to 27
  const most = Math.max(...stats.map((x) => x.n))
  const best = stats
    .filter((x) => x.n >= most / 2)
    .reduce((a, x) => (x.wins / x.n + x.bias > a.wins / a.n + a.bias ? x : a))
  // nothing worth playing: every move loses nearly always
  if (best.wins / Math.max(1, best.n) < 0.08 && g.moves > 30) return PASS
  return best.at
}

/* ---------------------------------------------------------------------------- what is kept */

export const GO_KEY = 'lab_go_v1'
export const BOARDS = ['kaya', 'slate', 'bamboo'] as const
export type Tally = { won: number; lost: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  /** shade each point by who would own it if the game were counted now */
  shade: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'kaya',
  shade: true,
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
    record[l] = { won: whole(x.won), lost: whole(x.lost) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    shade: typeof o.shade === 'boolean' ? o.shade : EMPTY.shade,
    record,
  }
}
