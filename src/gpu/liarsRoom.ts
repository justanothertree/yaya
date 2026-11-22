import {
  DICE,
  bid,
  call,
  countOf,
  decide,
  legal as bidLegal,
  newGame,
  total,
  type Bid,
  type Game,
  type Level,
} from './liars'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Liar's dice as a match by turns (src/lab/matches): the toy's own game, heads up, five dice each.
 * A move raises the bid or calls it a lie; a call lifts both cups and costs whoever was wrong a die,
 * and the loser opens the next round. Lose all five and the match is lost. Together, the friends
 * share one cup and take its moves in turn against the computer.
 *
 * ⚠️ THE DICE ARE KEPT BACK (Rules.hidden), AND SO IS THE SEED THEY ARE ROLLED FROM. The toy rolls
 * each round from a seed it carries, which is fine where one person plays and would be a give-away
 * here: knowing it, anybody could work out every die still to come. So the dice and the seed live
 * in the match's secret, chosen by the server, and each player fetches their own cup from lab-move.
 * What travels is the table: dice left, the bids this round, and every showdown with both cups as
 * they were lifted — each recounted on its way in, so who lost the die, and the dice each side has
 * left, are what the cups showed.
 */
export type Showdown = NonNullable<Game['shown']>
export type LiarsGame = {
  wild: boolean
  g: Game
  /** every showdown so far, in order */
  past: Showdown[]
  known: boolean
}
export type LiarsMove = { bid: Bid } | { call: true }

export function readLiarsSettings(s: Record<string, unknown>): { wild: boolean } | null {
  const wild = s.wild ?? true
  return typeof wild === 'boolean' ? { wild } : null
}

export const whoseMove = (x: LiarsGame): Seat | null =>
  x.g.winner !== null ? null : (x.g.turn as Seat)

const blankGame = (wild: boolean): Game => ({
  dice: [[], []],
  left: [DICE, DICE],
  wild,
  turn: 0,
  bid: null,
  bidder: null,
  bids: [],
  shown: null,
  winner: null,
  seed: 0,
})
const fresh = (wild: boolean): LiarsGame => ({ wild, g: blankGame(wild), past: [], known: false })

const isFace = (x: unknown) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 6
const isBid = (x: unknown): x is Bid => {
  const o = x as { q?: unknown; f?: unknown } | null
  return (
    !!o &&
    typeof o === 'object' &&
    Number.isInteger(o.q) &&
    (o.q as number) >= 1 &&
    (o.q as number) <= 10 &&
    isFace(o.f)
  )
}

function moved(x: LiarsGame, m: LiarsMove, s: Seat): LiarsGame | null {
  if (whoseMove(x) !== s) return null
  const g = x.g
  if ('call' in m) {
    if (!g.bid || g.bidder === null) return null
    if (!x.known) return x
    const next = call(g)
    return { ...x, g: next, past: [...x.past, next.shown!] }
  }
  if (!bidLegal(m.bid, g.bid, g.wild, total(g))) return null
  return { ...x, g: bid(g, m.bid) }
}

/* ---------------------------------------------------------------- the wire ------------------ */

/** a showdown as it was lifted: the count recounted, and the loser the one the count says */
function readShowdown(x: unknown, wild: boolean): Showdown | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !isBid(o.bid)) return null
  const { bidder, caller, actual, loser, dice } = o
  if ((bidder !== 0 && bidder !== 1) || (caller !== 0 && caller !== 1) || bidder === caller)
    return null
  if (!Array.isArray(dice) || dice.length !== 2) return null
  if (!dice.every((d) => Array.isArray(d) && d.length <= DICE && d.every(isFace))) return null
  const counted = countOf({ ...blankGame(wild), dice: dice as number[][] }, o.bid.f)
  if (actual !== counted) return null
  if (loser !== (counted >= o.bid.q ? caller : bidder)) return null
  return {
    bid: { q: o.bid.q, f: o.bid.f },
    bidder,
    caller,
    actual: counted,
    loser: loser as number,
    dice: (dice as number[][]).map((d) => [...d]),
  }
}

