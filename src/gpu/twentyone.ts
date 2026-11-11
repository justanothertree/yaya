/**
 * Twenty-one against the house: get closer to 21 than the dealer without going over. Pure — the
 * shoe, the hands, the dealer's fixed rules, the payouts and the book play — so twentyone.test.ts
 * can deal hundreds of thousands of hands without a page; TwentyOneDemo draws the table.
 *
 * Cards are the Hold'em toy's: 0–51, rank = c >> 2 (0 is a two, 12 an ace), suit = c & 3.
 */
import { rankOf, type Card } from './poker'

export type Rules = { decks: 1 | 2 | 6; hitSoft17: boolean }
export const DEFAULT_RULES: Rules = { decks: 6, hitSoft17: false }

/** a card's count: 2–10 at face, picture cards 10, an ace 1 here and 11 when it fits */
export const pips = (c: Card) => {
  const r = rankOf(c)
  return r === 12 ? 1 : Math.min(10, r + 2)
}
export function total(hand: Card[]): { value: number; soft: boolean } {
  let v = 0
  let aces = 0
  for (const c of hand) {
    v += pips(c)
    if (rankOf(c) === 12) aces++
  }
  const soft = aces > 0 && v + 10 <= 21
  return { value: soft ? v + 10 : v, soft }
}
export const isBlackjack = (hand: Card[]) => hand.length === 2 && total(hand).value === 21
export const bust = (hand: Card[]) => total(hand).value > 21

export function shoe(decks: number, rand: () => number): Card[] {
  const cards: Card[] = []
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) cards.push(c)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

/** the dealer draws to 17 and stands, or hits a soft 17 too under that rule */
export function dealerPlays(hand: Card[], draw: () => Card, rules: Rules): Card[] {
  const h = hand.slice()
  for (;;) {
    const t = total(h)
    if (t.value > 17 || (t.value === 17 && !(t.soft && rules.hitSoft17))) return h
    h.push(draw())
  }
}

/**
 * What a hand wins, per unit bet: 1.5 for a blackjack the dealer does not match, 1 for a win, 0 for
 * a push, -1 for a loss — and double that for a doubled hand. A blackjack after a split is just 21.
 */
export function settle(
  player: Card[],
  dealer: Card[],
  doubled: boolean,
  fromSplit: boolean,
): number {
  const k = doubled ? 2 : 1
  const pb = isBlackjack(player) && !fromSplit
  const db = isBlackjack(dealer)
  if (pb && db) return 0
  if (pb) return 1.5
  if (db) return -k
  if (bust(player)) return -k
  if (bust(dealer)) return k
  const p = total(player).value
  const d = total(dealer).value
  return p > d ? k : p < d ? -k : 0
}

/* ---------------------------------------------------------------------------- the book */

export type Act = 'hit' | 'stand' | 'double' | 'split'
/**
 * Basic strategy, the way it is printed on a card for a shoe game where the dealer stands on soft
 * 17: the play that loses least over time for every hand against every dealer card. `up` is the
 * dealer's card showing, as its count (an ace is 11).
 */
