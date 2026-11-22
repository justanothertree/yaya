import { beats, pick, recent, result, type Move, type Round } from './rps'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Rock, paper, scissors as a match by turns (src/lab/matches): first to so many wins. Each round
 * the challenger plays first and the friend answers, and nobody sees a move before both are made.
 *
 * ⚠️ THE FIRST MOVE OF A ROUND IS SEALED (Rules.hidden): kept in the match's secret, never the
 * state, until the answer comes, when the round is shown whole. The state says only that a move is
 * waiting. Without that the friend would simply read it and win every round. The history keeps
 * nothing of a move, for the same reason — the rounds in the state are the record.
 *
 * ⚠️ AND THE COMPUTER MUST NOT PEEK. Together, the team plays first and the computer answers in the
 * same call, on the server, where the sealed move is in the game it is handed. Its choice reads only
 * the rounds already finished, and rpsRoom.test.ts holds it to that: the same rounds with any
 * sealed move give the same answer. Its levels: Easy has a habit to find (it plays round the
 * circle, mostly), Fair plays pure chance, Hard is the toy's own reader of habits.
 */
export type RpsGame = {
  firstTo: number
  /** finished rounds: the challenger's move, then the friend's (or the computer's) */
  rounds: [Move, Move][]
  /** a first move is in: whether the answer is awaited */
  sealed: boolean
  /** what it is: only on the server, until the answer */
  pending: Move | null
}
export type RpsMove = { play: Move }

export const FIRST_TOS = [3, 5, 10] as const
/** rounds past this many, a match ends where it stands: far more than any first-to-ten needs */
export const capOf = (firstTo: number) => firstTo * 20

export function readRpsSettings(s: Record<string, unknown>): { firstTo: number } | null {
  const firstTo = s.firstTo ?? 3
  return (FIRST_TOS as readonly unknown[]).includes(firstTo) ? { firstTo: firstTo as number } : null
}

const isMove = (x: unknown): x is Move => x === 0 || x === 1 || x === 2

/** each side's wins so far */
export const wins = (g: RpsGame): [number, number] => {
  const w: [number, number] = [0, 0]
  for (const [a, b] of g.rounds) {
    const r = result(a, b)
    if (r > 0) w[0]++
    else if (r < 0) w[1]++
  }
  return w
}
const over = (g: RpsGame) =>
  Math.max(...wins(g)) >= g.firstTo || g.rounds.length >= capOf(g.firstTo)

/** whose move: the challenger's to open a round, the friend's to answer it; null when it is over */
export const whoseMove = (g: RpsGame): Seat | null => (over(g) ? null : g.sealed ? 1 : 0)

const fresh = (firstTo: number): RpsGame => ({ firstTo, rounds: [], sealed: false, pending: null })

/** the match anybody in it may see: finished rounds, and whether a first move is waiting */
export function replayPublic(firstTo: number, x: unknown): RpsGame | null {
  const o = x as { rounds?: unknown; sealed?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.rounds) || typeof o.sealed !== 'boolean')
    return null
  if (Object.keys(o).length !== 2) return null
  let g = fresh(firstTo)
  for (const r of o.rounds) {
    if (whoseMove(g) === null || !Array.isArray(r) || r.length !== 2) return null
    if (!isMove(r[0]) || !isMove(r[1])) return null
    g = { ...g, rounds: [...g.rounds, [r[0], r[1]]] }
  }
  if (o.sealed && whoseMove(g) === null) return null
  return { ...g, sealed: o.sealed }
}

/** the computer's answer, from the finished rounds alone */
export function answerFor(rounds: [Move, Move][], level: string, rand: () => number): Move {
  if (level === 'easy') {
    // round the circle from its own last move, three times in four: a habit to be found
    const last = rounds[rounds.length - 1]
    if (last && rand() < 0.75) return beats(last[1])
    return Math.floor(rand() * 3) as Move
  }
  if (level === 'fair') return Math.floor(rand() * 3) as Move
  // the toy's own reader, which sees the player as "me": here, the team
  const h: Round[] = rounds.map(([me, it]) => ({ me, it }))
  return pick(recent(h), rand).it
}

export function rpsRules(firstTo: number): Rules<RpsGame, RpsMove> {
  return {
    fresh: () => fresh(firstTo),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && isMove(m.play)
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      if (s === null || !isMove(m.play)) return g
      if (s === 0) return { ...g, sealed: true, pending: m.play }
      // the answer: the round is whole once the sealed move is known, which is on the server
      if (g.pending === null) return { ...g, sealed: false }
      return { ...g, rounds: [...g.rounds, [g.pending, m.play]], sealed: false, pending: null }
    },
    encode: (g) => ({ rounds: g.rounds, sealed: g.sealed }),
    decode: (x) => replayPublic(firstTo, x),
    readMove: (x) => {
      const o = x as { play?: unknown } | null
      return o && typeof o === 'object' && Object.keys(o).length === 1 && isMove(o.play)
        ? { play: o.play }
        : null
    },
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      // ⚠️ the rounds and nothing else: the sealed move is in `g` here, and must not be read
      choose: (g, level) => ({ play: answerFor(g.rounds, level, Math.random) }),
    },
    result: (g) => {
      if (whoseMove(g) !== null) return null
      const [a, b] = wins(g)
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (g) => g.rounds.length > 0 || g.sealed,
    hidden: {
      secret: (g) => ({ pending: g.pending }),
      join: (g, secret) => {
        const p = (secret as { pending?: unknown } | null)?.pending
        if (p !== null && !isMove(p)) return null
        // a sealed move must be there exactly when the state says one is waiting
        if (g.sealed !== (p !== null)) return null
        return { ...g, pending: p }
      },
      // the challenger may see the move they sealed; nobody else anything
      mine: (g, side) => (side === 0 ? g.pending : null),
      logged: () => ({}),
      // nothing to bring: nothing is sealed until the first round's move
      accept: (g) => g,
    },
  }
}
