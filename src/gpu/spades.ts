/**
 * Spades for four in two partnerships: you and North against West and East, all three of them the
 * computer. Each hand, everyone bids the tricks they expect to take — or nil, none at all — and
 * the partnership must make the sum of its bids. Spades are trumps and cannot be led until one has
 * been played. Make your bid and score ten a trick, plus one for each trick over, the "bags"; miss
 * it and lose ten a trick. Every ten bags costs a hundred. Nil is worth a hundred, made or lost.
 *
 * Pure, so spades.test.ts can play thousands of hands without a page. Cards are the Hold'em toy's:
 * 0–51, rank = c >> 2 (0 a two, 12 an ace), suit = c & 3 with 0 spades, 1 hearts, 2 diamonds,
 * 3 clubs. Seats run clockwise: 0 you, 1 West, 2 North, 3 East; teams are seat % 2.
 */
import { rankOf, shuffled, suitOf, type Card } from './poker'

export const SPADE = 0
export const teamOf = (seat: number) => seat % 2
export const partnerOf = (seat: number) => (seat + 2) % 4
/** a bid of 0 is nil */
export type Bid = number

export type Hand = {
  hands: Card[][]
  dealer: number
  /** bids in seat order, null until made; bidding starts left of the dealer */
  bids: (Bid | null)[]
  trick: { seat: number; card: Card }[]
  leader: number
  turn: number
  /** tricks each seat has taken */
  won: number[]
  broken: boolean
  tricks: number
  /** suits each seat has shown it holds none of: public, for the computer */
  void: boolean[][]
  played: Card[]
}
const sortHand = (h: Card[]) =>
  h.sort((a, b) => {
    const order = [2, 3, 1, 0] // diamonds, clubs, hearts, spades: trumps at the right
    return order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankOf(a) - rankOf(b)
  })
