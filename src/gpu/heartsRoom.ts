import {
  PASS,
  TWO_CLUBS,
  chooseCard,
  choosePass,
  deal,
  handOver,
  legal,
  passTo,
  playCard,
  score,
  startHand,
  type Hand,
  type Level,
} from './hearts'
import type { Card } from './poker'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Hearts as a match by turns (src/lab/matches): the toy's own game for four, to fifty or a hundred.
 * The two friends sit across the table from each other, seats 0 and 2, and the computer takes
 * the seats between, 1 and 3, at the level asked for.
 *
 * ⚠️ WHO WINS WITH FOUR AT THE TABLE AND TWO PLAYERS — A CHOICE, AND WRITTEN DOWN AS ONE. Versus,
 * the two computers only fill the table: the friend with the lower score wins, whoever else is
 * lower. Together, the friends are partners and the pairs' points are added, theirs against the
 * computers'. Hearts has no partners of its own; this is the plainest reading of each mode.
 *
 * ⚠️ THE HANDS ARE KEPT BACK (Rules.hidden): the deal and every pass live in the match's secret.
 * What travels is the order each hand's cards were played in; tricks, leads, points taken, voids
 * and broken hearts are all worked out from it with the toy's own rules, so they cannot be wrong.
 * A finished hand is replayed card by card with `legal`, every card known by then; the hand in
 * play is replayed the same way on the server, from what it keeps back. The computers play inside
 * Rules.roll, on the server, as soon as it is their turn.
 */
export type HeartsGame = {
  end: number
  level: Level
  together: boolean
  /** every finished hand: who led the two of clubs, and its fifty-two cards in the order played */
  past: Played[]
  phase: 'pass' | 'play' | 'between' | 'over'
  /** whether each friend has passed this hand: seats 0 and 2 */
  passed: [boolean, boolean]
  /** the hand in play, by the toy's own rules: its hands empty in a browser */
  h: Hand
  /** who held the two of clubs and led: the one fact about the hand the play order does not carry */
  first: number
  /** the deal and each seat's three passed: only on the server */
  dealt: Card[][] | null
  passes: (Card[] | null)[]
}
export type Played = { first: number; order: Card[] }
export type HeartsMove = { pass: [Card, Card, Card] } | { play: Card }

export const ENDS = [50, 100] as const
export const MAX_HANDS = 40
const isHuman = (seat: number) => seat === 0 || seat === 2

export function readHeartsSettings(
  s: Record<string, unknown>,
): { end: number; level: Level } | null {
  const end = s.end ?? 100
  const level = s.level ?? 'fair'
  if (!(ENDS as readonly unknown[]).includes(end)) return null
  if (level !== 'easy' && level !== 'fair' && level !== 'hard') return null
  return { end: end as number, level }
}

const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52
const cards = (x: unknown, n?: number): x is Card[] =>
  Array.isArray(x) &&
  (n === undefined || x.length === n) &&
  x.every(isCard) &&
  new Set(x).size === x.length

/** a hand begun with nothing known of what anybody holds: for working out the table from the play */
const blank = (leader: number): Hand => ({
  hands: [[], [], [], []],
  trick: [],
  leader,
  turn: leader,
  taken: [[], [], [], []],
  broken: false,
  tricks: 0,
  void: [0, 1, 2, 3].map(() => [false, false, false, false]),
  played: [],
})

/** the seat each card of a play order came from: the two of clubs leads, then round the table */
function seatsOf(order: Card[]): number[] | null {
  if (!order.length) return []
  if (order[0] !== TWO_CLUBS) return null
  const seats: number[] = []
  let h = blank(0)
  for (const c of order) {
    seats.push(h.turn)
    h = playCard(h, c)
  }
  // the first seat is whoever held the two of clubs: the rest follow from it, round the table
  return seats
}

/** a play order put through the toy from a known first seat: the table it leaves */
function tableAfter(order: Card[], first: number): Hand {
  let h = blank(first)
  for (const c of order) h = playCard(h, c)
  return h
}

