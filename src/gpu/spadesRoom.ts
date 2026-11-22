import {
  bid,
  bidding,
  chooseBid,
  chooseCard,
  deal,
  handOver,
  legal,
  playCard,
  scoreHand,
  winnerTeam,
  type Bid,
  type Hand,
  type Level,
  type Team,
} from './spades'
import type { Card } from './poker'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Spades as a match by turns (src/lab/matches): the toy's own partnership game, to 200, 300 or 500.
 * Teams are the toy's, seat % 2: seats 0 and 2 against 1 and 3.
 *
 * ⚠️ WHO SITS WHERE, BY MODE. Versus, each friend is partnered with a computer across the table:
 * the challenger at seat 0 with a computer at 2, the friend at seat 1 with a computer at 3, and the
 * partnerships' scores decide. Together, the friends are partners at 0 and 2, against computers at
 * 1 and 3. The computers play at the level asked for, inside Rules.roll on the server, the moment
 * it is their turn to bid or to play.
 *
 * ⚠️ THE HANDS ARE KEPT BACK (Rules.hidden): the deal lives in the match's secret, and each friend
 * fetches their own hand from lab-move. Bids are public, as at the table. What travels of each hand
 * is its bids and the order its cards were played in; the deal passes each hand, so who led is
 * known, and tricks, voids and broken spades are worked out with the toy's own rules. A finished
 * hand is replayed card by card with `legal` and scored with the toy's own `scoreHand`; the hand in
 * play is replayed the same way on the server, from the deal.
 */
export type SpadesHand = { bids: Bid[]; order: Card[] }
export type SpadesGame = {
  target: number
  level: Level
  together: boolean
  past: SpadesHand[]
  /** the hand in play, by the toy's own rules: its hands empty in a browser */
  h: Hand
  over: boolean
  dealt: Card[][] | null
}
export type SpadesMove = { bid: Bid } | { play: Card }

export const TARGETS = [200, 300, 500] as const
export const MAX_HANDS = 40

export function readSpadesSettings(
  s: Record<string, unknown>,
): { target: number; level: Level } | null {
  const target = s.target ?? 300
  const level = s.level ?? 'fair'
  if (!(TARGETS as readonly unknown[]).includes(target)) return null
  if (level !== 'easy' && level !== 'fair' && level !== 'hard') return null
  return { target: target as number, level }
}

/** the dealer of each hand: the deal passes, and the challenger, left of the first dealer, leads */
export const dealerOf = (hand: number) => (hand + 3) % 4
const humans = (g: { together: boolean }) => (g.together ? [0, 2] : [0, 1])
const isHuman = (g: { together: boolean }, seat: number) => humans(g).includes(seat)

const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52
const cards = (x: unknown, n?: number): x is Card[] =>
  Array.isArray(x) &&
  (n === undefined || x.length === n) &&
  x.every(isCard) &&
  new Set(x).size === x.length
const isBid = (x: unknown): x is Bid =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 13

/** a hand begun with nothing known of what anybody holds, for working out the table from the play */
function blank(dealer: number): Hand {
  const first = (dealer + 1) % 4
  return {
    hands: [[], [], [], []],
    dealer,
    bids: [null, null, null, null],
    trick: [],
    leader: first,
    turn: first,
    won: [0, 0, 0, 0],
    broken: false,
    tricks: 0,
    void: [0, 1, 2, 3].map(() => [false, false, false, false]),
    played: [],
  }
}
/** each seat in the order it bids: round the table from the left of the dealer */
const bidOrder = (dealer: number) => [1, 2, 3, 4].map((i) => (dealer + i) % 4)
/** the table after these bids (by seat) and cards, worked out from the play alone */
function tableAfter(dealer: number, bids: (Bid | null)[], order: Card[], hands?: Card[][]): Hand {
  let h: Hand = hands ? { ...blank(dealer), hands: hands.map((x) => [...x]) } : blank(dealer)
  for (const s of bidOrder(dealer)) {
    if (bids[s] === null) break
    h = bid(h, bids[s]!)
  }
  for (const c of order) h = playCard(h, c)
  return h
}

/**
 * A finished hand checked card by card from its dealer: each seat's thirteen are the cards it
 * played, and each must be one the toy's `legal` allowed from what that seat held then. The hand
 * it leaves, or null.
 */
