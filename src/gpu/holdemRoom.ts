import {
  STYLES,
  act,
  choices,
  deal,
  decide,
  newTable,
  shuffled,
  type Action,
  type Card,
  type Result,
  type Table,
} from './poker'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Hold'em as a match by turns (src/lab/matches): the toy's own no-limit game heads up, play chips
 * only, a thousand each, the blinds 10/20 and doubling every ten hands as the toy's table does, so a
 * match ends. A move is one decision — fold, check, call, or raise to an amount. The last player
 * with chips wins. Together, the friends share one seat and take its decisions in turn.
 *
 * ⚠️ THE DECK AND BOTH PAIRS OF HOLE CARDS ARE KEPT BACK (Rules.hidden), and each player fetches
 * their own two from lab-move. What travels of each hand is what the table saw: every decision in
 * order, the board as it was turned, and the hole cards shown at a showdown. That is enough to play
 * every hand again through the toy's own deal, act and finish — a deck made up to deal exactly
 * those cards — so the stacks, the pots and the side pots can only be what the cards and the
 * decisions made; each decision must be one the toy offered at that moment, exactly, since the
 * toy itself quietly mends a bad amount and a record must not. The hand in play is played again
 * the same way on the server with its own deck and hole cards.
 *
 * The computer is the toy's own players, by the style its notes rank them: Easy is Rook, who waits
 * for cards; Fair is Jinx, who bluffs; Hard is Wren, tuned by self-play. Measured heads up from a
 * thousand chips over 160 tables each: Jinx beats Rook 66.9%, and Wren beats Jinx 56.3%.
 */
export type HandRec = {
  actions: Action[]
  board: Card[]
  /** each seat's hole cards, shown at a showdown; null where they never were */
  shown: (Card[] | null)[]
}
export type HoldemGame = {
  past: HandRec[]
  /** the hand in play: its decisions and the board so far */
  cur: { actions: Action[]; board: Card[] }
  /** the toy's own table: its deck and hole cards only on the server */
  t: Table
  /** who made the hand's last decision so far, for the page to say; null before the first */
  lastBy: Seat | null
  known: boolean
}

export const START = 1000
export const BLIND = 20
export const LEVEL_HANDS = 10
export const MAX_HANDS = 120
const LEVEL_STYLE = { easy: STYLES.rock, fair: STYLES.wild, hard: STYLES.steady } as const

const clone = (t: Table): Table => structuredClone(t)
const blank = () => newTable(['a', 'b'], START, BLIND)
const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52
const alive = (t: Table) => t.seats.filter((s) => s.chips > 0).length
const over = (t: Table) => t.street === 'done' && (alive(t) < 2 || t.hand >= MAX_HANDS)

export const whoseMove = (g: HoldemGame): Seat | null =>
  g.t.street === 'done' || g.t.toAct < 0 ? null : (g.t.toAct as Seat)

/** the blinds for the next hand, as the toy's table raises them */
function blinds(t: Table) {
  const level = Math.floor(t.hand / LEVEL_HANDS)
  t.big = BLIND * 2 ** level
  t.small = t.big / 2
}

/**
 * Deal a hand from a deck made to give these cards, in the order the toy draws them: each seat's
 * first card, each seat's second, then the board as it is turned. Cards nobody saw are filled from
 * what is left, in a fixed order; they decide nothing, since a hand that reaches a showdown shows
 * its hole cards and one that does not never ranks them.
 */
function dealKnown(t: Table, holes: (Card[] | null)[], board: Card[]) {
  const used = new Set([...board, ...holes.flatMap((h) => h ?? [])])
  const spare = Array.from({ length: 52 }, (_, c) => c).filter((c) => !used.has(c))
  const h = holes.map((x) => x ?? [spare.shift()!, spare.shift()!])
  const sequence = [h[0][0], h[1][0], h[0][1], h[1][1], ...board]
  blinds(t)
  // ⚠️ THE TOY'S OWN DEAL, FROM THE TOY'S OWN SHUFFLE, made to come out as this deck: a deal can
  // run the whole board out before anybody acts (a blind that is all a player has), so the deck
  // must be the right one from the first card — putting it in afterwards would be too late
  deal(t, randFor([...spare, ...sequence.reverse()]))
}

/**
 * The numbers that make the toy's shuffle (a Fisher–Yates over 0–51) come out as this deck: at each
 * step from the end, the card wanted there is found among those not yet placed and chosen.
 */
