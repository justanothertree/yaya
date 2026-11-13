/**
 * Cribbage for two: you and the computer. Six cards each; two from each go face down to the
 * dealer's crib, and a starter is cut. Then the pegging — cards played in turn towards 31, scoring
 * fifteens, pairs, runs and the last card — and the show, where each hand is counted with the
 * starter: fifteens, pairs, runs, a flush and his nobs, the dealer's crib last. First to 121.
 *
 * Pure, so cribbage.test.ts can count a few thousand hands without a page. Cards are poker.ts's
 * numbers; ranks here are ace-low, from gin.ts.
 */
import { gRank, value } from './gin'
import { shuffled, suitOf, type Card } from './poker'
import { rng } from './bricks'
import { whole } from './kept'

export type Who = 0 | 1
export const other = (w: Who): Who => (w === 0 ? 1 : 0)
export const TARGET = 121
const JACK = 10

/* --------------------------------------------------------------------------- counting */

export type Part = {
  what: 'fifteen' | 'pair' | 'run' | 'flush' | 'nobs'
  cards: Card[]
  points: number
}

/**
 * Every scoring part of a hand of four counted with the starter, as the show reads them out:
 * each fifteen, each pair, each run (a double run is two runs), a flush and his nobs. A crib's
 * flush needs all five cards of a suit; a hand's needs its own four, and the starter adds one.
 */