export function deal(rand: () => number, dealer: number): Hand {
  const d = shuffled(rand)
  const first = (dealer + 1) % 4
  return {
    hands: [0, 1, 2, 3].map((s) => sortHand(d.slice(s * 13, s * 13 + 13))),
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
export const bidding = (h: Hand) => h.bids.some((b) => b === null)
export function bid(h: Hand, b: Bid): Hand {
  const bids = h.bids.slice()
  bids[h.turn] = Math.max(0, Math.min(13, Math.round(b)))
  // round the table from the seat left of the dealer, which is back to that seat, to lead, once
  // the last bid is in
  return { ...h, bids, turn: (h.turn + 1) % 4 }
}

/** the cards a seat may play now */
export function legal(h: Hand, seat = h.turn): Card[] {
  const hand = h.hands[seat]
  if (h.trick.length) {
    const follow = hand.filter((c) => suitOf(c) === suitOf(h.trick[0].card))
    return follow.length ? follow : hand
  }
  // leading: no spade until one has been played, unless spades are all there is
  if (!h.broken) {
    const rest = hand.filter((c) => suitOf(c) !== SPADE)
    if (rest.length) return rest
  }
  return hand
}
/** the winner of a full trick: the highest spade, or failing one the highest of the suit led */
export function winnerOf(trick: { seat: number; card: Card }[]): number {
  let best = trick[0]
  for (const t of trick) {
    const bs = suitOf(best.card)
    const ts = suitOf(t.card)
    if (ts === bs ? rankOf(t.card) > rankOf(best.card) : ts === SPADE) best = t
  }
  return best.seat
}
export function playCard(h: Hand, card: Card): Hand {
  const seat = h.turn
  const hands = h.hands.map((x, i) => (i === seat ? x.filter((c) => c !== card) : x))
  const trick = [...h.trick, { seat, card }]
  const voids = h.void.map((v) => v.slice())
  if (h.trick.length && suitOf(card) !== suitOf(h.trick[0].card))
    voids[seat][suitOf(h.trick[0].card)] = true
  const broken = h.broken || suitOf(card) === SPADE
  const played = [...h.played, card]
  if (trick.length < 4)
    return { ...h, hands, trick, turn: (seat + 1) % 4, broken, void: voids, played }
  const w = winnerOf(trick)
  const won = h.won.map((n, i) => (i === w ? n + 1 : n))
  return {
    ...h,
    hands,
    trick: [],
    leader: w,
    turn: w,
    won,
    broken,
    tricks: h.tricks + 1,
    void: voids,
    played,
  }
}
export const handOver = (h: Hand) => h.tricks === 13

/* ---------------------------------------------------------------------------- the score */

export type Team = { score: number; bags: number }
/**
 * What a finished hand does to each team. Nil bidders stand alone: a hundred for none taken, minus a
 * hundred otherwise, and any tricks they take are bags for the team rather than help with the
 * partner's bid. A team that reaches its bid scores ten a trick and a point a bag; one that does not
 * loses ten a trick. Every tenth bag costs a hundred.
 */
export function scoreHand(bids: Bid[], won: number[], before: Team[]): Team[] {
  return [0, 1].map((t) => {
    const seats = [t, t + 2]
    let score = before[t].score
    let bags = before[t].bags
    let need = 0
    let got = 0
    for (const s of seats) {
      if (bids[s] === 0) {
        score += won[s] === 0 ? 100 : -100
        bags += won[s]
      } else {
        need += bids[s]
        got += won[s]
      }
    }
    if (need > 0) {
      if (got >= need) {
        score += need * 10 + (got - need)
        bags += got - need
      } else score -= need * 10
    } else bags += got
    while (bags >= 10) {
      bags -= 10
      score -= 100
    }
    return { score, bags }
  })
}
export const TARGETS = [200, 300, 500] as const
/** the game is over when a team reaches the target, or falls to minus its half; the higher wins */
export function winnerTeam(teams: Team[], target: number): number | null {
  const up = teams.some((t) => t.score >= target) || teams.some((t) => t.score <= -target / 2)
  if (!up || teams[0].score === teams[1].score) return null
  return teams[0].score > teams[1].score ? 0 : 1
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * The tricks a hand looks good for, the way a player counts them: aces, guarded kings, the top
 * spades, and spades long enough or short side suits that will trump.
 */
export function count(hand: Card[]): number {
  let n = 0
  const bySuit = [0, 1, 2, 3].map((s) => hand.filter((c) => suitOf(c) === s).map(rankOf))
  const spades = bySuit[SPADE]
  for (let s = 1; s < 4; s++) {
    const r = bySuit[s]
    if (r.includes(12)) n += r.length <= 5 ? 1 : 0.7
    if (r.includes(11) && r.length >= 2) n += r.length <= 4 ? 0.8 : 0.5
    if (r.includes(10) && r.length >= 3 && r.length <= 4) n += 0.3
  }
  // spades: the top ones count, and any past the third will usually take a trick
  if (spades.includes(12)) n += 1
  if (spades.includes(11) && spades.length >= 2) n += 0.9
  if (spades.includes(10) && spades.length >= 3) n += 0.6
  n += Math.max(0, spades.length - 3) * 0.85
  // a short side suit lets a spade in, if there is one to spare
  const spare = Math.max(0, spades.length - 1)
  for (let s = 1; s < 4; s++) {
    const len = bySuit[s].length
    if (spare <= 0) break
    if (len === 0) n += Math.min(spare, 2) * 0.7
    else if (len === 1) n += 0.5
  }
  return n
}
/** a hand too weak to take anything: no high spades, few spades, and few high cards anywhere */
export function nilSafe(hand: Card[]): boolean {
  const spades = hand.filter((c) => suitOf(c) === SPADE)
  if (spades.length > 3 || spades.some((c) => rankOf(c) >= 9)) return false
  const high = hand.filter((c) => rankOf(c) >= 10).length
  // a long suit with only low cards is the usual way a nil is set: count the cards under eight
  return high <= 1 && count(hand) < 1.2
}
/** the computer's bid */
export function chooseBid(h: Hand, level: Level, rand: () => number = Math.random): Bid {
  const seat = h.turn
  const hand = h.hands[seat]
  const est = count(hand)
  if (level === 'easy') return Math.max(1, Math.round(est + (rand() - 0.5) * 2))
  const partner = h.bids[partnerOf(seat)]
  if (level === 'hard') return simulatedBid(h, rand)
  // two nils in one team leave nobody to make a bid
  if (nilSafe(hand) && partner !== 0) return 0
  let b = Math.max(1, Math.round(est))
  // with a partner already nil, bid a little more cautiously: some of your tricks go on covering
  if (partner === 0) b = Math.max(1, Math.round(est - 0.3))
  // a team should not bid over thirteen between them
  if (partner !== null && partner > 0) b = Math.min(b, 13 - partner)
  return b
}

/**
 * Hard's bid: the other 39 cards dealt out many ways, bids filled in by the rule of thumb for the
 * seats still to bid, and the hand played to the end by habit — once as a bid, once as a nil. It
 * bids what it took on average, and nil when nil came through most of the time.
 */
function simulatedBid(h: Hand, rand: () => number, samples = 24): Bid {
  const seat = h.turn
  const mine = h.hands[seat]
  const rest = Array.from({ length: 52 }, (_, c) => c).filter((c) => !mine.includes(c))
  const partner = h.bids[partnerOf(seat)]
  // two nils in one team leave nobody to make a bid: beside a nil, nil is not tried at all
  const canNil = partner !== 0
  let took = 0
  let clean = 0
  for (let k = 0; k < samples; k++) {
    const pool = [...rest].sort(() => rand() - 0.5)
    const hands = [0, 1, 2, 3].map((i) => (i === seat ? mine : sortHand(pool.splice(0, 13))))
    const fill = (as: Bid) =>
      h.bids.map((b, i) =>
        i === seat ? as : b !== null ? b : Math.max(1, Math.round(count(hands[i]))),
      )
    const run = (as: Bid) => {
      let sim: Hand = { ...h, hands, bids: fill(as), turn: h.leader }
      while (!handOver(sim)) sim = playCard(sim, habit(sim))
      return sim.won[seat]
    }
    took += run(Math.max(1, Math.round(count(mine))))
    if (canNil && run(0) === 0) clean++
  }
  if (clean / samples >= 0.7) return 0
  const b = Math.max(1, Math.round(took / samples - 0.15))
  return partner !== null && partner > 0 ? Math.min(b, 13 - partner) : b
}

/** a card by the usual habits, with the partnership in mind */
function habit(h: Hand): Card {
  const options = legal(h)
  if (options.length === 1) return options[0]
  const seat = h.turn
  const me = h.bids[seat] ?? 1
  const partner = partnerOf(seat)
  const pBid = h.bids[partner] ?? 1
  const lowest = (cs: Card[]) => cs.reduce((a, c) => (power(c) < power(a) ? c : a))
  const highest = (cs: Card[]) => cs.reduce((a, c) => (power(c) > power(a) ? c : a))
  const teamNeed = [seat, partner]
    .filter((s) => (h.bids[s] ?? 1) > 0)
    .reduce((a, s) => a + (h.bids[s] ?? 0) - h.won[s], 0)
  const theirs = [(seat + 1) % 4, (seat + 3) % 4]
  const theirNil = theirs.find((s) => h.bids[s] === 0 && h.won[s] === 0)
  if (!h.trick.length) {
    if (me === 0) return lowest(options)
    // lead the top card of a side suit while the team still needs tricks, else something low
    const aces = options.filter((c) => suitOf(c) !== SPADE && rankOf(c) === 12)
    if (teamNeed > 0 && aces.length) return aces[0]
    const nonSpade = options.filter((c) => suitOf(c) !== SPADE)
    return lowest(nonSpade.length ? nonSpade : options)
  }
  const best = h.trick.find((t) => t.seat === winnerOf(h.trick))!
  const beats = (c: Card) => winnerOf([...h.trick, { seat, card: c }]) === seat
  const winners = options.filter(beats)
  const losers = options.filter((c) => !beats(c))
  const last = h.trick.length === 3
  // nil: never win, and shed the highest card that still loses
  if (me === 0) return losers.length ? highest(losers) : lowest(options)
  // partner nil and winning it: take it over if we can, to cover them
  if (pBid === 0 && best.seat === partner && winners.length) return lowest(winners)
  // partner winning, and safely so (last to play, or holding a high card): stay low
  if (best.seat === partner && (last || rankOf(best.card) >= 11))
    return losers.length ? lowest(losers) : lowest(options)
  // an opponent on nil and losing this trick so far: keep under them if we can
  if (theirNil !== undefined && best.seat !== theirNil && h.trick.some((t) => t.seat === theirNil))
    if (losers.length && teamNeed <= 0) return highest(losers)
  // the team has its tricks already: no need for bags
  if (teamNeed <= 0)
    return losers.length ? highest(losers) : lowest(winners.length ? winners : options)
  if (winners.length) return lowest(winners)
  return lowest(options)
}
/** how strong a card is in play: a spade over any other suit, then by rank */
const power = (c: Card) => (suitOf(c) === SPADE ? 13 : 0) + rankOf(c)

/**
 * The computer's card. Easy plays by habit but now and then any legal card; Fair by habit; Hard
 * deals the unseen cards out many ways consistent with the voids shown, plays each to the end by
 * habit after each card it could play, and plays the card that does its team best on average.
 */
export function chooseCard(
  h: Hand,
  level: Level,
  rand: () => number = Math.random,
  samples = 20,
): Card {
  const options = legal(h)
  if (options.length === 1) return options[0]
  if (level === 'easy' && rand() < 0.35) return options[Math.floor(rand() * options.length)]
  if (level !== 'hard') return habit(h)
  const seat = h.turn
  const seen = new Set([...h.played, ...h.hands[seat], ...h.trick.map((t) => t.card)])
  const unseen = Array.from({ length: 52 }, (_, c) => c).filter((c) => !seen.has(c))
  const value = new Map<Card, number>(options.map((c) => [c, 0]))
  const blank: Team[] = [
    { score: 0, bags: 0 },
    { score: 0, bags: 0 },
  ]
  for (let k = 0; k < samples; k++) {
    const need = [0, 1, 2, 3].map((i) => (i === seat ? 0 : h.hands[i].length))
    const guess: Card[][] = [[], [], [], []]
    const pool = [...unseen].sort(() => rand() - 0.5)
    let ok = true
    for (const c of pool) {
      const who = [0, 1, 2, 3].filter(
        (i) => i !== seat && guess[i].length < need[i] && !h.void[i][suitOf(c)],
      )
      if (!who.length) {
        ok = false
        break
      }
      guess[who[Math.floor(rand() * who.length)]].push(c)
    }
    if (!ok) {
      const free = [...unseen].sort(() => rand() - 0.5)
      for (let i = 0; i < 4; i++) guess[i] = i === seat ? [] : free.splice(0, need[i])
    }
    for (const card of options) {
      let sim: Hand = { ...h, hands: h.hands.map((x, i) => (i === seat ? x : guess[i])) }
      sim = playCard(sim, card)
      while (!handOver(sim)) sim = playCard(sim, habit(sim))
      const s = scoreHand(sim.bids as Bid[], sim.won, blank)
      const t = teamOf(seat)
      value.set(card, value.get(card)! + s[t].score - s[1 - t].score - s[t].bags * 2)
    }
  }
  let best = options[0]
  for (const c of options) if (value.get(c)! > value.get(best)!) best = c
  return best
}

/** a whole hand played by computers, for the tests: bids and tricks won */
export function playHand(levels: Level[], rand: () => number, dealer = 0) {
  let h = deal(rand, dealer)
  while (bidding(h)) h = bid(h, chooseBid(h, levels[h.turn], rand))
  while (!handOver(h)) h = playCard(h, chooseCard(h, levels[h.turn], rand))
  return { bids: h.bids as Bid[], won: h.won }
}

/* ---------------------------------------------------------------------------- what is kept */

export const SPADES_KEY = 'lab_spades_v1'
export const FELTS = ['green', 'blue', 'red'] as const
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export type Tally = { won: number; played: number; nils: number }
export type Saved = {
  level: Level
  target: (typeof TARGETS)[number]
  felt: (typeof FELTS)[number]
  back: (typeof BACKS)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, played: 0, nils: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  target: 300,
  felt: 'green',
  back: 'lattice',
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
    record[l] = { won: whole(x.won), played: whole(x.played), nils: whole(x.nils) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    target: pick(TARGETS, o.target, EMPTY.target),
    felt: pick(FELTS, o.felt, EMPTY.felt),
    back: pick(BACKS, o.back, EMPTY.back),
    record,
  }
}