/**
 * A finished hand checked card by card: each seat's thirteen are the cards it played, round the
 * table from whoever led the two of clubs, and every card must be one the toy's `legal` allows from
 * what that seat held then. The hand it leaves, or null if any card could not have been played.
 *
 * ⚠️ THE FIRST SEAT TRAVELS WITH THE ORDER, AND IS NOT WORKED OUT FROM IT. It cannot be: a hand
 * where everybody always follows suit plays legally from any first seat, and a guess would put
 * each trick's points on the wrong seat. Who led the two of clubs is seen by the whole table.
 */
function replayFinished(p: Played): Hand | null {
  const { first, order } = p
  if (!Number.isInteger(first) || first < 0 || first > 3) return null
  if (!cards(order, 52) || order[0] !== TWO_CLUBS) return null
  const rel = seatsOf(order)!
  const held: Card[][] = [[], [], [], []]
  order.forEach((c, i) => held[(rel[i] + first) % 4].push(c))
  if (held.some((x) => x.length !== 13)) return null
  let h: Hand = { ...blank(first), hands: held.map((x) => [...x]) }
  for (const c of order) {
    if (!legal(h).includes(c)) return null
    h = playCard(h, c)
  }
  return handOver(h) ? h : null
}

/** each table seat's points over the finished hands */
export function totals(g: HeartsGame): number[] {
  const t = [0, 0, 0, 0]
  for (const p of g.past) {
    const h = replayFinished(p)
    if (!h) continue
    score(h).forEach((p, i) => (t[i] += p))
  }
  return t
}
const matchOver = (g: HeartsGame) => Math.max(...totals(g)) >= g.end || g.past.length >= MAX_HANDS

/** the side moving: versus, the friend at seat 0 or 2; together, the team */
const sideOf = (g: HeartsGame, seat: number): Seat => (g.together ? 0 : seat === 0 ? 0 : 1)
/** the friend whose move it is, as a table seat, or null */
function humanUp(g: HeartsGame): number | null {
  if (g.phase === 'pass') return g.passed[0] ? (g.passed[1] ? null : 2) : 0
  if (g.phase === 'play') return isHuman(g.h.turn) ? g.h.turn : null
  return null
}
export const whoseMove = (g: HeartsGame): Seat | null => {
  const s = humanUp(g)
  return s === null ? null : sideOf(g, s)
}

const fresh = (end: number, level: Level, mode?: Mode): HeartsGame => ({
  end,
  level,
  together: mode === 'together',
  past: [],
  phase: 'between',
  passed: [false, false],
  h: blank(0),
  first: 0,
  dealt: null,
  passes: [null, null, null, null],
})

/** a new hand: dealt, and the computers' three to pass chosen at once; no passing every fourth */
function dealt(g: HeartsGame, rand: () => number): HeartsGame {
  const d = deal(rand)
  const way = PASS[g.past.length % 4]
  if (way === 'hold') {
    const h = startHand(d, null, 'hold')
    return {
      ...g,
      phase: 'play',
      passed: [true, true],
      dealt: d,
      passes: [[], [], [], []],
      h,
      first: h.leader,
    }
  }
  const passes: (Card[] | null)[] = [0, 1, 2, 3].map((s) =>
    isHuman(s) ? null : choosePass(d[s], g.level, rand),
  )
  return {
    ...g,
    phase: 'pass',
    passed: [false, false],
    dealt: d,
    passes,
    h: { ...blank(0), hands: d.map((x) => [...x]) },
  }
}

/** a hand finished: kept, and the match over or waiting for the next deal */
function settle(g: HeartsGame): HeartsGame {
  if (g.phase !== 'play' || !handOver(g.h)) return g
  const next = { ...g, past: [...g.past, { first: g.first, order: g.h.played }] }
  return { ...next, phase: matchOver(next) ? 'over' : 'between' }
}

const known = (g: HeartsGame) => !!g.dealt