export function replayPublic(wild: boolean, x: unknown): LiarsGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.past) || o.past.length > 2 * DICE) return null
  const past: Showdown[] = []
  const left = [DICE, DICE]
  for (const p of o.past) {
    const s = readShowdown(p, wild)
    if (!s) return null
    // each cup lifted holds as many dice as its side had then, and nothing after the match is won
    if (left.some((n) => n === 0) || s.dice[0].length !== left[0] || s.dice[1].length !== left[1])
      return null
    left[s.loser]--
    past.push(s)
  }
  const { turn, bids } = o
  if (turn !== 0 && turn !== 1) return null
  if (!Array.isArray(bids) || bids.length > 40) return null
  const winner = left[0] === 0 ? 1 : left[1] === 0 ? 0 : null
  let g: Game = { ...blankGame(wild), left: [...left], turn: winner === null ? turn : 0, winner }
  g = { ...g, shown: past.length ? past[past.length - 1] : null }
  if (winner !== null) return bids.length ? null : { wild, g, past, known: false }
  // the round opens with whoever lost the last die; then the bids go in turn, each a raise
  const opener = past.length ? past[past.length - 1].loser : 0
  g = { ...g, turn: opener }
  for (const b of bids) {
    const v = b as { who?: unknown; bid?: unknown } | null
    if (!v || v.who !== g.turn || !isBid(v.bid) || !bidLegal(v.bid, g.bid, wild, total(g)))
      return null
    g = bid(g, v.bid)
  }
  if (g.turn !== turn) return null
  // as the toy does: the last showdown stays on the table until the next round's first bid
  const shown = !bids.length && past.length ? past[past.length - 1] : null
  return { wild, g: { ...g, shown }, past, known: false }
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function liarsRules(wild: boolean): Rules<LiarsGame, LiarsMove> {
  return {
    fresh: () => fresh(wild),
    turn: whoseMove,
    legal: (x, m, by) => {
      const s = whoseMove(x)
      return s !== null && (by === undefined || by === s) && moved(x, m, s) !== null
    },
    apply: (x, m) => {
      const s = whoseMove(x)
      return s === null ? x : (moved(x, m, s) ?? x)
    },
    encode: (x) => ({ past: x.past, turn: x.g.turn, bids: x.g.bids }),
    decode: (x) => replayPublic(wild, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object' || Object.keys(o).length !== 1) return null
      if ('call' in o && o.call === true) return { call: true }
      if ('bid' in o && isBid(o.bid)) return { bid: { q: o.bid.q, f: o.bid.f } }
      return null
    },
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (x, level) => {
        const m = decide(x.g, level as Level, Math.random)
        return m.kind === 'call' ? { call: true } : { bid: m.bid }
      },
    },
    result: (x) => (x.g.winner === null ? null : (x.g.winner as Seat)),
    begun: (x) => x.past.length > 0 || x.g.bids.length > 0,
    hidden: {
      secret: (x) => ({ dice: x.g.dice, seed: x.g.seed }),
      join: (x, secret) => {
        const o = secret as { dice?: unknown; seed?: unknown } | null
        if (!o || !Number.isInteger(o.seed) || !Array.isArray(o.dice) || o.dice.length !== 2)
          return null
        if (x.g.winner !== null) return { ...x, known: true }
        const dice = o.dice as unknown[]
        // each cup holds as many dice as its side has left
        if (!dice.every((d, i) => Array.isArray(d) && d.length === x.g.left[i] && d.every(isFace)))
          return null
        return {
          ...x,
          g: { ...x.g, dice: (dice as number[][]).map((d) => [...d]), seed: o.seed as number },
          known: true,
        }
      },
      mine: (x, side) => x.g.dice[side],
      // a bid is said aloud and a call is a call: nothing in a move is hidden
      logged: (m) => m,
      accept: (x) => {
        const g = newGame(2, Math.floor(Math.random() * 2 ** 31), x.wild, 0)
        return { ...x, g, known: true }
      },
    },
  }
}