export function book(hand: Card[], up: number, canDouble: boolean, canSplit: boolean): Act {
  const t = total(hand)
  const d = up === 1 ? 11 : up
  if (canSplit && hand.length === 2 && pips(hand[0]) === pips(hand[1])) {
    const p = pips(hand[0])
    if (p === 1 || p === 8) return 'split'
    if ((p === 2 || p === 3 || p === 7) && d <= 7) return 'split'
    if (p === 6 && d <= 6) return 'split'
    if (p === 9 && d !== 7 && d <= 9) return 'split'
    if (p === 4 && (d === 5 || d === 6)) return 'split'
  }
  const dbl = (a: Act) => (canDouble ? 'double' : a)
  if (t.soft) {
    const v = t.value
    if (v >= 19) return 'stand'
    if (v === 18) return d <= 6 && d >= 3 ? dbl('stand') : d <= 8 ? 'stand' : 'hit'
    if (v === 17) return d >= 3 && d <= 6 ? dbl('hit') : 'hit'
    if (v >= 15) return d >= 4 && d <= 6 ? dbl('hit') : 'hit'
    return d >= 5 && d <= 6 ? dbl('hit') : 'hit'
  }
  const v = t.value
  if (v >= 17) return 'stand'
  if (v >= 13) return d <= 6 ? 'stand' : 'hit'
  if (v === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit'
  if (v === 11) return dbl('hit')
  if (v === 10) return d <= 9 ? dbl('hit') : 'hit'
  if (v === 9) return d >= 3 && d <= 6 ? dbl('hit') : 'hit'
  return 'hit'
}

/**
 * Play one round with a fixed way of choosing, and return what it won per unit bet. Used by the
 * tests to show what the book is worth; the page plays rounds a step at a time instead.
 */
export function playRound(
  draw: () => Card,
  choose: (hand: Card[], up: number, canDouble: boolean, canSplit: boolean) => Act,
  rules: Rules,
): number {
  const dealer = [draw(), draw()]
  const up = pips(dealer[0])
  const hands: { cards: Card[]; doubled: boolean; split: boolean }[] = [
    { cards: [draw(), draw()], doubled: false, split: false },
  ]
  if (isBlackjack(dealer) || isBlackjack(hands[0].cards))
    return settle(hands[0].cards, dealer, false, false)
  for (let i = 0; i < hands.length; i++) {
    const h = hands[i]
    for (;;) {
      if (total(h.cards).value >= 21) break
      const canSplit =
        h.cards.length === 2 && pips(h.cards[0]) === pips(h.cards[1]) && hands.length < 4
      const a = choose(h.cards, up, h.cards.length === 2, canSplit)
      if (a === 'stand') break
      if (a === 'split' && canSplit) {
        const moved = h.cards.pop()!
        h.split = true
        h.cards.push(draw())
        hands.push({ cards: [moved, draw()], doubled: false, split: true })
        // split aces take one card each and stand
        if (pips(moved) === 1) break
        continue
      }
      h.cards.push(draw())
      if (a === 'double') {
        h.doubled = true
        break
      }
    }
  }
  const live = hands.some((h) => !bust(h.cards))
  const final = live ? dealerPlays(dealer, draw, rules) : dealer
  return hands.reduce((s, h) => s + settle(h.cards, final, h.doubled, h.split), 0)
}

/* ---------------------------------------------------------------------------- what is kept */

export const TWENTYONE_KEY = 'lab_twentyone_v1'
export const START_CHIPS = 1000
export const BETS = [10, 25, 50, 100] as const
export const FELTS = ['green', 'blue', 'red'] as const
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export type Saved = {
  rules: Rules
  felt: (typeof FELTS)[number]
  back: (typeof BACKS)[number]
  hints: boolean
  bet: (typeof BETS)[number]
  chips: number
  /** the most chips ever held, and how many times the bank has had to start you again */
  peak: number
  rebuys: number
  hands: number
  /** how many of your decisions matched the book, and how many there were */
  agreed: number
  decided: number
}
export const EMPTY: Saved = {
  rules: DEFAULT_RULES,
  felt: 'green',
  back: 'lattice',
  hints: false,
  bet: 25,
  chips: START_CHIPS,
  peak: START_CHIPS,
  rebuys: 0,
  hands: 0,
  agreed: 0,
  decided: 0,
}
const count = (v: unknown, max = 1e9) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? Math.floor(v) : null
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
  const r = (typeof o.rules === 'object' && o.rules ? o.rules : {}) as Record<string, unknown>
  const chips = count(o.chips) ?? EMPTY.chips
  const decided = count(o.decided) ?? 0
  return {
    rules: {
      decks: pick([1, 2, 6] as const, r.decks, DEFAULT_RULES.decks),
      hitSoft17: typeof r.hitSoft17 === 'boolean' ? r.hitSoft17 : DEFAULT_RULES.hitSoft17,
    },
    felt: pick(FELTS, o.felt, EMPTY.felt),
    back: pick(BACKS, o.back, EMPTY.back),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    bet: pick(BETS, o.bet, EMPTY.bet),
    chips,
    peak: Math.max(chips, count(o.peak) ?? EMPTY.peak),
    rebuys: count(o.rebuys) ?? 0,
    hands: count(o.hands) ?? 0,
    agreed: Math.min(decided, count(o.agreed) ?? 0),
    decided,
  }
}