function replayFinished(p: SpadesHand, dealer: number): Hand | null {
  if (!Array.isArray(p.bids) || p.bids.length !== 4 || !p.bids.every(isBid)) return null
  if (!cards(p.order, 52)) return null
  // who played each card, from the play alone
  const seats: number[] = []
  let t = tableAfter(dealer, p.bids, [])
  for (const c of p.order) {
    seats.push(t.turn)
    t = playCard(t, c)
  }
  const held: Card[][] = [[], [], [], []]
  p.order.forEach((c, i) => held[seats[i]].push(c))
  if (held.some((x) => x.length !== 13)) return null
  let h: Hand = { ...tableAfter(dealer, p.bids, []), hands: held.map((x) => [...x]) }
  for (const c of p.order) {
    if (!legal(h).includes(c)) return null
    h = playCard(h, c)
  }
  return handOver(h) ? h : null
}

/** each team's score and bags over the finished hands */
export function teams(g: { past: SpadesHand[] }): Team[] {
  let t: Team[] = [
    { score: 0, bags: 0 },
    { score: 0, bags: 0 },
  ]
  g.past.forEach((p, k) => {
    const h = replayFinished(p, dealerOf(k))
    if (h) t = scoreHand(p.bids, h.won, t)
  })
  return t
}
const ended = (g: { past: SpadesHand[]; target: number }) =>
  g.past.length >= MAX_HANDS || winnerTeam(teams(g), g.target) !== null

/** the side moving: versus, the challenger's partnership or the friend's; together, the team */
const sideOf = (g: SpadesGame, seat: number): Seat => (g.together ? 0 : seat % 2 === 0 ? 0 : 1)
const humanUp = (g: SpadesGame): number | null =>
  g.over || !isHuman(g, g.h.turn) ? null : g.h.turn
export const whoseMove = (g: SpadesGame): Seat | null => {
  const s = humanUp(g)
  return s === null ? null : sideOf(g, s)
}

const fresh = (target: number, level: Level, mode?: Mode): SpadesGame => ({
  target,
  level,
  together: mode === 'together',
  past: [],
  h: blank(dealerOf(0)),
  over: false,
  dealt: null,
})

function dealt(g: SpadesGame, rand: () => number): SpadesGame {
  const h = deal(rand, dealerOf(g.past.length))
  return { ...g, h, dealt: h.hands.map((x) => [...x]) }
}

/** a hand finished: kept, and the game over or waiting for the next deal */
function settle(g: SpadesGame): SpadesGame {
  if (bidding(g.h) || !handOver(g.h)) return g
  const next = { ...g, past: [...g.past, { bids: g.h.bids as Bid[], order: g.h.played }] }
  return { ...next, over: ended(next), dealt: null }
}

const known = (g: SpadesGame) => !!g.dealt

function moved(g: SpadesGame, m: SpadesMove, s: Seat): SpadesGame | null {
  const seat = humanUp(g)
  if (seat === null || sideOf(g, seat) !== s) return null
  if ('bid' in m) {
    if (!bidding(g.h) || !isBid(m.bid)) return null
    return { ...g, h: bid(g.h, m.bid) }
  }
  if (bidding(g.h) || g.h.played.includes(m.play)) return null
  if (!known(g)) return g
  if (!legal(g.h).includes(m.play)) return null
  return settle({ ...g, h: playCard(g.h, m.play) })
}

/** the computers' bids and cards, and the next deal when a hand is done: only on the server */
function roll(g: SpadesGame, rand: () => number): SpadesGame {
  let cur = g
  for (let k = 0; k < 200 && !cur.over; k++) {
    if (!cur.dealt) cur = dealt(cur, rand)
    else if (isHuman(cur, cur.h.turn)) break
    else if (bidding(cur.h)) cur = { ...cur, h: bid(cur.h, chooseBid(cur.h, cur.level, rand)) }
    else cur = settle({ ...cur, h: playCard(cur.h, chooseCard(cur.h, cur.level, rand)) })
  }
  return cur
}

/* ---------------------------------------------------------------- the wire ------------------ */