function randFor(target: Card[]): () => number {
  const d = Array.from({ length: 52 }, (_, i) => i)
  const out: number[] = []
  for (let i = 51; i > 0; i--) {
    const j = d.indexOf(target[i])
    out.push((j + 0.5) / (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  let k = 0
  return () => out[k++] ?? 0
}

/** whether an action is one the toy offers the player to act right now, exactly */
function offered(t: Table, a: Action): boolean {
  if (t.toAct < 0 || t.street === 'done') return false
  const c = choices(t)
  if (a.kind === 'fold') return !c.canCheck
  if (a.kind === 'check') return c.canCheck
  if (a.kind === 'call') return !c.canCheck
  return c.canRaise && Number.isInteger(a.to) && a.to >= c.minTo && a.to <= c.maxTo
}

/** a finished hand played again from its record: the table it leaves, or null */
function replayHand(t0: Table, rec: HandRec): Table | null {
  const t = clone(t0)
  dealKnown(t, rec.shown, rec.board)
  for (const a of rec.actions) {
    if (!offered(t, a)) return null
    act(t, a)
  }
  if (t.street !== 'done' || !t.result) return null
  // the board the record says was turned is the board this hand turned
  if (t.board.length !== rec.board.length) return null
  // hole cards are shown exactly at a showdown, by exactly the seats in it
  const showdown = !t.result.uncontested
  for (let i = 0; i < 2; i++) {
    const inIt = showdown && t.result.shown.some((s) => s.seat === i)
    if (inIt !== (rec.shown[i] !== null)) return null
  }
  return t
}

/** the hand in play, from its decisions so far: the table as everybody sees it */
function replayCurrent(
  t0: Table,
  cur: HoldemGame['cur'],
  holes?: Card[][],
  deck?: Card[],
): { t: Table; lastBy: Seat | null } | null {
  const t = clone(t0)
  dealKnown(t, holes ?? [null, null], cur.board)
  let lastBy: Seat | null = null
  for (const a of cur.actions) {
    if (!offered(t, a)) return null
    lastBy = t.toAct as Seat
    act(t, a)
  }
  if (t.street === 'done') return null
  if (t.board.length !== cur.board.length) return null
  if (holes && deck) {
    t.seats[0].hole = [...holes[0]]
    t.seats[1].hole = [...holes[1]]
    t.deck = [...deck]
  }
  return { t, lastBy }
}

const fresh = (): HoldemGame => ({
  past: [],
  cur: { actions: [], board: [] },
  t: blank(),
  lastBy: null,
  known: false,
})

/** a hand finished: kept with what the showdown showed, and the next one dealt by the server */
function settle(g: HoldemGame): HoldemGame {
  if (g.t.street !== 'done' || !g.t.result) return g
  const shown = [0, 1].map((i) =>
    !g.t.result!.uncontested && g.t.result!.shown.some((s) => s.seat === i)
      ? [...g.t.seats[i].hole]
      : null,
  )
  return {
    ...g,
    past: [...g.past, { actions: g.cur.actions, board: [...g.t.board], shown }],
    cur: { actions: [], board: [] },
    lastBy: null,
  }
}

function dealNext(g: HoldemGame, rand: () => number): HoldemGame {
  let cur = g
  // a hand can end as it is dealt (a blind that is all a player has): then the next one
  for (let k = 0; k < 20 && cur.t.street === 'done' && !over(cur.t); k++) {
    const t = clone(cur.t)
    blinds(t)
    deal(t, rand)
    cur = settle({ ...cur, t, cur: { actions: [], board: [...t.board] }, known: true })
  }
  return cur
}

function moved(g: HoldemGame, m: Action, s: Seat): HoldemGame | null {
  if (whoseMove(g) !== s || !offered(g.t, m)) return null
  if (!g.known) return g
  const t = clone(g.t)
  act(t, m)
  return settle({
    ...g,
    t,
    cur: { actions: [...g.cur.actions, m], board: [...t.board] },
    lastBy: s,
  })
}

/* ---------------------------------------------------------------- the wire ------------------ */

function readAction(x: unknown): Action | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const keys = Object.keys(o).sort().join()
  if (keys === 'kind' && (o.kind === 'fold' || o.kind === 'check' || o.kind === 'call'))
    return { kind: o.kind }
  if (keys === 'kind,to' && o.kind === 'raise' && Number.isInteger(o.to))
    return { kind: 'raise', to: o.to as number }
  return null
}
const cardList = (x: unknown, max: number): x is Card[] =>
  Array.isArray(x) && x.length <= max && x.every(isCard) && new Set(x).size === x.length

export function replayPublic(x: unknown): HoldemGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.past) || o.past.length > MAX_HANDS)
    return null
  let t = blank()
  const past: HandRec[] = []
  for (const p of o.past) {
    const v = p as { actions?: unknown; board?: unknown; shown?: unknown } | null
    if (!v || !Array.isArray(v.actions) || v.actions.length > 200 || !cardList(v.board, 5))
      return null
    if (!Array.isArray(v.shown) || v.shown.length !== 2) return null
    const shown = v.shown.map((h) =>
      h === null ? null : cardList(h, 2) && h.length === 2 ? [...h] : undefined,
    )
    if (shown.some((h) => h === undefined)) return null
    const all = [...v.board, ...shown.flatMap((h) => h ?? [])]
    if (new Set(all).size !== all.length) return null
    const actions = v.actions.map(readAction)
    if (actions.some((a) => !a)) return null
    if (over(t) && past.length) return null
    const rec: HandRec = {
      actions: actions as Action[],
      board: [...v.board],
      shown: shown as (Card[] | null)[],
    }
    const next = replayHand(t, rec)
    if (!next) return null
    past.push(rec)
    t = next
  }
  const g: HoldemGame = { past, cur: { actions: [], board: [] }, t, lastBy: null, known: false }
  if (over(t)) {
    const c = o.cur as { actions?: unknown[] } | null
    return c && Array.isArray(c.actions) && c.actions.length ? null : g
  }
  const c = o.cur as { actions?: unknown; board?: unknown } | null
  if (!c || !Array.isArray(c.actions) || !cardList(c.board, 5)) return null
  const actions = c.actions.map(readAction)
  if (actions.some((a) => !a)) return null
  const cur = { actions: actions as Action[], board: [...c.board] }
  const now = replayCurrent(t, cur)
  if (!now) return null
  return { ...g, cur, t: now.t, lastBy: now.lastBy }
}

