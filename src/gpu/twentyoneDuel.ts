import { seeded } from './poker'
import {
  DEFAULT_RULES,
  book,
  bust,
  dealerPlays,
  isBlackjack,
  pips,
  settle,
  shoe,
  total,
  type Act,
} from './twentyone'
import type { Card } from './poker'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Twenty-one as a duel by turns (src/lab/matches): duplicate twenty-one. The server shuffles a
 * shoe for every round, and both sides play the same rounds from the same shoes against the
 * dealer's fixed rules, ten chips a round from a hundred. The most chips at the end wins; the
 * same is a draw. Because both get the same cards, the luck of the deal falls on both alike and
 * what is left between them is the decisions. Together, the friends share a seat and take its
 * rounds in turn, against the computer on the same shoes.
 *
 * ⚠️ THE SHOES AND THE FIRST SIDE'S PLAY ARE KEPT BACK (Rules.hidden). Every round is played again
 * from its seed and the decisions made in it, through the toy's own total, settle and dealer, the
 * way the toy's table deals (TwentyOneDemo: player, dealer, player, dealer; a split hand plays
 * next; split aces take one card each and the dealer turns). While the first side plays, all that
 * travels is how many rounds each side has finished; the cards, and even whether somebody split,
 * would tell the second side what is coming. When the second side's last round ends, the seeds and
 * every decision are shown, and anybody can play the match again.
 *
 * The friend plays first in versus, straight after saying yes; together the team plays first and
 * the computer plays every round of its own, one round a reply, as soon as the team's last round
 * ends. Its levels: Easy never risks a bust (it stands on any hard twelve), Fair plays the dealer's
 * own rule, Hard plays the book.
 */
export const ROUNDS = [5, 10] as const
export const START = 100
export const BET = 10
const RULES = DEFAULT_RULES

export type DuelMove = { act: Act } | { acts: Act[] }
type Plays = [Act[][], Act[][]]
export type TwentyOneGame = {
  rounds: number
  mode: Mode
  /** rounds each side has finished, the challenger's first */
  done: [number, number]
  /** at the end, everything: each round's seed and every decision */
  shown: { seeds: number[]; acts: Plays } | null
  /** only on the server until the end */
  seeds: number[] | null
  acts: Plays | null
}

export function readTwentyOneSettings(s: Record<string, unknown>): { rounds: number } | null {
  const rounds = s.rounds ?? 10
  return (ROUNDS as readonly unknown[]).includes(rounds) ? { rounds: rounds as number } : null
}

/* ---------------------------------------------------------------- one round ----------------- */

export type HandRec = { cards: Card[]; doubled: boolean; split: boolean }
export type RoundView = {
  /** the dealer's cards: the up card alone while the round is being played */
  dealer: Card[]
  hands: HandRec[]
  /** the hand being played, while the round is */
  active: number
  over: boolean
  /** what the round won, in bets (a blackjack 1.5, a doubled loss −2) once it is over */
  won: number | null
}

const shoes = new Map<number, Card[]>()
/** a round's shoe, from its seed: the toy's own shuffle of six decks */
export function shoeOf(seed: number): Card[] {
  let s = shoes.get(seed)
  if (!s) {
    s = shoe(RULES.decks, seeded(seed))
    if (shoes.size > 64) shoes.clear()
    shoes.set(seed, s)
  }
  return s
}

const canSplitHand = (hands: HandRec[], h: HandRec) =>
  h.cards.length === 2 && pips(h.cards[0]) === pips(h.cards[1]) && hands.length < 4

/** the decisions the table would let this hand make now */
export function offered(v: RoundView): Act[] {
  if (v.over) return []
  const h = v.hands[v.active]
  const out: Act[] = ['hit', 'stand']
  if (h.cards.length === 2) out.push('double')
  if (canSplitHand(v.hands, h)) out.push('split')
  return out
}

/**
 * A round played from its shoe with these decisions, as the toy's table plays it: the view it
 * leaves, or null if a decision was not one the table offered, or came after the round was over.
 */
export function playRound(seed: number, acts: readonly Act[]): RoundView | null {
  const cards = shoeOf(seed)
  let at = 0
  const draw = () => cards[at++]
  const p = [draw()]
  const d = [draw()]
  p.push(draw())
  d.push(draw())
  const hands: HandRec[] = [{ cards: p, doubled: false, split: false }]
  const end = (): RoundView => {
    const everyBust = hands.every((h) => bust(h.cards))
    const dealer = everyBust ? d : dealerPlays(d, draw, RULES)
    const won = hands.reduce((s, h) => s + settle(h.cards, dealer, h.doubled, h.split), 0)
    return { dealer, hands, active: hands.length - 1, over: true, won }
  }
  if (isBlackjack(d) || isBlackjack(p)) return acts.length ? null : end()
  let active = 0
  for (let k = 0; k < acts.length; k++) {
    const a = acts[k]
    const v = { dealer: [d[0]], hands, active, over: false, won: null }
    if (!offered(v).includes(a)) return null
    const h = hands[active]
    let finished = false
    if (a === 'hit') {
      h.cards.push(draw())
      finished = total(h.cards).value >= 21
    } else if (a === 'stand') finished = true
    else if (a === 'double') {
      h.doubled = true
      h.cards.push(draw())
      finished = true
    } else {
      const moved = h.cards.pop()!
      h.split = true
      h.cards.push(draw())
      hands.splice(active + 1, 0, { cards: [moved, draw()], doubled: false, split: true })
      // split aces take one card each, and the dealer turns
      if (pips(moved) === 1) return k === acts.length - 1 ? end() : null
    }
    if (finished) {
      if (active + 1 < hands.length) active++
      else return k === acts.length - 1 ? end() : null
    }
  }
  return { dealer: [d[0]], hands, active, over: false, won: null }
}

