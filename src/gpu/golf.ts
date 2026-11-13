/**
 * Golf, the patience: seven columns of five cards and a stock. Take the bottom card of any column
 * that is one above or one below the card on the waste, as many as you can in a row; when nothing
 * fits, turn the next card from the stock. Clear the columns and the cards still in the stock count
 * in your favour; otherwise every card left in the columns counts against you. Lowest score wins,
 * the way it does in golf. Pure, so golf.test.ts can deal and solve thousands of hands.
 *
 * Cards are the Hold'em toy's 0–51; here an ace is low, so a king and an ace are not neighbours
 * unless the "round the corner" rule is on.
 */
import { rankOf, shuffled, type Card } from './poker'
import { rng } from './bricks'
import { whole } from './kept'

export const COLUMNS = 7
export const DEPTH = 5
/** an ace is 0 and a king 12 */
export const golfRank = (c: Card) => (rankOf(c) === 12 ? 0 : rankOf(c) + 1)
export const fits = (a: Card, b: Card, wrap: boolean) => {
  const d = Math.abs(golfRank(a) - golfRank(b))
  return d === 1 || (wrap && d === 12)
}

export type Game = { cols: Card[][]; stock: Card[]; waste: Card[]; wrap: boolean; moves: number }
export function deal(seed: number, wrap = false): Game {
  const cards = shuffled(rng(seed))
  const cols = Array.from({ length: COLUMNS }, (_, i) => cards.slice(i * DEPTH, (i + 1) * DEPTH))
  const stock = cards.slice(COLUMNS * DEPTH)
  return { cols, stock: stock.slice(1), waste: [stock[0]], wrap, moves: 0 }
}
const top = (g: Game) => g.waste[g.waste.length - 1]
export const left = (g: Game) => g.cols.reduce((a, c) => a + c.length, 0)
/** the columns whose bottom card fits on the waste */
export const playable = (g: Game) =>
  g.cols.flatMap((c, i) => (c.length && fits(c[c.length - 1], top(g), g.wrap) ? [i] : []))
export const over = (g: Game) => left(g) === 0 || (!g.stock.length && !playable(g).length)
/** cards left in the columns, or, once they are all gone, minus the cards still in the stock */
export const score = (g: Game) => (left(g) ? left(g) : 0 - g.stock.length || 0)

export function take(g: Game, col: number): Game {
  const c = g.cols[col]
  if (!c.length || !fits(c[c.length - 1], top(g), g.wrap)) return g
  const cols = g.cols.map((x, i) => (i === col ? x.slice(0, -1) : x))
  return { ...g, cols, waste: [...g.waste, c[c.length - 1]], moves: g.moves + 1 }
}
export function turn(g: Game): Game {
  if (!g.stock.length) return g
  return { ...g, stock: g.stock.slice(1), waste: [...g.waste, g.stock[0]], moves: g.moves + 1 }
}

/**
 * Par: the best score this deal allows from here, by trying everything.
 *
 * A game's score depends only on where it ends — the cards left in the columns and in the stock —
 * never on the way there, so a position (each column's height, the stock left and the waste
 * card's rank) reached a second way has nothing new to offer and is skipped. A position whose
 * very best ending, every column gone with all its stock unturned, cannot beat the best already
 * found is not entered at all.
 *
 * ⚠️ IT RUNS A SLICE AT A TIME. Measured over 200 deals, the slowest took 2.2 s here to finish,
 * which a phone could make six — far too long to hold the page. So the search keeps its own stack
 * rather than the call stack, and `step` does a bounded amount and hands back; the page calls it
 * between frames, and `solve` simply calls it until it is done. `budget` caps the positions looked
 * at (12 of those 200 deals reached it); past it the answer is the best found and `exact` is false.
 */