export function parts(hand: readonly Card[], starter: Card, crib = false): Part[] {
  const all = [...hand, starter]
  const out: Part[] = []
  // fifteens: every combination of two or more cards adding to fifteen
  for (let m = 1; m < 1 << all.length; m++) {
    const set = all.filter((_, i) => m & (1 << i))
    if (set.length > 1 && set.reduce((s, c) => s + value(c), 0) === 15)
      out.push({ what: 'fifteen', cards: set, points: 2 })
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (gRank(all[i]) === gRank(all[j]))
        out.push({ what: 'pair', cards: [all[i], all[j]], points: 2 })
  // runs: the longest stretch of consecutive ranks, once for every way of picking one card a rank
  const byRank = new Map<number, Card[]>()
  for (const c of all) byRank.set(gRank(c), [...(byRank.get(gRank(c)) ?? []), c])
  for (let lo = 0; lo < 13; lo++) {
    if (!byRank.has(lo) || byRank.has(lo - 1)) continue
    let hi = lo
    while (byRank.has(hi + 1)) hi++
    if (hi - lo + 1 < 3) continue
    let ways: Card[][] = [[]]
    for (let r = lo; r <= hi; r++) ways = ways.flatMap((w) => byRank.get(r)!.map((c) => [...w, c]))
    for (const w of ways) out.push({ what: 'run', cards: w, points: w.length })
  }
  const s = suitOf(hand[0])
  if (hand.every((c) => suitOf(c) === s)) {
    if (suitOf(starter) === s) out.push({ what: 'flush', cards: all, points: 5 })
    else if (!crib) out.push({ what: 'flush', cards: [...hand], points: 4 })
  }
  const nob = hand.find((c) => gRank(c) === JACK && suitOf(c) === suitOf(starter))
  if (nob !== undefined) out.push({ what: 'nobs', cards: [nob], points: 1 })
  return out
}
export const score = (hand: readonly Card[], starter: Card, crib = false) =>
  parts(hand, starter, crib).reduce((s, p) => s + p.points, 0)

/** what the card just played scores in the pegging, given the cards in the count before it */
export function pegScore(pile: readonly Card[]): { points: number; why: string[] } {
  const why: string[] = []
  let points = 0
  const count = pile.reduce((s, c) => s + value(c), 0)
  if (count === 15) {
    points += 2
    why.push('fifteen')
  }
  if (count === 31) {
    points += 2
    why.push('thirty-one')
  }
  const last = pile[pile.length - 1]
  let same = 1
  while (same < pile.length && gRank(pile[pile.length - 1 - same]) === gRank(last)) same++
  if (same >= 2) {
    const p = [0, 0, 2, 6, 12][same]
    points += p
    why.push(['', '', 'a pair', 'three of a kind', 'four of a kind'][same])
  }
  // the longest run among the last k cards, in any order
  for (let k = pile.length; k >= 3; k--) {
    const ranks = pile.slice(-k).map(gRank)
    const set = new Set(ranks)
    if (set.size === k && Math.max(...ranks) - Math.min(...ranks) === k - 1) {
      points += k
      why.push(`a run of ${k}`)
      break
    }
  }
  return { points, why }
}

/* --------------------------------------------------------------------------- a hand */

/** discard, then peg, then the show to be counted, then counted ('done'); 'over' when someone has won */
export type Phase = 'discard' | 'peg' | 'show' | 'done' | 'over'
export type Round = {
  dealer: Who
  /** what each side holds: six until the discard, then the four left to peg with */
  hands: [Card[], Card[]]
  /** the four each kept, for the show */
  kept: [Card[], Card[]]
  crib: Card[]
  starter: Card
  phase: Phase
  /** the cards in the current count, and everything pegged this hand */
  pile: Card[]
  played: { card: Card; by: Who }[]
  turn: Who
  scores: [number, number]
  winner: Who | null
  /** what the last thing that happened scored, for the page to say */
  said: string
}

export function deal(seed: number, dealer: Who, scores: [number, number] = [0, 0]): Round {
  const deck = shuffled(rng(seed))
  // the dealer deals the other side first
  const pone = other(dealer)
  const hands: [Card[], Card[]] = [[], []]
  for (let i = 0; i < 12; i++) hands[i % 2 === 0 ? pone : dealer].push(deck[i])
  return {
    dealer,
    hands,
    kept: [[], []],
    crib: [],
    starter: deck[12],
    phase: 'discard',
    pile: [],
    played: [],
    turn: pone,
    scores: [...scores],
    winner: null,
    said: '',
  }
}

const add = (r: Round, w: Who, points: number): Round => {
  if (!points || r.winner !== null) return r
  const scores = [...r.scores] as [number, number]
  scores[w] = Math.min(TARGET, scores[w] + points)
  return scores[w] >= TARGET ? { ...r, scores, winner: w, phase: 'over' } : { ...r, scores }
}

/** both sides' discards to the crib at once; then the starter is turned, and a jack is two to the dealer */
export function discard(r: Round, mine: [Card, Card], theirs: [Card, Card]): Round {
  if (r.phase !== 'discard') return r
  const out = [mine, theirs]
  for (const w of [0, 1] as Who[])
    if (new Set(out[w]).size !== 2 || !out[w].every((c) => r.hands[w].includes(c))) return r
  const hands = r.hands.map((h, w) => h.filter((c) => !out[w].includes(c))) as Round['hands']
  let next: Round = {
    ...r,
    hands,
    kept: [[...hands[0]], [...hands[1]]],
    crib: [...mine, ...theirs],
    phase: 'peg',
    said: '',
  }
  if (gRank(r.starter) === JACK) next = { ...add(next, r.dealer, 2), said: 'heels' }
  return next
}

export const count = (r: Round) => r.pile.reduce((s, c) => s + value(c), 0)
export const canPlay = (r: Round, w: Who) => r.hands[w].filter((c) => count(r) + value(c) <= 31)

/**
 * Peg a card for whoever's turn it is. Afterwards the turn goes to whoever can play next: the
 * other side if they can, the same side again if only it can (the other has said go), and when
 * neither can the last to play pegs one for the go and the count starts again — led by the other
 * side, or by whoever still has cards. The last card of the hand pegs one, unless it made 31.
 */
export function peg(r: Round, card: Card): Round {
  if (r.phase !== 'peg' || r.winner !== null) return r
  const w = r.turn
  if (!canPlay(r, w).includes(card)) return r
  const pile = [...r.pile, card]
  const hands = r.hands.map((h, i) => (i === w ? h.filter((c) => c !== card) : h)) as Round['hands']
  const { points, why } = pegScore(pile)
  let next: Round = add({ ...r, pile, hands, played: [...r.played, { card, by: w }] }, w, points)
  const said = [...why]
  if (next.winner !== null) return { ...next, said: said.join(' and ') }
  const total = pile.reduce((s, c) => s + value(c), 0)
  const fresh = (lead: Who) => {
    const leader = next.hands[lead].length ? lead : other(lead)
    next = { ...next, pile: [], turn: leader }
  }
  if (!hands[0].length && !hands[1].length) {
    if (total !== 31) {
      next = add(next, w, 1)
      said.push('the last card')
    }
    next = { ...next, pile: [], phase: next.winner === null ? 'show' : 'over' }
  } else if (total === 31) fresh(other(w))
  else if (canPlay(next, other(w)).length) next = { ...next, turn: other(w) }
  else if (canPlay(next, w).length) next = { ...next, turn: w }
  else {
    next = add(next, w, 1)
    said.push('a go')
    if (next.winner === null) fresh(other(w))
  }
  return { ...next, said: said.join(' and ') }
}

/**
 * The show, counted in order: the side that did not deal, then the dealer, then the dealer's crib —
 * stopping the moment someone reaches 121, as the rules have it.
 */
export function show(r: Round): Round {
  if (r.phase !== 'show') return r
  const pone = other(r.dealer)
  let next = add(r, pone, score(r.kept[pone], r.starter))
  next = add(next, r.dealer, score(r.kept[r.dealer], r.starter))
  next = add(next, r.dealer, score(r.crib, r.starter, true))
  return { ...next, phase: next.winner === null ? 'done' : 'over' }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** every way to choose two of six, as index pairs */
const PAIRS: [number, number][] = []
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) PAIRS.push([i, j])

/**
 * What two cards thrown into a crib are worth there on average: cribs dealt at random from the
 * cards it cannot see — two more for the other side's throw, and a starter — and counted. A
 * hundred and twenty of them, which costs a few milliseconds and is steadier than any rule of
 * thumb: a hand-written guess (fifteens and pairs with the starter, a bonus for fives) was tried
 * first and made Hard WORSE than Fair, 120 games of 300.
 */
function cribWorth(d: readonly Card[], unseen: readonly Card[], rand: () => number): number {
  const N = 120
  let t = 0
  for (let k = 0; k < N; k++) {
    // three different unseen cards, by picking from a shrinking range and stepping over earlier picks
    const a = Math.floor(rand() * unseen.length)
    let b = Math.floor(rand() * (unseen.length - 1))
    if (b >= a) b++
    let c = Math.floor(rand() * (unseen.length - 2))
    if (c >= Math.min(a, b)) c++
    if (c >= Math.max(a, b)) c++
    t += score([...d, unseen[a], unseen[b]], unseen[c], true)
  }
  return t / N
}

/**
 * The two cards the computer throws to the crib. Easy throws any two. Fair and Hard keep the four
 * that score best on average over every starter that could be cut, and Hard also weighs what the
 * two thrown are worth in the crib — for itself when it deals, against itself when it does not.
 */
export function chooseDiscard(
  r: Round,
  w: Who,
  level: Level,
  rand: () => number = Math.random,
): [Card, Card] {
  const h = r.hands[w]
  if (level === 'easy') {
    const [i, j] = PAIRS[Math.floor(rand() * PAIRS.length)]
    return [h[i], h[j]]
  }
  const unseen: Card[] = []
  for (let c = 0; c < 52; c++) if (!h.includes(c)) unseen.push(c)
  let best = PAIRS[0]
  let bv = -Infinity
  for (const [i, j] of PAIRS) {
    const keep = h.filter((_, k) => k !== i && k !== j)
    let v = 0
    for (const s of unseen) v += score(keep, s)
    v /= unseen.length
    if (level === 'hard') v += (r.dealer === w ? 1 : -1) * cribWorth([h[i], h[j]], unseen, rand)
    v += rand() * 1e-6
    if (v > bv) {
      bv = v
      best = [i, j]
    }
  }
  return [h[best[0]], h[best[1]]]
}

/**
 * The card the computer pegs. Easy and Fair play any card they can — Fair's strength is all in
 * its discard. Hard plays what scores now, less what the other side could score straight back
 * over every card it might hold, which is what stops it leading into a fifteen or leaving a
 * count of 21.
 *
 * Why Fair pegs at random, measured. Cribbage is mostly the cards: with a careful discard and
 * greedy pegging, Fair was level with Hard (257 games of 500), because over a game pegging for
 * the most points now is nearly as good as looking one card further. The gap between a player
 * who thinks about pegging and one who does not is the real one — Hard beats a random-pegging
 * Fair 209 of 300, and that Fair still beats Easy 288 of 300 on its discards alone.
 */
export function choosePeg(r: Round, level: Level, rand: () => number = Math.random): Card {
  const w = r.turn
  const ok = canPlay(r, w)
  if (level !== 'hard') return ok[Math.floor(rand() * ok.length)]
  const seen = new Set<Card>([
    ...r.hands[w],
    ...r.kept[w],
    ...r.played.map((p) => p.card),
    r.starter,
  ])
  const unseen: Card[] = []
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c)
  let best = ok[0]
  let bv = -Infinity
  for (const c of ok) {
    const pile = [...r.pile, c]
    let v = pegScore(pile).points
    const after = pile.reduce((s, x) => s + value(x), 0)
    let reply = 0
    for (const u of unseen) if (after + value(u) <= 31) reply += pegScore([...pile, u]).points
    // the average reply from one unseen card, scaled by how many cards they have to find it in
    v -= (reply / unseen.length) * Math.min(4, r.hands[other(w)].length)
    v += rand() * 1e-6
    if (v > bv) {
      bv = v
      best = c
    }
  }
  return best
}