/** the computer's decision for a hand, by level, from its own cards and the dealer's up card */
function chooseFor(level: string, v: RoundView): Act {
  const h = v.hands[v.active]
  const up = pips(v.dealer[0])
  const t = total(h.cards)
  if (level === 'easy') return !t.soft && t.value >= 12 ? 'stand' : t.value >= 18 ? 'stand' : 'hit'
  if (level === 'fair')
    return t.value > 17 || (t.value === 17 && !(t.soft && RULES.hitSoft17)) ? 'stand' : 'hit'
  const o = offered(v)
  return book(h.cards, up, o.includes('double'), o.includes('split'))
}

/** a whole round as the computer plays it: every decision, made from what it could see then */
export function computerRound(seed: number, level: string): Act[] {
  const acts: Act[] = []
  for (let k = 0; k < 64; k++) {
    const v = playRound(seed, acts)!
    if (v.over) return acts
    acts.push(chooseFor(level, v))
  }
  return acts
}

/* ---------------------------------------------------------------- the match ----------------- */

const firstOf = (mode: Mode): Seat => (mode === 'together' ? 0 : 1)

export const whoseMove = (g: TwentyOneGame): Seat | null => {
  if (g.shown) return null
  const first = firstOf(g.mode)
  if (g.done[first] < g.rounds) return first
  const second = (1 - first) as Seat
  return g.done[second] < g.rounds ? second : null
}

const fresh = (rounds: number, mode: Mode): TwentyOneGame => ({
  rounds,
  mode,
  done: [0, 0],
  shown: null,
  seeds: null,
  acts: null,
})

/** each side's rounds as played: the finished ones and the one in play */
function viewsOf(seeds: number[], acts: Act[][]): RoundView[] | null {
  const out: RoundView[] = []
  for (let r = 0; r < acts.length; r++) {
    const v = playRound(seeds[r], acts[r])
    // only the last round begun may still be in play
    if (!v || (!v.over && r !== acts.length - 1)) return null
    out.push(v)
  }
  return out
}

/** rounds that end as they are dealt, or with a decision, are finished; the next one is begun */
function advance(g: TwentyOneGame): TwentyOneGame {
  const acts: Plays = [g.acts![0].map((a) => [...a]), g.acts![1].map((a) => [...a])]
  const done: [number, number] = [g.done[0], g.done[1]]
  let x: TwentyOneGame = { ...g, acts, done }
  for (let k = 0; k < 4 * g.rounds + 4; k++) {
    const s = whoseMove(x)
    if (s === null) break
    const r = done[s]
    if (acts[s].length <= r) acts[s].push([])
    if (!playRound(g.seeds![r], acts[s][r])!.over) break
    done[s]++
    x = { ...x, done: [done[0], done[1]] }
  }
  if (whoseMove(x) === null) x = { ...x, shown: { seeds: [...g.seeds!], acts } }
  return x
}

/** each side's chips: a hundred, and ten a round for what each round won */
export function chipsOf(seeds: number[], acts: Plays): [number, number] | null {
  const out: number[] = []
  for (const side of acts) {
    const v = viewsOf(seeds, side)
    if (!v) return null
    out.push(START + BET * v.reduce((s, r) => s + (r.won ?? 0), 0))
  }
  return [out[0], out[1]]
}

const isAct = (x: unknown): x is Act =>
  x === 'hit' || x === 'stand' || x === 'double' || x === 'split'
const isSeed = (x: unknown): x is number =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 2 ** 32
const readPlays = (x: unknown, rounds: number): Plays | null => {
  if (!Array.isArray(x) || x.length !== 2) return null
  for (const side of x)
    if (
      !Array.isArray(side) ||
      side.length > rounds ||
      !side.every((r) => Array.isArray(r) && r.length <= 64 && r.every(isAct))
    )
      return null
  return [x[0].map((r: Act[]) => [...r]), x[1].map((r: Act[]) => [...r])]
}