/** the move, or null if it is not one; on the server, with the hands known, every rule */
function moved(g: HeartsGame, m: HeartsMove, s: Seat): HeartsGame | null {
  const seat = humanUp(g)
  if (seat === null || sideOf(g, seat) !== s) return null
  if ('pass' in m) {
    if (g.phase !== 'pass' || !cards(m.pass, 3)) return null
    const passed: [boolean, boolean] = [...g.passed]
    passed[seat === 0 ? 0 : 1] = true
    if (!known(g)) return { ...g, passed }
    if (!m.pass.every((c) => g.dealt![seat].includes(c))) return null
    const passes = [...g.passes]
    passes[seat] = [...m.pass]
    if (!passed[0] || !passed[1]) return { ...g, passed, passes }
    const way = PASS[g.past.length % 4]
    const h = startHand(g.dealt!, passes as Card[][], way)
    return { ...g, passed, passes, phase: 'play', h, first: h.leader }
  }
  if (g.phase !== 'play' || g.h.played.includes(m.play)) return null
  if (!known(g)) return g
  if (!legal(g.h).includes(m.play)) return null
  return settle({ ...g, h: playCard(g.h, m.play) })
}

/** the computers' turns, and the next deal when a hand is done: only on the server */
function roll(g: HeartsGame, rand: () => number): HeartsGame {
  let cur = g
  for (let k = 0; k < 200; k++) {
    if (cur.phase === 'between') cur = dealt(cur, rand)
    else if (cur.phase === 'play' && !isHuman(cur.h.turn) && known(cur))
      cur = settle({ ...cur, h: playCard(cur.h, chooseCard(cur.h, cur.level, rand)) })
    else break
  }
  return cur
}

/* ---------------------------------------------------------------- the wire ------------------ */

