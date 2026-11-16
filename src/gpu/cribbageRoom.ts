import {
  TARGET,
  choosePeg,
  chooseDiscard,
  deal,
  discard,
  other,
  peg,
  show,
  type Level,
  type Round,
  type Who,
} from './cribbage'
import type { Card } from './poker'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Cribbage as a match by turns (src/lab/matches): the toy's own game to 121. A move is a throw of
 * two to the crib, or one card pegged; the toy's `peg` decides who plays next and pegs the gos, the
 * show is counted on the server the moment the last card goes down, and the next hand is dealt
 * through Rules.roll, the deal passing each hand. The friend deals first, so the challenger plays
 * first.
 *
 * ⚠️ THE HANDS, THE CRIB AND THE STARTER ARE KEPT BACK (Rules.hidden) until the show. Both sides
 * throw face down — the one who does not deal first, held sealed until the dealer has thrown too,
 * as the toy's `discard` takes both at once — and only then is the starter cut. Each player fetches
 * their own cards from lab-move. Every finished hand then travels laid down — both hands kept, the
 * crib, the starter and the order the cards were pegged in — so anybody may replay it through the
 * toy's own rules and get the scores exactly; the hand in play is replayed the same way on the
 * server, from what it keeps back.
 */
export type Laid = {
  dealer: Who
  starter: Card
  kept: [Card[], Card[]]
  /** the challenger's two thrown, then the friend's */
  crib: Card[]
  played: { card: Card; by: Who }[]
}
export type CribGame = {
  /** every hand counted, in order */
  past: Laid[]
  /** the hand in play: the toy's own round, its cards known only on the server */
  r: Round
  /** each side's two for the crib, held until both have thrown: only on the server */
  throws: [Card[] | null, Card[] | null]
  thrown: [boolean, boolean]
  known: boolean
}
export type CribMove = { throw: [Card, Card] } | { peg: Card }

/** hands past this many, the match ends where it stands: three times what a game to 121 takes */
export const MAX_HANDS = 40

const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52
const cards = (x: unknown, n?: number): x is Card[] =>
  Array.isArray(x) &&
  (n === undefined || x.length === n) &&
  x.every(isCard) &&
  new Set(x).size === x.length
/** the friend deals the first hand, and the deal passes */
const dealerOf = (hand: number): Who => (hand % 2 === 0 ? 1 : 0)

const fresh = (): CribGame => ({
  past: [],
  r: {
    dealer: 1,
    hands: [[], []],
    kept: [[], []],
    crib: [],
    starter: 0,
    phase: 'discard',
    pile: [],
    played: [],
    turn: 0,
    scores: [0, 0],
    winner: null,
    said: '',
  },
  throws: [null, null],
  thrown: [false, false],
  known: false,
})

function dealt(g: CribGame, rand: () => number): CribGame {
  const r = deal(Math.floor(rand() * 2 ** 32), dealerOf(g.past.length), g.r.scores)
  return { ...g, r, throws: [null, null], thrown: [false, false], known: true }
}

/** whose move: in the throw, the side not dealing first; in the pegging, as the toy's peg says */
export function whoseMove(g: CribGame): Seat | null {
  const { r } = g
  if (r.winner !== null || r.phase === 'over' || g.past.length >= MAX_HANDS) return null
  if (r.phase === 'discard') {
    const pone = other(r.dealer)
    return g.thrown[pone] ? (g.thrown[r.dealer] ? null : r.dealer) : pone
  }
  return r.phase === 'peg' ? r.turn : null
}

/** a finished hand as it is laid down */
const laid = (r: Round): Laid => ({
  dealer: r.dealer,
  starter: r.starter,
  kept: [[...r.kept[0]], [...r.kept[1]]],
  crib: [...r.crib],
  played: r.played.map((p) => ({ ...p })),
})

