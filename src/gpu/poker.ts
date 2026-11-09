/**
 * Texas hold'em for play chips: you and three computer players, no-limit, blinds that rise. Pure —
 * the deck, the hand ranking, the betting and the pots — so poker.test.ts can rank every five-card
 * hand there is and play whole tables without a page.
 *
 * ⚠️ PLAY CHIPS ONLY. Nothing is bought, won or kept but a count of tables won in this browser.
 *
 * ⚠️ THE HAND RANKING IS CHECKED AGAINST THE WHOLE DECK. The test ranks all 2,598,960 five-card
 * hands and counts each kind — 40 straight flushes, 624 fours, 3,744 full houses and so on — against
 * the published counts, so a ranking that is wrong anywhere is wrong in a number.
 *
 * ⚠️ AND THE CHIPS ARE COUNTED. Every hand ends with the same chips on the table as it began, split
 * into a main pot and side pots by what each player could cover; the test plays thousands of hands
 * between random players and checks that nothing is made or lost.
 */

/* ---------------------------------------------------------------------------- cards */

/** a card is 0–51: rank = c >> 2 (0 is a two, 12 an ace), suit = c & 3 */
export type Card = number
export const RANKS = '23456789TJQKA'
export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const rankOf = (c: Card) => c >> 2
export const suitOf = (c: Card) => c & 3
export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const PLURAL = [
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'sevens',
  'eights',
  'nines',
  'tens',
  'jacks',
  'queens',
  'kings',
  'aces',
]
const SINGLE = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'jack',
  'queen',
  'king',
  'ace',
]
export const cardName = (c: Card) => `${RANK_NAMES[rankOf(c)]}${SUITS[suitOf(c)]}`
/** "As" style, for tests */
export const card = (s: string): Card => RANKS.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1])

export function shuffled(rand: () => number): Card[] {
  const d = Array.from({ length: 52 }, (_, i) => i)
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

/* ---------------------------------------------------------------------------- ranking */

export const KINDS = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
] as const

/** the highest straight in a set of ranks (as a bitmask), by its top rank — or -1 */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const run = 0b11111 << (top - 4)
    if ((mask & run) === run) return top
  }
  // the wheel: A-2-3-4-5, which is five-high
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3
  return -1
}

/** a number that orders hands: higher is better, equal is a split */
const score = (kind: number, ...ranks: number[]) => {
  let s = kind
  for (let i = 0; i < 5; i++) s = s * 13 + (ranks[i] ?? 0)
  return s
}

/** the value of the best five-card hand among 5 to 7 cards */
export function rank(cards: readonly Card[]): number {
  const counts = new Array(13).fill(0)
  const suits = [0, 0, 0, 0]
  const bySuit = [0, 0, 0, 0]
  let mask = 0
  for (const c of cards) {
    const r = rankOf(c)
    counts[r]++
    suits[suitOf(c)]++
    bySuit[suitOf(c)] |= 1 << r
    mask |= 1 << r
  }
  const flush = suits.findIndex((n) => n >= 5)
  if (flush >= 0) {
    const top = straightTop(bySuit[flush])
    if (top >= 0) return score(8, top)
  }
  // ranks grouped by how many of each, biggest groups first, then highest rank
  const groups: [number, number][] = []
  for (let r = 12; r >= 0; r--) if (counts[r]) groups.push([counts[r], r])
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1])
  const highest = (exclude: number[], n: number) => {
    const out: number[] = []
    for (let r = 12; r >= 0 && out.length < n; r--)
      if (counts[r] && !exclude.includes(r)) out.push(r)
    return out
  }
  if (groups[0][0] === 4) return score(7, groups[0][1], ...highest([groups[0][1]], 1))
  if (groups[0][0] === 3) {
    const pair = groups.slice(1).find((g) => g[0] >= 2)
    if (pair) return score(6, groups[0][1], pair[1])
  }
  if (flush >= 0) {
    const r: number[] = []
    for (let x = 12; x >= 0 && r.length < 5; x--) if (bySuit[flush] & (1 << x)) r.push(x)
    return score(5, ...r)
  }
  const top = straightTop(mask)
  if (top >= 0) return score(4, top)
  if (groups[0][0] === 3) return score(3, groups[0][1], ...highest([groups[0][1]], 2))
  if (groups[0][0] === 2 && groups[1]?.[0] === 2) {
    const [a, b] = [groups[0][1], groups[1][1]]
    return score(2, a, b, ...highest([a, b], 1))
  }
  if (groups[0][0] === 2) return score(1, groups[0][1], ...highest([groups[0][1]], 3))
  return score(0, ...highest([], 5))
}