/** a whole game between two levels, for the tests: who won, and the final scores */
export function match(a: Level, b: Level, seed: number) {
  const rand = rng(seed)
  const lv: [Level, Level] = [a, b]
  let r = deal(Math.floor(rand() * 2 ** 31), (seed & 1) as Who)
  for (let hand = 0; hand < 60 && r.winner === null; hand++) {
    r = discard(r, chooseDiscard(r, 0, lv[0], rand), chooseDiscard(r, 1, lv[1], rand))
    while (r.phase === 'peg') r = peg(r, choosePeg(r, lv[r.turn], rand))
    r = show(r)
    if (r.winner === null) r = deal(Math.floor(rand() * 2 ** 31), other(r.dealer), r.scores)
  }
  return { winner: r.winner, scores: r.scores }
}

/* --------------------------------------------------------------------------- what is kept */

export const CRIBBAGE_KEY = 'lab_cribbage_v1'
export const BOARDS = ['oak', 'walnut', 'mint'] as const
export type Tally = { won: number; lost: number; skunks: number; best: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  /** read each hand's count out part by part at the show */
  spell: boolean
  /** per level: games won and lost, wins by 31 or more (a skunk), and your best hand */
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, skunks: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'oak',
  spell: true,
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
      skunks: whole(x.skunks),
      best: Math.min(29, whole(x.best)),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    spell: typeof o.spell === 'boolean' ? o.spell : EMPTY.spell,
    record,
  }
}