/** the move, or null if it is not one; on the server, with the cards known, every rule */
function moved(g: CribGame, m: CribMove, s: Seat): CribGame | null {
  if (whoseMove(g) !== s) return null
  const { r } = g
  if ('throw' in m) {
    if (r.phase !== 'discard' || g.thrown[s] || !cards(m.throw, 2)) return null
    const thrown: [boolean, boolean] = [...g.thrown]
    thrown[s] = true
    if (!g.known) return { ...g, thrown }
    if (!m.throw.every((c) => r.hands[s].includes(c))) return null
    const throws: CribGame['throws'] = [...g.throws]
    throws[s] = [...m.throw]
    if (!thrown[0] || !thrown[1]) return { ...g, thrown, throws }
    const next = discard(r, throws[0] as [Card, Card], throws[1] as [Card, Card])
    return { ...g, r: next, thrown, throws: [null, null] }
  }
  if (r.phase !== 'peg' || r.played.some((p) => p.card === m.peg)) return null
  if (!g.known) return g
  const next = peg(r, m.peg)
  if (next === r) return null
  // the last card down: the show is counted at once, and the hand laid down
  if (next.phase === 'show') {
    const counted = show(next)
    return { ...g, r: counted, past: [...g.past, laid(counted)] }
  }
  return { ...g, r: next }
}

/* ---------------------------------------------------------------- the wire ------------------ */

function readLaid(x: unknown): Laid | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { dealer, starter, kept, crib, played } = o
  if ((dealer !== 0 && dealer !== 1) || !isCard(starter)) return null
  if (!Array.isArray(kept) || kept.length !== 2 || !cards(kept[0], 4) || !cards(kept[1], 4))
    return null
  if (!cards(crib, 4) || !Array.isArray(played) || played.length > 8) return null
  const p = played.map((e) => {
    const v = e as { card?: unknown; by?: unknown } | null
    return v && isCard(v.card) && (v.by === 0 || v.by === 1) ? { card: v.card, by: v.by } : null
  })
  if (p.some((e) => !e)) return null
  return {
    dealer,
    starter,
    kept: [[...kept[0]], [...kept[1]]],
    crib: [...crib],
    played: p as Laid['played'],
  }
}

/**
 * A finished hand put through the toy's own rules from its deal: the two throws, then every card
 * pegged in turn as `peg` would have it, then the show. The round it leaves, or null if any step
 * is not one the rules allow, or it does not end where a hand ends.
 */
function replayHand(h: Laid, scores: [number, number]): Round | null {
  const six: [Card[], Card[]] = [
    [...h.kept[0], ...h.crib.slice(0, 2)],
    [...h.kept[1], ...h.crib.slice(2)],
  ]
  const all = [...six[0], ...six[1], h.starter]
  if (new Set(all).size !== 13) return null
  let r: Round = {
    dealer: h.dealer,
    hands: six,
    kept: [[], []],
    crib: [],
    starter: h.starter,
    phase: 'discard',
    pile: [],
    played: [],
    turn: other(h.dealer),
    scores: [...scores],
    winner: null,
    said: '',
  }
  r = discard(r, [h.crib[0], h.crib[1]], [h.crib[2], h.crib[3]])
  for (const p of h.played) {
    if (r.phase !== 'peg' || r.turn !== p.by) return null
    const next = peg(r, p.card)
    if (next === r) return null
    r = next
  }
  if (r.phase === 'show') r = show(r)
  return r.phase === 'done' || r.phase === 'over' ? r : null
}