export const kindOf = (value: number) => Math.floor(value / 13 ** 5)

/** a hand's name in words: "a full house, kings full of fours" */
export function describe(value: number): string {
  const kind = kindOf(value)
  const r = (i: number) => Math.floor(value / 13 ** (4 - i)) % 13
  switch (kind) {
    case 8:
      return r(0) === 12 ? 'a royal flush' : `a straight flush, ${SINGLE[r(0)]} high`
    case 7:
      return `four ${PLURAL[r(0)]}`
    case 6:
      return `a full house, ${PLURAL[r(0)]} full of ${PLURAL[r(1)]}`
    case 5:
      return `a flush, ${SINGLE[r(0)]} high`
    case 4:
      return `a straight, ${SINGLE[r(0)]} high`
    case 3:
      return `three ${PLURAL[r(0)]}`
    case 2:
      return `two pair, ${PLURAL[r(0)]} and ${PLURAL[r(1)]}`
    case 1:
      return `a pair of ${PLURAL[r(0)]}`
    default:
      return `${SINGLE[r(0)]} high`
  }
}

/* ---------------------------------------------------------------------------- the table */

export type Seat = {
  name: string
  chips: number
  hole: Card[]
  /** chips put in during this street, and during the whole hand */
  bet: number
  put: number
  folded: boolean
  /** out of the table: no chips left at the start of a hand */
  out: boolean
  /** has acted since the last bet or raise this street */
  acted: boolean
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'done'

export type Table = {
  seats: Seat[]
  deck: Card[]
  board: Card[]
  dealer: number
  small: number
  big: number
  street: Street
  /** whose turn it is, or -1 when nobody can act */
  toAct: number
  /** the bet to match this street, and the smallest raise allowed on top of it */
  current: number
  minRaise: number
  /** what the last hand paid, for the page to show */
  result: Result | null
  hand: number
}

export type Result = {
  /** chips won by each seat this hand (the whole of each pot they took, not net) */
  won: number[]
  /** each player still in at a showdown, with their hand's value */
  shown: { seat: number; value: number }[]
  /** true when everybody else folded */
  uncontested: boolean
}

export function newTable(names: string[], chips: number, big: number): Table {
  return {
    seats: names.map((name) => ({
      name,
      chips,
      hole: [],
      bet: 0,
      put: 0,
      folded: false,
      out: false,
      acted: false,
    })),
    deck: [],
    board: [],
    dealer: -1,
    small: big / 2,
    big,
    street: 'done',
    toAct: -1,
    current: 0,
    minRaise: big,
    result: null,
    hand: 0,
  }
}

const live = (t: Table) => t.seats.map((_, i) => i).filter((i) => !t.seats[i].out)
const inHand = (t: Table) =>
  t.seats.map((_, i) => i).filter((i) => !t.seats[i].out && !t.seats[i].folded)
/** players who can still bet: in the hand and not all-in */
const canAct = (t: Table) => inHand(t).filter((i) => t.seats[i].chips > 0)
const nextFrom = (t: Table, from: number, ok: (i: number) => boolean) => {
  for (let k = 1; k <= t.seats.length; k++) {
    const i = (from + k) % t.seats.length
    if (ok(i)) return i
  }
  return -1
}

function put(t: Table, i: number, amount: number) {
  const s = t.seats[i]
  const a = Math.min(amount, s.chips)
  s.chips -= a
  s.bet += a
  s.put += a
}

export const pot = (t: Table) => t.seats.reduce((a, s) => a + s.put, 0)

/** deal a new hand: move the button, post the blinds, deal two cards each */
export function deal(t: Table, rand: () => number) {
  for (const s of t.seats) {
    s.out = s.chips <= 0
    s.hole = []
    s.bet = 0
    s.put = 0
    s.folded = s.out
    s.acted = false
  }
  t.hand++
  t.result = null
  t.board = []
  t.deck = shuffled(rand)
  t.dealer = nextFrom(t, t.dealer, (i) => !t.seats[i].out)
  const players = live(t)
  // heads up, the button posts the small blind and acts first before the flop
  const sb = players.length === 2 ? t.dealer : nextFrom(t, t.dealer, (i) => !t.seats[i].out)
  const bb = nextFrom(t, sb, (i) => !t.seats[i].out)
  put(t, sb, t.small)
  put(t, bb, t.big)
  for (let k = 0; k < 2; k++) for (const i of players) t.seats[i].hole.push(t.deck.pop()!)
  t.street = 'preflop'
  t.current = t.big
  t.minRaise = t.big
  t.toAct = nextFrom(t, bb, (i) => !t.seats[i].out && !t.seats[i].folded && t.seats[i].chips > 0)
  settle(t)
}

export type Action =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'raise'; to: number }

