/**
 * Liar's dice: everyone shakes five dice under a cup and looks only at their own. In turn, each
 * player raises the bid — "at least this many dice on the table show this face" — or calls the last
 * bid a lie. Then every cup is lifted: if the dice bear the bid out the caller loses a die,
 * otherwise the bidder does, and the loser starts the next round. Lose all five and you are out;
 * the last player with dice wins. With ones wild, a one counts as any face — except in a bid on
 * ones themselves, which therefore needs only half as many.
 *
 * Pure, so liars.test.ts can play a few thousand games without a page.
 */
import { rng } from './bricks'

export type Bid = { q: number; f: number }
export type Game = {
  /** each player's dice this round, and how many dice they have left */
  dice: number[][]
  left: number[]
  wild: boolean
  turn: number
  bid: Bid | null
  bidder: number | null
  /** the bids so far this round, in order */
  bids: { who: number; bid: Bid }[]
  /** the last round's showdown, for the page to show while the next round starts */
  shown: null | {
    bid: Bid
    bidder: number
    caller: number
    actual: number
    loser: number
    dice: number[][]
  }
  winner: number | null
  /** the seed for the next roll of the dice, so a game is pure from its start */
  seed: number
}
export const DICE = 5

function roll(left: number[], seed: number): { dice: number[][]; seed: number } {
  const r = rng(seed)
  const dice = left.map((n) =>
    Array.from({ length: n }, () => 1 + Math.floor(r() * 6)).sort((a, b) => a - b),
  )
  return { dice, seed: Math.floor(r() * 2 ** 31) }
}
export function newGame(players: number, seed: number, wild = true, first = 0): Game {
  const left = Array(players).fill(DICE)
  const { dice, seed: next } = roll(left, seed)
  return {
    dice,
    left,
    wild,
    turn: first,
    bid: null,
    bidder: null,
    bids: [],
    shown: null,
    winner: null,
    seed: next,
  }
}
export const total = (g: Game) => g.left.reduce((s, n) => s + n, 0)
/** how many dice on the table bear a face out: the face itself, and ones too when they are wild */
export const countOf = (g: Game, f: number) =>
  g.dice.flat().filter((d) => d === f || (g.wild && f !== 1 && d === 1)).length

/**
 * Whether a bid may follow another. Without wild ones, a raise is more dice, or as many of a higher
 * face. With them, moving onto ones needs only half the dice (rounded up), and moving off ones
 * needs twice as many and one more — because a one counts for every other face.
 */
export function legal(b: Bid, prev: Bid | null, wild: boolean, dice: number): boolean {
  if (!Number.isInteger(b.q) || b.q < 1 || b.q > dice || b.f < 1 || b.f > 6) return false
  if (!prev) return true
  if (!wild || (prev.f !== 1 && b.f !== 1)) return b.q > prev.q || (b.q === prev.q && b.f > prev.f)
  if (prev.f !== 1 && b.f === 1) return b.q >= Math.ceil(prev.q / 2)
  if (prev.f === 1 && b.f === 1) return b.q > prev.q
  return b.q >= prev.q * 2 + 1
}
/** the smallest legal bid on each face after a bid, or null where none fits on the table */
export function cheapest(prev: Bid | null, wild: boolean, dice: number): (Bid | null)[] {
  const out: (Bid | null)[] = []
  for (let f = 1; f <= 6; f++) {
    let q = 1
    while (q <= dice && !legal({ q, f }, prev, wild, dice)) q++
    out.push(q <= dice ? { q, f } : null)
  }
  return out
}
const next = (g: Game, from: number) => {
  for (let k = 1; k <= g.left.length; k++) {
    const p = (from + k) % g.left.length
    if (g.left[p] > 0) return p
  }
  return from
}