/** the match anybody in it may see; every finished hand replayed card by card */
export function replayPublic(
  end: number,
  level: Level,
  together: boolean,
  x: unknown,
): HeartsGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.past) || o.past.length > MAX_HANDS)
    return null
  const past: Played[] = []
  for (const x of o.past) {
    const p = x as { first?: unknown; order?: unknown } | null
    if (!p || typeof p !== 'object' || !cards(p.order, 52)) return null
    const one = { first: p.first as number, order: [...p.order] }
    if (!replayFinished(one)) return null
    past.push(one)
  }
  const { phase, passed, played, first } = o
  if (phase !== 'pass' && phase !== 'play' && phase !== 'over') return null
  if (!Array.isArray(passed) || passed.length !== 2 || !passed.every((b) => typeof b === 'boolean'))
    return null
  if (!cards(played) || played.length > 52) return null
  if (
    first !== null &&
    (!Number.isInteger(first) || (first as number) < 0 || (first as number) > 3)
  )
    return null
  const g = fresh(end, level, together ? 'together' : 'versus')
  const base = { ...g, past, passed: [passed[0], passed[1]] as [boolean, boolean] }
  if (phase === 'over') {
    if (!matchOver(base) || played.length || first !== null) return null
    return { ...base, phase: 'over' }
  }
  if (matchOver(base)) return null
  if (phase === 'pass') {
    if (played.length || first !== null || (passed[0] && passed[1])) return null
    return { ...base, phase: 'pass' }
  }
  // in play: the passing done (or none this hand), and the table worked out from the play
  if (!passed[0] || !passed[1] || first === null) return null
  if (played.length && played[0] !== TWO_CLUBS) return null
  const h = tableAfter(played, first as number)
  if (handOver(h)) return null
  if (!isHuman(h.turn)) return null
  return { ...base, phase: 'play', h, first: first as number }
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function heartsRules(
  end: number,
  level: Level,
): Rules<HeartsGame, HeartsMove> & {
  roll: (g: HeartsGame, rand: () => number) => HeartsGame
} {
  return {
    fresh: (mode) => fresh(end, level, mode),
    turn: whoseMove,
    friendTurn: (g) => {
      const s = humanUp(g)
      return s === null ? null : s === 0 ? 0 : 1
    },
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && moved(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      return s === null ? g : (moved(g, m, s) ?? g)
    },
    roll,
    encode: (g) => ({
      past: g.past,
      phase: g.phase,
      passed: g.passed,
      played: g.phase === 'play' ? g.h.played : [],
      first: g.phase === 'play' ? g.first : null,
      // the mode decides who wins, so it travels with the state, which only lab-move writes
      together: g.together,
    }),
    decode: (x) => {
      const o = x as Record<string, unknown> | null
      return replayPublic(end, level, !!o && (o as { together?: unknown }).together === true, x)
    },
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object' || Object.keys(o).length !== 1) return null
      if ('pass' in o && cards(o.pass, 3)) return { pass: [o.pass[0], o.pass[1], o.pass[2]] }
      if ('play' in o && isCard(o.play)) return { play: o.play }
      return null
    },
    modes: ['versus', 'together'],
    // the computers are played in `roll`; this is what they would play, never asked by lab-move
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g) => ({ play: chooseCard(g.h, g.level, Math.random) }),
    },
    result: (g) => {
      if (whoseMove(g) !== null || g.phase !== 'over') return null
      const t = totals(g)
      const [a, b] = g.together ? [t[0] + t[2], t[1] + t[3]] : [t[0], t[2]]
      return a < b ? 0 : b < a ? 1 : 'draw'
    },
    begun: (g) => g.past.length > 0 || g.passed.some(Boolean),
    hidden: {
      secret: (g) => ({ dealt: g.dealt, passes: g.passes }),
      join: (g, secret) => {
        const o = secret as { dealt?: unknown; passes?: unknown } | null
        if (!o || !Array.isArray(o.passes) || o.passes.length !== 4) return null
        if (g.phase === 'over') return { ...g }
        const d = o.dealt
        if (!Array.isArray(d) || d.length !== 4 || !d.every((x) => cards(x, 13))) return null
        if (new Set(d.flat()).size !== 52) return null
        const dealtHands = (d as Card[][]).map((x) => [...x])
        const way = PASS[g.past.length % 4]
        const passes = (o.passes as unknown[]).map((p, s) => {
          if (p === null) return null
          if (way === 'hold') return Array.isArray(p) && p.length === 0 ? [] : undefined
          return cards(p, 3) && p.every((c) => dealtHands[s].includes(c)) ? [...p] : undefined
        })
        if (passes.some((p) => p === undefined)) return null
        // the computers pass as the hand is dealt; a friend's three are there once they have passed
        for (let s = 0; s < 4; s++) {
          const has = passes[s] !== null
          const want = isHuman(s) ? g.passed[s === 0 ? 0 : 1] : true
          if (has !== want) return null
        }
        const ready = { ...g, dealt: dealtHands, passes: passes as (Card[] | null)[] }
        if (g.phase === 'pass')
          return { ...ready, h: { ...g.h, hands: dealtHands.map((x) => [...x]) } }
        // in play: the hand replayed from the deal and the passes, every card checked
        let h = startHand(dealtHands, way === 'hold' ? null : (passes as Card[][]), way)
        if (h.leader !== g.first) return null
        for (const c of g.h.played) {
          if (!legal(h).includes(c)) return null
          h = playCard(h, c)
        }
        if (h.turn !== g.h.turn || JSON.stringify(h.trick) !== JSON.stringify(g.h.trick))
          return null
        return { ...ready, h, first: g.first }
      },
      mine: (g, side, seat) => {
        const at = (seat ?? side) === 0 ? 0 : 2
        const way = PASS[g.past.length % 4]
        if (g.phase === 'pass')
          return { hand: g.dealt?.[at] ?? null, passed: g.passes[at], got: null }
        if (g.phase !== 'play') return null
        // what came across in the pass, while the first trick is still to be won
        const from = [0, 1, 2, 3].find((s) => passTo(s, way) === at && s !== at)
        const got = g.h.tricks === 0 && from !== undefined ? g.passes[from] : null
        return { hand: g.h.hands[at], passed: g.passes[at], got }
      },
      // a pass is face down: the history keeps that it happened, never which three
      logged: (m) => ('pass' in m ? { pass: 'face down' } : m),
      accept: (g) => dealt(g, Math.random),
    },
  }
}

/** the seat each card of a hand's play order came from, round the table from the first seat */
export const seatsPlayed = (order: Card[], first: number) =>
  (seatsOf(order) ?? []).map((r) => (r + first) % 4)