/** the match anybody in it may see: how far each side is, and everything once it is over */
export function replayPublic(rounds: number, x: unknown): TwentyOneGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || Object.keys(o).sort().join() !== 'done,shown,together')
    return null
  const { done, shown, together } = o
  if (typeof together !== 'boolean') return null
  const mode: Mode = together ? 'together' : 'versus'
  if (
    !Array.isArray(done) ||
    done.length !== 2 ||
    !done.every((n) => Number.isInteger(n) && n >= 0 && n <= rounds)
  )
    return null
  const g = { ...fresh(rounds, mode), done: [done[0], done[1]] as [number, number] }
  // the second side begins only when the first has finished
  const first = firstOf(mode)
  if (g.done[first] < rounds && g.done[1 - first] > 0) return null
  if (shown === null) return whoseMove(g) === null ? null : g
  const s = shown as { seeds?: unknown; acts?: unknown }
  if (!s || typeof s !== 'object' || !Array.isArray(s.seeds) || s.seeds.length !== rounds)
    return null
  if (!s.seeds.every(isSeed)) return null
  const acts = readPlays(s.acts, rounds)
  if (!acts || g.done[0] !== rounds || g.done[1] !== rounds) return null
  // every round of both sides played to its end
  for (const side of acts) {
    const v = viewsOf(s.seeds as number[], side)
    if (!v || v.length !== rounds || v.some((r) => !r.over)) return null
  }
  return { ...g, shown: { seeds: [...(s.seeds as number[])], acts } }
}

/* ---------------------------------------------------------------- the rules ----------------- */

function moved(g: TwentyOneGame, m: DuelMove, s: Seat): TwentyOneGame | null {
  if (whoseMove(g) !== s) return null
  const more = 'act' in m ? [m.act] : m.acts
  if (!more.length || !more.every(isAct)) return null
  // in the browser the cards are not known: the server says what the decision did
  if (!g.seeds || !g.acts) return g
  const r = g.done[s]
  const acts: Plays = [g.acts[0], g.acts[1]]
  const now = [...(acts[s][r] ?? []), ...more]
  const v = playRound(g.seeds[r], now)
  // a whole round given at once (the computer's) must finish it
  if (!v || ('acts' in m && !v.over)) return null
  acts[s] = [...acts[s].slice(0, r), now]
  return advance({ ...g, acts })
}

export function twentyOneRules(rounds: number): Rules<TwentyOneGame, DuelMove> {
  return {
    fresh: (mode) => fresh(rounds, mode ?? 'versus'),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && moved(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      return s === null ? g : (moved(g, m, s) ?? g)
    },
    // the mode travels, since it says who plays first
    encode: (g) => ({ done: g.done, shown: g.shown, together: g.mode === 'together' }),
    decode: (x) => replayPublic(rounds, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return null
      const keys = Object.keys(o).join()
      if (keys === 'act' && isAct(o.act)) return { act: o.act }
      if (keys === 'acts' && Array.isArray(o.acts) && o.acts.length <= 64 && o.acts.every(isAct))
        return { acts: [...o.acts] }
      return null
    },
    modes: ['versus', 'together'],
    // together, the friends take the team's rounds in turn: the challenger the first, and so on
    friendTurn: (g) => (whoseMove(g) === 0 ? ((g.done[0] % 2) as Seat) : null),
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      // its own round's shoe, a card at a time as it would see them: nothing of the team's play
      choose: (g, level) => ({ acts: computerRound(g.seeds![g.done[1]], level) }),
    },
    result: (g) => {
      if (!g.shown) return null
      const c = chipsOf(g.shown.seeds, g.shown.acts)!
      return c[0] > c[1] ? 0 : c[1] > c[0] ? 1 : 'draw'
    },
    begun: (g) => g.done[0] + g.done[1] > 0 || !!g.acts?.some((s) => s.some((r) => r.length)),
    hidden: {
      secret: (g) => ({ seeds: g.seeds, acts: g.acts }),
      join: (g, secret) => {
        const o = secret as { seeds?: unknown; acts?: unknown } | null
        if (!o || !Array.isArray(o.seeds) || o.seeds.length !== rounds || !o.seeds.every(isSeed))
          return null
        const acts = readPlays(o.acts, rounds)
        if (!acts) return null
        const seeds = o.seeds as number[]
        if (g.shown) {
          // the end: what is kept back is what is shown
          if (JSON.stringify({ seeds, acts }) !== JSON.stringify(g.shown)) return null
          return { ...g, seeds, acts }
        }
        // each side's rounds as the state counts them: so many finished, and one in play
        for (const s of [0, 1] as const) {
          const v = viewsOf(seeds, acts[s])
          if (!v) return null
          const finished = v.filter((r) => r.over).length
          const inPlay = whoseMove(g) === s ? 1 : 0
          if (finished !== g.done[s] || v.length !== g.done[s] + inPlay) return null
        }
        return { ...g, seeds, acts }
      },
      // a side's own rounds: the finished ones whole, the one in play with the dealer's up card
      mine: (g, side) => {
        if (!g.seeds || !g.acts) return null
        return viewsOf(g.seeds, g.acts[side])
      },
      // a decision says something about the cards (a split, a double): nothing of it is history
      logged: () => ({}),
      accept: (g) => {
        const seeds = Array.from({ length: rounds }, () => Math.floor(Math.random() * 2 ** 32))
        return advance({ ...g, seeds, acts: [[], []] })
      },
    },
  }
}
