/**
 * Backgammon: race fifteen checkers round the board and off it before the other side does,
 * hitting their lone checkers on the way. Pure — the board, every rule about which moves a roll
 * allows, the scoring and the computer — so backgammon.test.ts can play thousands of games
 * without a page; BackgammonDemo draws the board.
 *
 * Points are 0–23. Side 1 moves from 23 down to 0 and bears off below it; side 2 moves from 0 up
 * to 23 and bears off above it. `board[i]` counts checkers: positive for side 1, negative for 2.
 */

import { whole } from './kept'

export type Who = 1 | 2
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
export const BAR = -1
export const OFF = 24
export type Pos = {
  board: number[]
  /** checkers on the bar and borne off, per side (index 0 unused) */
  bar: [number, number, number]
  off: [number, number, number]
}
export type Step = { from: number; to: number; die: number; hit: boolean }

export function startPos(): Pos {
  const board = Array(24).fill(0)
  board[23] = 2
  board[12] = 5
  board[7] = 3
  board[5] = 5
  board[0] = -2
  board[11] = -5
  board[16] = -3
  board[18] = -5
  return { board, bar: [0, 0, 0], off: [0, 0, 0] }
}
const sign = (w: Who) => (w === 1 ? 1 : -1)
const mine = (p: Pos, w: Who, i: number) => p.board[i] * sign(w) > 0
/** how far a point is from home for a side: 1 is the last point before bearing off */
const dist = (w: Who, i: number) => (w === 1 ? i + 1 : 24 - i)
export function pips(p: Pos, w: Who): number {
  let n = p.bar[w] * 25
  for (let i = 0; i < 24; i++) if (mine(p, w, i)) n += Math.abs(p.board[i]) * dist(w, i)
  return n
}
const allHome = (p: Pos, w: Who) =>
  p.bar[w] === 0 && p.board.every((c, i) => c * sign(w) <= 0 || dist(w, i) <= 6)

/** the single steps one die allows a side */
export function stepsFor(p: Pos, w: Who, die: number): Step[] {
  const s = sign(w)
  const out: Step[] = []
  const land = (to: number) => p.board[to] * s >= -1
  if (p.bar[w] > 0) {
    const to = w === 1 ? 24 - die : die - 1
    if (land(to)) out.push({ from: BAR, to, die, hit: p.board[to] * s === -1 })
    return out
  }
  const home = allHome(p, w)
  for (let i = 0; i < 24; i++) {
    if (!mine(p, w, i)) continue
    const to = i - die * s
    if (to >= 0 && to < 24) {
      if (land(to)) out.push({ from: i, to, die, hit: p.board[to] * s === -1 })
    } else if (home) {
      // bearing off: exactly, or with a bigger die when nothing sits further back
      const d = dist(w, i)
      const further = p.board.some((c, j) => c * s > 0 && dist(w, j) > d)
      if (d === die || (d < die && !further)) out.push({ from: i, to: OFF, die, hit: false })
    }
  }
  return out
}

export function apply(p: Pos, w: Who, st: Step): Pos {
  const s = sign(w)
  const board = p.board.slice()
  const bar: Pos['bar'] = [0, p.bar[1], p.bar[2]]
  const off: Pos['off'] = [0, p.off[1], p.off[2]]
  if (st.from === BAR) bar[w]--
  else board[st.from] -= s
  if (st.to === OFF) off[w]++
  else {
    if (st.hit) {
      board[st.to] = 0
      bar[other(w)]++
    }
    board[st.to] += s
  }
  return { board, bar, off }
}

const key = (p: Pos) => `${p.board.join(',')}|${p.bar[1]},${p.bar[2]}|${p.off[1]},${p.off[2]}`
export type Play = { steps: Step[]; pos: Pos }
/**
 * Every whole turn a roll allows, by the rules: use both dice if any way can (all four of a
 * double), and when only one can be used, the larger if it can be. Plays that end in the same
 * position are kept once each unless `all` is set, which the board needs so that any order a
 * person picks the steps in is recognised.
 */