/** the match anybody in it may see; every finished hand replayed, so the scores are what they say */
export function replayPublic(x: unknown): CribGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.past) || o.past.length > MAX_HANDS)
    return null
  const past = o.past.map(readLaid)
  if (past.some((h) => !h)) return null
  let scores: [number, number] = [0, 0]
  let end: Round | null = null
  for (let k = 0; k < past.length; k++) {
    const h = past[k]!
    if (h.dealer !== dealerOf(k) || (end && end.phase === 'over')) return null
    end = replayHand(h, scores)
    if (!end) return null
    scores = end.scores
  }
  const { dealer, phase, turn, starter, pile, played, thrown, winner } = o
  if (!Array.isArray(o.scores) || o.scores.length !== 2) return null
  const sc = o.scores as unknown[]
  if (!sc.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= TARGET))
    return null
  if ((turn !== 0 && turn !== 1) || (winner !== null && winner !== 0 && winner !== 1)) return null
  if (!Array.isArray(thrown) || thrown.length !== 2 || !thrown.every((t) => typeof t === 'boolean'))
    return null
  if (!cards(pile) || !Array.isArray(played)) return null
  const pl = played.map((e) => {
    const v = e as { card?: unknown; by?: unknown } | null
    return v && isCard(v.card) && (v.by === 0 || v.by === 1)
      ? { card: v.card, by: v.by as Who }
      : null
  })
  if (pl.some((e) => !e) || pl.length > 8) return null
  const g = fresh()
  if (end && (end.phase === 'over' || past.length >= MAX_HANDS)) {
    // won in a show, or out of hands: the last hand laid down is where the match ends
    if (phase !== end.phase || winner !== end.winner) return null
    return { ...g, past: past as Laid[], r: { ...end }, known: true }
  }
  if (dealer !== dealerOf(past.length)) return null
  if (phase !== 'discard' && phase !== 'peg' && phase !== 'over') return null
  const s0 = sc[0] as number
  const s1 = sc[1] as number
  // the scores only go up from where the counted hands left them
  if (s0 < scores[0] || s1 < scores[1]) return null
  if (phase === 'discard') {
    if (starter !== null || pl.length || pile.length || s0 !== scores[0] || s1 !== scores[1])
      return null
  } else if (!isCard(starter) || !thrown[0] || !thrown[1]) return null
  if (phase === 'over' && (winner === null || [s0, s1][winner as Who] !== TARGET)) return null
  if (phase !== 'over' && winner !== null) return null
  return {
    ...g,
    past: past as Laid[],
    thrown: [thrown[0], thrown[1]],
    r: {
      ...g.r,
      dealer: dealer as Who,
      phase,
      turn,
      starter: (starter ?? 0) as Card,
      pile: [...pile],
      played: pl as Round['played'],
      scores: [s0, s1],
      winner: winner as Who | null,
    },
  }
}

/* ---------------------------------------------------------------- the rules ----------------- */