/** the match anybody in it may see; every finished hand replayed card by card and scored */
export function replayPublic(target: number, level: Level, x: unknown): SpadesGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.past) || o.past.length > MAX_HANDS)
    return null
  if (typeof o.together !== 'boolean') return null
  const past: SpadesHand[] = []
  for (let k = 0; k < o.past.length; k++) {
    const p = o.past[k] as { bids?: unknown; order?: unknown } | null
    if (!p || typeof p !== 'object' || !Array.isArray(p.bids) || !cards(p.order, 52)) return null
    const one = { bids: [...p.bids] as Bid[], order: [...p.order] }
    if (!replayFinished(one, dealerOf(k))) return null
    // nothing after the game was decided
    if (k < o.past.length - 1 && ended({ past: past.concat(one), target })) return null
    past.push(one)
  }
  const g = fresh(target, level, o.together ? 'together' : 'versus')
  const base = { ...g, past }
  if (ended(base)) {
    if (o.bids !== null || o.played !== null) return null
    return { ...base, over: true }
  }
  const { bids, played } = o
  if (!Array.isArray(bids) || bids.length !== 4 || !cards(played)) return null
  // bids in order round the table from left of the dealer: some made, the rest still to come
  const dealer = dealerOf(past.length)
  const made = bidOrder(dealer).map((s) => bids[s])
  const k = made.findIndex((b) => b === null)
  if (k >= 0 && made.slice(k).some((b) => b !== null)) return null
  if (made.some((b) => b !== null && !isBid(b))) return null
  if (k >= 0 && played.length) return null
  const h = tableAfter(dealer, bids as (Bid | null)[], played)
  if (handOver(h) || !isHuman(base, h.turn)) return null
  return { ...base, h }
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function spadesRules(
  target: number,
  level: Level,
): Rules<SpadesGame, SpadesMove> & { roll: (g: SpadesGame, rand: () => number) => SpadesGame } {
  return {
    fresh: (mode) => fresh(target, level, mode),
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
      bids: g.over ? null : g.h.bids,
      played: g.over ? null : g.h.played,
      // the mode decides who sits where, so it travels with the state, which only lab-move writes
      together: g.together,
    }),
    decode: (x) => replayPublic(target, level, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object' || Object.keys(o).length !== 1) return null
      if ('bid' in o && isBid(o.bid)) return { bid: o.bid }
      if ('play' in o && isCard(o.play)) return { play: o.play }
      return null
    },
    modes: ['versus', 'together'],
    // the computers are played in `roll`; this is what they would do, never asked by lab-move
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g) =>
        bidding(g.h)
          ? { bid: chooseBid(g.h, g.level, Math.random) }
          : { play: chooseCard(g.h, g.level, Math.random) },
    },
    result: (g) => {
      if (!g.over) return null
      const t = teams(g)
      return t[0].score > t[1].score ? 0 : t[1].score > t[0].score ? 1 : 'draw'
    },
    begun: (g) => g.past.length > 0 || g.h.bids.some((b) => b !== null),
    hidden: {
      secret: (g) => ({ dealt: g.dealt }),
      join: (g, secret) => {
        const d = (secret as { dealt?: unknown } | null)?.dealt
        if (g.over) return { ...g }
        if (!Array.isArray(d) || d.length !== 4 || !d.every((x) => cards(x, 13))) return null
        if (new Set(d.flat()).size !== 52) return null
        const hands = (d as Card[][]).map((x) => [...x])
        // the hand in play, replayed from the deal through every bid and card, each card checked
        let h = tableAfter(dealerOf(g.past.length), g.h.bids, [], hands)
        for (const c of g.h.played) {
          if (bidding(h) || !legal(h).includes(c)) return null
          h = playCard(h, c)
        }
        if (h.turn !== g.h.turn || JSON.stringify(h.bids) !== JSON.stringify(g.h.bids)) return null
        return { ...g, h, dealt: hands }
      },
      mine: (g, side, seat) => {
        const who = seat ?? side
        const at = g.together ? (who === 0 ? 0 : 2) : who
        return g.over ? null : { hand: g.h.hands[at], seat: at }
      },
      // a bid is announced and a card is face up: nothing in a move is hidden
      logged: (m) => m,
      accept: (g) => roll(g, Math.random),
    },
  }
}