export function plays(p: Pos, w: Who, dice: [number, number], all = false): Play[] {
  const rolls = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice
  const found: Play[] = []
  const walk = (pos: Pos, left: number[], steps: Step[]) => {
    let moved = false
    const tried = new Set<number>()
    for (let k = 0; k < left.length; k++) {
      if (tried.has(left[k])) continue
      tried.add(left[k])
      for (const st of stepsFor(pos, w, left[k])) {
        moved = true
        walk(apply(pos, w, st), [...left.slice(0, k), ...left.slice(k + 1)], [...steps, st])
      }
    }
    if (!moved) found.push({ steps, pos })
  }
  walk(p, rolls, [])
  const most = Math.max(...found.map((f) => f.steps.length))
  let legal = found.filter((f) => f.steps.length === most)
  if (most === 1 && dice[0] !== dice[1]) {
    const big = Math.max(...dice)
    if (legal.some((f) => f.steps[0].die === big))
      legal = legal.filter((f) => f.steps[0].die === big)
  }
  if (all) return legal
  const seen = new Set<string>()
  return legal.filter((f) => {
    const k = key(f.pos)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 1 for a plain win, 2 for a gammon (the loser bore none off), 3 for a backgammon (and still has one on the bar or in the winner's home) */
export function result(p: Pos): { winner: Who; points: number } | null {
  for (const w of [1, 2] as Who[]) {
    if (p.off[w] < 15) continue
    const l = other(w)
    if (p.off[l] > 0) return { winner: w, points: 1 }
    const stuck = p.bar[l] > 0 || p.board.some((c, i) => c * sign(l) > 0 && dist(w, i) <= 6)
    return { winner: w, points: stuck ? 3 : 2 }
  }
  return null
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** whether the two sides can still meet, or it is a pure race */
const contact = (p: Pos) => {
  let lowest2 = 24
  let highest1 = -1
  for (let i = 0; i < 24; i++) {
    if (p.board[i] > 0) highest1 = Math.max(highest1, i)
    if (p.board[i] < 0) lowest2 = Math.min(lowest2, i)
  }
  return p.bar[1] + p.bar[2] > 0 || highest1 > lowest2
}
/** how many of the 36 rolls hit a lone checker of `w` on point `i` directly or with both dice */
function shots(p: Pos, w: Who, i: number): number {
  const them = other(w)
  const s = sign(them)
  let n = 0
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const reach = a === b ? [a, 2 * a, 3 * a, 4 * a] : [a, b, a + b]
      const hit = reach.some((d) => {
        const from = i + d * s
        return (
          (from >= 0 && from < 24 && p.board[from] * s > 0) ||
          (p.bar[them] > 0 && (them === 1 ? 24 : -1) === from)
        )
      })
      if (hit) n++
    }
  return n
}

/** how good a position is for `w`, in rough hundredths of a game */
/**
 * The weights Hard judges with, found by playing settings against Fair over 500 games each. The
 * first guess, 0.6 a shot with 6 for a home point, won 48% — counting the rolls that hit a blot
 * was making it timid, not wise. Halving the shot weight and valuing home points and primes more
 * won 59% on the sweep's dice and 60% (+0.36 points a game) on 500 games it had never seen.
 */
export type Weights = {
  blot: number
  shot: number
  near: number
  aim: number
  home: number
  prime: number
}
export const CAREFUL: Weights = { blot: 2, shot: 0.3, near: 1.3, aim: 0.25, home: 8, prime: 5 }
export function value(p: Pos, w: Who, careful: Weights | null = CAREFUL): number {
  const r = result(p)
  if (r) return r.winner === w ? 1000 * r.points : -1000 * r.points
  const them = other(w)
  let v = (pips(p, them) - pips(p, w)) * 1.0 + (p.off[w] - p.off[them]) * 4
  if (!contact(p)) return v * 1.5
  v -= p.bar[w] * 18
  v += p.bar[them] * 18
  let run = 0
  for (let i = 0; i < 24; i++) {
    const c = p.board[i] * sign(w)
    if (c >= 2) {
      // a made point blocks them, the more so near home and in a row with others
      const d = dist(w, i)
      v += d <= 6 ? (careful?.home ?? 6) : d <= 9 ? 4 : 2
      run++
      if (run >= 3) v += (careful?.prime ?? 4) * (run - 2)
    } else run = 0
    if (c === 1)
      v -= careful
        ? careful.blot + shots(p, w, i) * careful.shot * (dist(w, i) <= 12 ? careful.near : 1)
        : 6
    const t = -c
    if (t === 1) v += careful ? 1 + shots(p, them, i) * careful.aim : 3
  }
  return v
}

/**
 * The computer's turn, all three levels judging the position after the play with `value`:
 * - Easy adds noise, so it misses a good play about as often as it sees one;
 * - Fair treats every lone checker as equally at risk;
 * - Hard counts how many of the 36 rolls hit each lone checker, and how many of its own hit
 *   theirs.
 *
 * ⚠️ NONE OF THEM LOOKS AHEAD, AND HARD ONCE DID. Scoring each play by the opponent's best reply
 * to all 21 rolls took a second a move and LOST to the one-move judge — 27 and then 24 games of
 * 60, either way of reading the replies. A judgement that is only roughly right is made worse by
 * being applied to a thousand positions instead of twenty. And a judge of the race alone was
 * worse still: two of them hit each other back and forth and a game ran past 600 turns.
 */
export function choose(
  p: Pos,
  w: Who,
  dice: [number, number],
  level: Level,
  rand: () => number = Math.random,
  weights: Weights = CAREFUL,
): Play {
  const list = plays(p, w, dice)
  if (list.length === 1) return list[0]
  let best: Play[] = []
  let bv = -Infinity
  for (const pl of list) {
    const v =
      value(pl.pos, w, level === 'hard' ? weights : null) +
      (level === 'easy' ? (rand() - 0.5) * 40 : 0)
    if (v > bv + 1e-9) {
      bv = v
      best = [pl]
    } else if (Math.abs(v - bv) <= 1e-9) best.push(pl)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const BACKGAMMON_KEY = 'lab_backgammon_v1'
export const BOARDS = ['walnut', 'felt', 'marble'] as const
export const CHECKERS = ['classic', 'jewel', 'sweet'] as const
export type Tally = { won: number; lost: number; points: number; against: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  checkers: (typeof CHECKERS)[number]
  /** light up where a picked checker may go */
  hints: boolean
  /** show each side's pip count */
  pips: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, points: 0, against: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'walnut',
  checkers: 'classic',
  hints: true,
  pips: true,
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
    record[l] = {
      won: whole(x.won),
      lost: whole(x.lost),
      points: whole(x.points),
      against: whole(x.against),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    checkers: pick(CHECKERS, o.checkers, EMPTY.checkers),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    pips: typeof o.pips === 'boolean' ? o.pips : EMPTY.pips,
    record,
  }
}