export const cribRules: Rules<CribGame, CribMove> & {
  roll: (g: CribGame, rand: () => number) => CribGame
} = {
  fresh,
  turn: whoseMove,
  legal: (g, m, by) => {
    const s = whoseMove(g)
    return s !== null && (by === undefined || by === s) && moved(g, m, s) !== null
  },
  apply: (g, m) => {
    const s = whoseMove(g)
    return s === null ? g : (moved(g, m, s) ?? g)
  },
  // a hand counted is followed by the next, the deal passing, unless the game is won
  roll: (g, rand) => (g.r.phase === 'done' && g.past.length < MAX_HANDS ? dealt(g, rand) : g),
  encode: (g) => {
    // a game won in the show ends on the hand laid down; nothing more of it travels
    const r = g.r
    return {
      past: g.past,
      dealer: r.dealer,
      phase: r.phase,
      turn: r.turn,
      starter: r.phase === 'discard' ? null : r.starter,
      pile: r.pile,
      played: r.played,
      scores: r.scores,
      winner: r.winner,
      thrown: g.thrown,
    }
  },
  decode: replayPublic,
  readMove: (x) => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || Object.keys(o).length !== 1) return null
    if ('throw' in o && cards(o.throw, 2)) return { throw: [o.throw[0], o.throw[1]] }
    if ('peg' in o && isCard(o.peg)) return { peg: o.peg }
    return null
  },
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: ['easy', 'fair', 'hard'],
    choose: (g, level) =>
      g.r.phase === 'discard'
        ? { throw: chooseDiscard(g.r, whoseMove(g) ?? 1, level as Level, Math.random) }
        : { peg: choosePeg(g.r, level as Level, Math.random) },
  },
  result: (g) => {
    if (whoseMove(g) !== null) return null
    const [a, b] = g.r.scores
    return g.r.winner ?? (a > b ? 0 : b > a ? 1 : 'draw')
  },
  begun: (g) => g.past.length > 0 || g.thrown.some(Boolean),
  hidden: {
    secret: (g) => ({
      hands: g.r.hands,
      kept: g.r.kept,
      crib: g.r.crib,
      starter: g.r.starter,
      throws: g.throws,
    }),
    join: (g, secret) => {
      const o = secret as Record<string, unknown> | null
      if (!o || !Array.isArray(o.hands) || !Array.isArray(o.kept) || !Array.isArray(o.throws))
        return null
      const r = g.r
      let scores: [number, number] = [0, 0]
      let end: Round | null = null
      for (const h of g.past) {
        end = replayHand(h, scores)
        if (!end) return null
        scores = end.scores
      }
      // ended on the last hand laid down (won in its show, or out of hands): nothing is kept back
      if (end && (end.phase === 'over' || g.past.length >= MAX_HANDS)) return { ...g, known: true }
      if (!isCard(o.starter) || !cards(o.crib)) return null
      const [h0, h1] = o.hands
      const [k0, k1] = o.kept
      const [t0, t1] = o.throws
      if (!cards(h0) || !cards(h1)) return null
      if (r.phase !== 'discard' && r.starter !== o.starter) return null
      // the hand in play, replayed from its deal through every throw and card pegged
      if (r.phase === 'discard') {
        for (const [s, t] of [
          [0, t0],
          [1, t1],
        ] as [Seat, unknown][]) {
          if (g.thrown[s] !== (t !== null) || (t !== null && !cards(t, 2))) return null
          if (
            [h0, h1][s].length !== 6 ||
            (t !== null && !(t as Card[]).every((c) => [h0, h1][s].includes(c)))
          )
            return null
        }
        if (new Set([...h0, ...h1, o.starter]).size !== 13) return null
        return {
          ...g,
          r: { ...r, hands: [[...h0], [...h1]], starter: o.starter, scores },
          throws: [
            t0 === null ? null : [...(t0 as Card[])],
            t1 === null ? null : [...(t1 as Card[])],
          ],
          known: true,
        }
      }
      if (!cards(k0, 4) || !cards(k1, 4) || !cards(o.crib, 4) || t0 !== null || t1 !== null)
        return null
      const replayed = replayCurrent(
        { dealer: r.dealer, starter: o.starter, kept: [k0, k1], crib: o.crib, played: r.played },
        scores,
      )
      if (!replayed) return null
      const same =
        JSON.stringify([
          replayed.pile,
          replayed.turn,
          replayed.scores,
          replayed.phase,
          replayed.winner,
        ]) === JSON.stringify([r.pile, r.turn, r.scores, r.phase, r.winner]) &&
        JSON.stringify(replayed.hands) === JSON.stringify([h0, h1])
      return same ? { ...g, r: replayed, known: true } : null
    },
    mine: (g, side) => ({
      hand: g.r.hands[side],
      kept: g.r.phase === 'discard' ? null : g.r.kept[side],
      thrown:
        g.throws[side] ?? (g.r.phase === 'discard' ? null : g.r.crib.slice(side * 2, side * 2 + 2)),
    }),
    // a throw is face down: the history keeps that it happened, never which two
    logged: (m) => ('throw' in m ? { throw: 'face down' } : m),
    accept: (g) => dealt(g, Math.random),
  },
}

/** the hand in play, from its deal through every card pegged so far: the round it is now */
function replayCurrent(h: Laid, scores: [number, number]): Round | null {
  const six: [Card[], Card[]] = [
    [...h.kept[0], ...h.crib.slice(0, 2)],
    [...h.kept[1], ...h.crib.slice(2)],
  ]
  if (new Set([...six[0], ...six[1], h.starter]).size !== 13) return null
  let r: Round = {
    dealer: h.dealer,
    hands: six,
    kept: [[], []],
    crib: [],
    starter: h.starter,
    phase: 'discard',
    pile: [],
    played: [],
    turn: other(h.dealer),
    scores: [...scores],
    winner: null,
    said: '',
  }
  r = discard(r, [h.crib[0], h.crib[1]], [h.crib[2], h.crib[3]])
  for (const p of h.played) {
    if ((r.phase !== 'peg' && r.phase !== 'over') || r.turn !== p.by) return null
    if (r.phase === 'over') return null
    const next = peg(r, p.card)
    if (next === r) return null
    r = next
  }
  return { ...r, said: '' }
}