/* ---------------------------------------------------------------- the rules ----------------- */

export const holdemRules: Rules<HoldemGame, Action> & {
  roll: (g: HoldemGame, rand: () => number) => HoldemGame
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
  roll: (g, rand) => dealNext(g, rand),
  encode: (g) => ({ past: g.past, cur: g.cur }),
  decode: replayPublic,
  readMove: readAction,
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: ['easy', 'fair', 'hard'],
    choose: (g, level) => decide(g.t, LEVEL_STYLE[level as keyof typeof LEVEL_STYLE], Math.random),
  },
  result: (g) => {
    if (!over(g.t)) return null
    const [a, b] = g.t.seats.map((s) => s.chips)
    return a > b ? 0 : b > a ? 1 : 'draw'
  },
  begun: (g) => g.past.length > 0 || g.cur.actions.length > 0,
  hidden: {
    secret: (g) => ({ holes: g.t.seats.map((s) => s.hole), deck: g.t.deck }),
    join: (g, secret) => {
      const o = secret as { holes?: unknown; deck?: unknown } | null
      if (!o || !Array.isArray(o.holes) || o.holes.length !== 2) return null
      if (over(g.t)) return { ...g, known: true }
      const [h0, h1] = o.holes
      if (!cardList(h0, 2) || !cardList(h1, 2) || h0.length !== 2 || h1.length !== 2) return null
      if (!cardList(o.deck, 52)) return null
      // one deck: both pairs of hole cards, the board and what is left to deal
      const all = [...h0, ...h1, ...g.cur.board, ...o.deck]
      if (all.length !== 52 || new Set(all).size !== 52) return null
      const real = replayCurrentFrom(g, [h0, h1], o.deck)
      return real ? { ...g, t: real, known: true } : null
    },
    mine: (g, side) => (over(g.t) ? null : g.t.seats[side].hole),
    // a decision is said at the table: nothing in a move is hidden
    logged: (m) => m,
    accept: (g) => dealNext({ ...g, known: true }, Math.random),
  },
}

/** the hand in play on the server: played again from the hands before it, with the real cards */
function replayCurrentFrom(g: HoldemGame, holes: Card[][], deck: Card[]): Table | null {
  let t = blank()
  for (const p of g.past) {
    const next = replayHand(t, p)
    if (!next) return null
    t = next
  }
  // the board so far comes off the top of the real deck as the hand goes on: deal from a deck
  // that gives these hole cards and this board, then put the rest of the real deck in its place
  return replayCurrent(t, g.cur, holes, deck)?.t ?? null
}

/**
 * The last finished hand, played again from the record: what it paid each seat, and the hands
 * shown at a showdown. Null before the first hand ends.
 */
export function lastHand(g: HoldemGame): { rec: HandRec; result: Result; dealer: number } | null {
  const rec = g.past[g.past.length - 1]
  if (!rec) return null
  let t = blank()
  for (const p of g.past.slice(0, -1)) {
    const next = replayHand(t, p)
    if (!next) return null
    t = next
  }
  const end = replayHand(t, rec)
  return end?.result ? { rec, result: end.result, dealer: end.dealer } : null
}

/** for the tests: whether a deck comes out of the toy's shuffle as made */
export const shuffleOf = (target: Card[]) => shuffled(randFor(target))