export function solver(g: Game, budget = 1_500_000) {
  const seen = new Set<number>()
  const heights = g.cols.map((c) => c.length)
  const stock = g.stock
  type Frame = { si: number; rank: number; rem: number; order: number[]; next: number; col: number }
  const stack: Frame[] = []
  const out = { best: left(g), exact: true, done: false }
  let n = 0
  /** step into a position, arrived at by taking from `col` (or -1); undo at once if it is skipped */
  const enter = (si: number, rank: number, rem: number, col: number) => {
    const back = () => {
      if (col >= 0) heights[col]++
    }
    if (!rem) {
      out.best = Math.min(out.best, si - stock.length || 0)
      return back()
    }
    out.best = Math.min(out.best, rem)
    // the most this position could still give: every column cleared, the rest of the stock unturned
    if (-(stock.length - si) >= out.best) return back()
    let key = 0
    for (const h of heights) key = key * (DEPTH + 1) + h
    key = (key * (stock.length + 1) + si) * 13 + rank
    if (seen.has(key)) return back()
    seen.add(key)
    if (++n > budget) {
      out.exact = false
      return back()
    }
    // the tallest columns first: a card dug out from deep down frees the most
    const order = [...heights.keys()]
      .filter((i) => heights[i])
      .sort((a, b) => heights[b] - heights[a])
    stack.push({ si, rank, rem, order, next: 0, col })
  }
  enter(0, golfRank(top(g)), left(g), -1)
  /** work through up to `limit` steps; true once par is known */
  const step = (limit: number) => {
    for (let k = 0; k < limit && stack.length && out.exact; k++) {
      const f = stack[stack.length - 1]
      if (f.next < f.order.length) {
        const i = f.order[f.next++]
        const c = g.cols[i][heights[i] - 1]
        const d = Math.abs(golfRank(c) - f.rank)
        if (d !== 1 && !(g.wrap && d === 12)) continue
        heights[i]--
        enter(f.si, golfRank(c), f.rem - 1, i)
      } else if (f.next === f.order.length) {
        f.next++
        if (f.si < stock.length) enter(f.si + 1, golfRank(stock[f.si]), f.rem, -1)
      } else {
        stack.pop()
        if (f.col >= 0) heights[f.col]++
      }
    }
    if (!stack.length || !out.exact) out.done = true
    return out.done
  }
  return { step, result: () => ({ best: out.best, exact: out.exact }) }
}
export function solve(g: Game, budget?: number) {
  const s = solver(g, budget)
  while (!s.step(1e6));
  return s.result()
}

/* ---------------------------------------------------------------------------- what is kept */

export const GOLF_KEY = 'lab_golf_v1'
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export const FELTS = ['green', 'blue', 'red'] as const
export type Saved = {
  back: (typeof BACKS)[number]
  felt: (typeof FELTS)[number]
  /** a king and an ace count as neighbours */
  wrap: boolean
  /** lift the cards that can be taken */
  hints: boolean
  played: number
  cleared: number
  /** the lowest score ever; null before the first game */
  best: number | null
  /** games finished on par or better */
  onPar: number
  today: { day: number; score: number } | null
}
export const EMPTY: Saved = {
  back: 'lattice',
  felt: 'green',
  wrap: false,
  hints: true,
  played: 0,
  cleared: 0,
  best: null,
  onPar: 0,
  today: null,
}
const golfScore = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= -16 && v <= 35 ? v : null
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
  const t = (typeof o.today === 'object' && o.today ? o.today : null) as Record<
    string,
    unknown
  > | null
  const played = whole(o.played, 1e9)
  const tScore = t ? golfScore(t.score) : null
  return {
    back: pick(BACKS, o.back, EMPTY.back),
    felt: pick(FELTS, o.felt, EMPTY.felt),
    wrap: typeof o.wrap === 'boolean' ? o.wrap : EMPTY.wrap,
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    played,
    cleared: Math.min(played, whole(o.cleared, 1e9)),
    best: golfScore(o.best),
    onPar: Math.min(played, whole(o.onPar, 1e9)),
    today:
      t && whole(t.day, 2 ** 32) && tScore !== null
        ? { day: whole(t.day, 2 ** 32), score: tScore }
        : null,
  }
}