/** what the player to act may do, and the amounts */
export function choices(t: Table) {
  const s = t.seats[t.toAct]
  const owe = t.current - s.bet
  const allIn = s.bet + s.chips
  return {
    owe: Math.min(owe, s.chips),
    canCheck: owe <= 0,
    /** a raise must reach at least this, unless it is all the chips there are */
    minTo: Math.min(allIn, t.current + t.minRaise),
    maxTo: allIn,
    canRaise: allIn > t.current,
  }
}

/** apply an action by the player to act; a bad amount is taken as the nearest legal one */
export function act(t: Table, a: Action) {
  const i = t.toAct
  if (i < 0) return
  const s = t.seats[i]
  const c = choices(t)
  if (a.kind === 'fold') {
    if (c.canCheck) {
      // folding when you could check gives nothing away; treat it as a check
      s.acted = true
    } else s.folded = true
  } else if (a.kind === 'check' || a.kind === 'call' || !c.canRaise) {
    put(t, i, Math.max(0, t.current - s.bet))
    s.acted = true
  } else {
    const to = Math.max(c.minTo, Math.min(c.maxTo, Math.round(a.to)))
    const raise = to - t.current
    put(t, i, to - s.bet)
    // only a full raise re-opens the betting and sets the next minimum
    if (raise >= t.minRaise) {
      t.minRaise = raise
      for (const o of t.seats) o.acted = false
    }
    if (to > t.current) t.current = to
    s.acted = true
  }
  t.toAct = nextFrom(t, i, (j) => canAct(t).includes(j))
  settle(t)
}

/** move the hand on when a street's betting is over, or end it */
function settle(t: Table) {
  const players = inHand(t)
  if (players.length === 1) {
    finish(t)
    return
  }
  const acting = canAct(t)
  const done = acting.every((i) => t.seats[i].acted && t.seats[i].bet === t.current)
  // a lone player who can still bet but faces nobody who can answer has nothing to decide,
  // unless they still owe a call
  const alone = acting.length === 1 && t.seats[acting[0]].bet >= t.current && players.length > 1
  if (!done && !alone && acting.length > 0) {
    if (!acting.includes(t.toAct)) t.toAct = nextFrom(t, t.toAct, (j) => acting.includes(j))
    return
  }
  // the street is over
  for (const s of t.seats) {
    s.bet = 0
    s.acted = false
  }
  t.current = 0
  t.minRaise = t.big
  const order: Street[] = ['preflop', 'flop', 'turn', 'river', 'done']
  t.street = order[order.indexOf(t.street) + 1]
  if (t.street === 'flop') t.board.push(t.deck.pop()!, t.deck.pop()!, t.deck.pop()!)
  else if (t.street === 'turn' || t.street === 'river') t.board.push(t.deck.pop()!)
  if (t.street === 'done') {
    finish(t)
    return
  }
  // after the flop the first to act is the first live player left of the button
  t.toAct = nextFrom(t, t.dealer, (j) => canAct(t).includes(j))
  if (canAct(t).length <= 1) settle(t)
}

/**
 * Pay the pots. Each player can win only what they could match, so the chips are cut into layers by
 * the amounts the players in the hand put in: the main pot, then a side pot for each bigger stack.
 */
export function finish(t: Table) {
  const players = inHand(t)
  const won = t.seats.map(() => 0)
  const shown: Result['shown'] = []
  const total = pot(t)
  if (players.length === 1) {
    won[players[0]] = total
  } else {
    while (t.board.length < 5) t.board.push(t.deck.pop()!)
    const value = new Map(players.map((i) => [i, rank([...t.seats[i].hole, ...t.board])]))
    for (const i of players) shown.push({ seat: i, value: value.get(i)! })
    const levels = [...new Set(players.map((i) => t.seats[i].put))].sort((a, b) => a - b)
    let below = 0
    for (const level of levels) {
      // this layer: from everyone, what they put in between `below` and `level`
      let layer = 0
      for (const s of t.seats) layer += Math.max(0, Math.min(s.put, level) - below)
      const eligible = players.filter((i) => t.seats[i].put >= level)
      const best = Math.max(...eligible.map((i) => value.get(i)!))
      const winners = eligible.filter((i) => value.get(i) === best)
      // an odd chip goes to the first winner left of the button
      const share = Math.floor(layer / winners.length)
      let odd = layer - share * winners.length
      const ordered = [...winners].sort(
        (a, b) => ((a - t.dealer + 52) % t.seats.length) - ((b - t.dealer + 52) % t.seats.length),
      )
      for (const w of ordered) {
        won[w] += share + (odd > 0 ? 1 : 0)
        if (odd > 0) odd--
      }
      below = level
    }
    // chips put in above every remaining player's level (a folder's overbet cannot happen, since a
    // bet is always matched or folded to; but a lone overbet returned) go back to whoever put them
    let paid = won.reduce((a, b) => a + b, 0)
    if (paid < total) {
      const top = Math.max(...players.map((i) => t.seats[i].put))
      for (let i = 0; i < t.seats.length && paid < total; i++) {
        const extra = t.seats[i].put - top
        if (extra > 0) {
          won[i] += extra
          paid += extra
        }
      }
    }
  }
  won.forEach((w, i) => (t.seats[i].chips += w))
  for (const s of t.seats) {
    s.bet = 0
    s.put = 0
  }
  t.street = 'done'
  t.toAct = -1
  t.current = 0
  t.result = { won, shown, uncontested: players.length === 1 }
}