export function bid(g: Game, b: Bid): Game {
  if (g.winner !== null || !legal(b, g.bid, g.wild, total(g))) return g
  return {
    ...g,
    bid: b,
    bidder: g.turn,
    bids: [...g.bids, { who: g.turn, bid: b }],
    turn: next(g, g.turn),
    shown: null,
  }
}
/** call the last bid a lie: lift the cups, take a die from whoever was wrong, and roll again */
export function call(g: Game): Game {
  if (g.winner !== null || !g.bid || g.bidder === null) return g
  const actual = countOf(g, g.bid.f)
  const loser = actual >= g.bid.q ? g.turn : g.bidder
  const left = [...g.left]
  left[loser]--
  const alive = left.filter((n) => n > 0).length
  const shown = { bid: g.bid, bidder: g.bidder, caller: g.turn, actual, loser, dice: g.dice }
  const winner = alive === 1 ? left.findIndex((n) => n > 0) : null
  const { dice, seed } = roll(left, g.seed)
  // the loser starts the next round, or whoever is next if that was their last die
  const turn = left[loser] > 0 ? loser : next({ ...g, left }, loser)
  return { ...g, dice, left, seed, bid: null, bidder: null, bids: [], shown, winner, turn }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** the chance at least k of n dice come up, each with chance p */
export function atLeast(k: number, n: number, p: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  let term = Math.pow(1 - p, n)
  let tail = 0
  for (let i = 0; i <= n; i++) {
    if (i >= k) tail += term
    term = (term * (n - i) * p) / ((i + 1) * (1 - p))
  }
  return Math.min(1, Math.max(0, tail))
}
/**
 * How likely a bid is true from where one player sits: their own dice are known, the rest are
 * chances. Fair and Hard also read the other players' bids this round — someone who bid a face
 * probably holds some of it — and count each two such bids as a die more of that face. That one
 * idea is most of the difference between Easy and Fair: without it Fair lost to Easy, whose bids
 * are honest (measured 237 games of 600); with it Fair wins 97%.
 */
export function chance(g: Game, me: number, b: Bid, level: Level): number {
  const own = g.dice[me].filter((d) => d === b.f || (g.wild && b.f !== 1 && d === 1)).length
  const unseen = total(g) - g.dice[me].length
  const p = g.wild && b.f !== 1 ? 1 / 3 : 1 / 6
  let need = b.q - own
  if (level !== 'easy') {
    const told = g.bids.filter(
      (x) => x.who !== me && (x.bid.f === b.f || (g.wild && x.bid.f === 1 && b.f !== 1)),
    ).length
    need -= Math.floor(told * 0.5)
  }
  return atLeast(need, unseen, p)
}

/**
 * The computer's move. Easy believes any bid it would not itself think wild, calls only the
 * ridiculous, and raises on its most common face. Fair works out the chance of the bid from its
 * own dice and calls a lie below about a third; it raises to the likeliest legal bid. Hard does the
 * same reading everyone's bids too, and now and then raises on a face it does not hold, to be
 * believed later.
 */
/** the bids worth considering: the cheapest on each face, and one more of each */
function raises(g: Game): Bid[] {
  const dice = total(g)
  return cheapest(g.bid, g.wild, dice)
    .flatMap((b) => (b ? [b, { q: b.q + 1, f: b.f }] : []))
    .filter((b) => legal(b, g.bid, g.wild, dice))
}
type Move = { kind: 'bid'; bid: Bid } | { kind: 'call' }

/**
 * Fair's move, which is also how Hard imagines everyone else playing. It reads the bids, takes the
 * raise it thinks likeliest true, and calls when the bid on the table is less likely true than its
 * own best raise is false — less a margin, because a call that fails costs a die for certain while
 * a raise is only a risk if somebody calls it.
 */
function fairMove(g: Game, rand: () => number): Move {
  const me = g.turn
  const dice = total(g)
  let best: Bid | null = null
  let bv = -Infinity
  let bestChance = 0
  for (const b of raises(g)) {
    const c = chance(g, me, b, 'fair')
    const v = c - (b.q / dice) * 0.05 + rand() * 0.02
    if (v > bv) {
      bv = v
      best = b
      bestChance = c
    }
  }
  if (g.bid && (!best || chance(g, me, g.bid, 'fair') < 1 - bestChance - 0.2))
    return { kind: 'call' }
  return { kind: 'bid', bid: best ?? { q: 1, f: 2 } }
}

/**
 * Hard thinks before it moves. It deals the other players' hidden dice at random, many times over,
 * and weighs each deal by how well it explains the bids they have made; then for each move it
 * could make, it plays the rest of the round out in every deal with everyone playing Fair, and
 * takes the move that loses it a die least often. Measured on four hundred games it had not been
 * tuned on, it beats Fair 60%. Reading the bids by rule of thumb, bluffing and calling later were
 * all tried first and were no better than Fair on fresh games, however they looked on the games
 * they were tuned on (47.7% against Fair, after 56.8% where it was tuned).
 */
function hardMove(g: Game, rand: () => number): Move {
  const me = g.turn
  const moves: Move[] = []
  if (g.bid) moves.push({ kind: 'call' })
  // its likeliest raises only: the rest are rarely right and cost time
  const ranked = raises(g)
    .map((b) => ({ b, c: chance(g, me, b, 'fair') }))
    .sort((x, y) => y.c - x.c)
    .slice(0, 7)
  for (const { b } of ranked) moves.push({ kind: 'bid', bid: b })
  if (moves.length === 1) return moves[0]
  const lost = new Array(moves.length).fill(0)
  for (let k = 0; k < SAMPLES; k++) {
    const dice = g.dice.map((d, p) =>
      p === me ? d : Array.from({ length: g.left[p] }, () => 1 + Math.floor(rand() * 6)),
    )
    // how likely each player's bids are, holding the dice dealt to them here
    let w = 1
    for (const x of g.bids) {
      if (x.who === me) continue
      const held = dice[x.who].filter(
        (d) => d === x.bid.f || (g.wild && x.bid.f !== 1 && d === 1),
      ).length
      const expect = g.left[x.who] * (g.wild && x.bid.f !== 1 ? 1 / 3 : 1 / 6)
      w *= (1 + held) / (1 + expect)
    }
    const world = { ...g, dice }
    moves.forEach((m, i) => {
      if (playOut(world, m, me, rand)) lost[i] += w
    })
  }
  let best = 0
  for (let i = 1; i < moves.length; i++) if (lost[i] < lost[best]) best = i
  return moves[best]
}
/** deals per decision: a hundred were tried and won no more often than forty (59.5% to 60.3%) */
const SAMPLES = 40
/** finish a round from a move, everyone else playing Fair: whether `me` loses the die */
function playOut(world: Game, first: Move, me: number, rand: () => number): boolean {
  let g = first.kind === 'call' ? call(world) : bid(world, first.bid)
  for (let i = 0; i < 40 && g.shown === null; i++) {
    const m = fairMove(g, rand)
    const before = g
    g = m.kind === 'call' ? call(g) : bid(g, m.bid)
    if (g === before) g = call(g)
  }
  return g.shown !== null && g.shown.loser === me
}

/**
 * The computer's move. Easy bids honestly on its own commonest face and calls only the ridiculous
 * — easy to read, and easy to push into a lie. Fair works out the odds from its own dice and the
 * bids it has heard. Hard plays the round out in its head before each move.
 */
export function decide(g: Game, level: Level, rand: () => number = Math.random): Move {
  const me = g.turn
  if (level === 'easy') {
    const options = raises(g)
    if (g.bid && (chance(g, me, g.bid, 'fair') < 0.08 || !options.length)) return { kind: 'call' }
    const mine = g.dice[me]
    const best = [2, 3, 4, 5, 6].sort(
      (a, b) => mine.filter((d) => d === b).length - mine.filter((d) => d === a).length,
    )[0]
    return { kind: 'bid', bid: options.find((b) => b.f === best) ?? options[0] }
  }
  return level === 'fair' ? fairMove(g, rand) : hardMove(g, rand)
}

/** a whole game between levels (one per seat), for the tests: the winning seat, and its dice left */
export function playGame(levels: Level[], seed: number, wild = true) {
  const rand = rng(seed ^ 0x9e3779b9)
  let g = newGame(levels.length, seed, wild, seed % levels.length)
  for (let i = 0; i < 2000 && g.winner === null; i++) {
    const m = decide(g, levels[g.turn], rand)
    const before = g
    g = m.kind === 'call' ? call(g) : bid(g, m.bid)
    if (g === before) g = call(g)
  }
  return { winner: g.winner, left: g.winner === null ? 0 : g.left[g.winner] }
}

/* --------------------------------------------------------------------------- what is kept */

export const LIARS_KEY = 'lab_liars_v1'
export const CUPS = ['leather', 'tin', 'velvet'] as const
export type Tally = { won: number; lost: number; caught: number; fooled: number }
export type Saved = {
  level: Level
  /** how many computer players: two or three */
  rivals: 2 | 3
  wild: boolean
  cup: (typeof CUPS)[number]
  /** per level: games won and lost, lies you caught and bluffs that got past a caller */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, caught: 0, fooled: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  rivals: 2,
  wild: true,
  cup: 'leather',
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
    record[l] = {
      won: whole(x.won),
      lost: whole(x.lost),
      caught: whole(x.caught),
      fooled: whole(x.fooled),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    rivals: pick([2, 3] as const, o.rivals, EMPTY.rivals),
    wild: typeof o.wild === 'boolean' ? o.wild : EMPTY.wild,
    cup: pick(CUPS, o.cup, EMPTY.cup),
    record,
  }
}