/* ---------------------------------------------------------------------------- the computer */

/**
 * The chance this hand wins, by dealing the unseen cards at random many times: the rest of the
 * board and each opponent's two cards. A tie counts as a share.
 */
export function equity(
  hole: Card[],
  board: Card[],
  opponents: number,
  samples: number,
  rand: () => number,
): number {
  const seen = new Set([...hole, ...board])
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c))
  let total = 0
  const need = 5 - board.length
  for (let n = 0; n < samples; n++) {
    // a partial shuffle: only as many cards as this deal uses
    const take = need + opponents * 2
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rand() * (rest.length - i))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    const full = [...board, ...rest.slice(0, need)]
    const mine = rank([...hole, ...full])
    let best = 0
    let ties = 0
    for (let o = 0; o < opponents; o++) {
      const v = rank([rest[need + o * 2], rest[need + o * 2 + 1], ...full])
      if (v > best) {
        best = v
        ties = 0
      }
      if (v === best) ties++
    }
    if (mine > best) total += 1
    else if (mine === best) total += 1 / (ties + 1)
  }
  return total / samples
}

export type Style = {
  /** how much better than the price it wants to be before calling */
  caution: number
  /** how strong it must be to raise, against a fair share */
  pushes: number
  /** how often it bets with nothing */
  bluff: number
}
export const STYLES: Record<string, Style> = {
  steady: { caution: 0.04, pushes: 1.6, bluff: 0.03 },
  wild: { caution: -0.04, pushes: 1.25, bluff: 0.14 },
  rock: { caution: 0.1, pushes: 1.9, bluff: 0.01 },
}

/**
 * What a computer player does: its chance of winning against the price of staying in. Calling
 * costs `owe` to win the pot, so it is worth it when the chance beats owe / (pot + owe); it raises
 * when it is well ahead of a fair share, sometimes bluffs, and sizes a raise to the pot.
 */
export function decide(t: Table, style: Style, rand: () => number, samples = 250): Action {
  const s = t.seats[t.toAct]
  const c = choices(t)
  const opponents = inHand(t).length - 1
  const eq = equity(s.hole, t.board, opponents, samples, rand)
  const thePot = pot(t)
  const price = c.owe / (thePot + c.owe || 1)
  const fair = 1 / (opponents + 1)
  const strong = eq > fair * style.pushes
  const bluffing = !strong && rand() < style.bluff && t.street !== 'river'
  if ((strong || bluffing) && c.canRaise) {
    // bigger with a bigger edge, never more than it has
    const size = thePot * (0.5 + Math.min(1, (eq - fair) * 2)) + c.owe
    const to = Math.max(
      c.minTo,
      Math.min(c.maxTo, Math.round((t.current + size) / t.small) * t.small),
    )
    // a raise that would be all-in for little gain is a call instead, unless it is very strong
    if (to >= c.maxTo && eq < 0.7 && !c.canCheck && c.owe < s.chips * 0.5) return { kind: 'call' }
    return { kind: 'raise', to }
  }
  if (c.canCheck) return { kind: 'check' }
  if (eq >= price + style.caution) return { kind: 'call' }
  return { kind: 'fold' }
}

/* ---------------------------------------------------------------------------- what is kept */

export const POKER_KEY = 'lab_poker_v1'
export type Saved = { tables: number; won: number; hands: number; biggestPot: number }
export const EMPTY: Saved = { tables: 0, won: 0, hands: 0, biggestPot: 0 }
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  for (const k of Object.keys(EMPTY) as (keyof Saved)[]) {
    const x = o[k]
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e9) out[k] = x
  }
  out.won = Math.min(out.won, out.tables)
  return out
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
