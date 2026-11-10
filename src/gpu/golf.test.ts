import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  DEPTH,
  EMPTY,
  deal,
  fits,
  golfRank,
  left,
  over,
  playable,
  readSaved,
  score,
  solve,
  solver,
  take,
  turn,
  type Game,
} from './golf'
import { rng } from './bricks'
import { card } from './poker'

/** every way through, by the rules alone: no memory, no bounds, nothing shared with the solver */
function brute(g: Game): number {
  if (over(g)) return score(g)
  let best = Infinity
  for (const i of playable(g)) best = Math.min(best, brute(take(g, i)))
  if (g.stock.length) best = Math.min(best, brute(turn(g)))
  return best
}
/** a small game: up to two cards in each column and four in the stock, from a seed */
function small(seed: number, wrap: boolean): Game {
  const rand = rng(seed)
  const d = deal(seed, wrap)
  const all = [...d.cols.flat(), ...d.stock, ...d.waste]
  const cols = Array.from({ length: COLUMNS }, (_, i) =>
    all.slice(i * 2, i * 2 + Math.floor(rand() * 3)),
  )
  return { cols, stock: all.slice(20, 24), waste: [all[24]], wrap, moves: 0 }
}

describe('the deal', () => {
  it('lays out 35 cards in seven columns of five, 16 in the stock and one face up', () => {
    const g = deal(42)
    expect(g.cols.map((c) => c.length)).toEqual(Array(COLUMNS).fill(DEPTH))
    expect(g.stock).toHaveLength(16)
    expect(g.waste).toHaveLength(1)
    expect(new Set([...g.cols.flat(), ...g.stock, ...g.waste]).size).toBe(52)
    expect(deal(42)).toEqual(deal(42))
    expect(deal(43)).not.toEqual(deal(42))
  })
})

describe('the rules', () => {
  it('a card goes on its neighbours; an ace is low, and next to a king only round the corner', () => {
    expect(golfRank(card('As'))).toBe(0)
    expect(golfRank(card('Kh'))).toBe(12)
    expect(fits(card('7s'), card('8h'), false)).toBe(true)
    expect(fits(card('7s'), card('6h'), false)).toBe(true)
    expect(fits(card('7s'), card('7h'), false)).toBe(false)
    expect(fits(card('7s'), card('9h'), false)).toBe(false)
    expect(fits(card('As'), card('2h'), false)).toBe(true)
    expect(fits(card('As'), card('Kh'), false)).toBe(false)
    expect(fits(card('As'), card('Kh'), true)).toBe(true)
    expect(fits(card('Qs'), card('Kh'), false)).toBe(true)
  })
  it('takes only a card that fits, turns the stock, and scores the leftovers', () => {
    const g: Game = {
      cols: [[card('2s'), card('8h')], [card('5c')], [], [], [], [], []],
      stock: [card('Ts'), card('9d')],
      waste: [card('7c')],
      wrap: false,
      moves: 0,
    }
    expect(playable(g)).toEqual([0])
    expect(take(g, 1)).toBe(g)
    const a = take(g, 0)
    expect(a.cols[0]).toEqual([card('2s')])
    expect(a.waste.at(-1)).toBe(card('8h'))
    expect(over(a)).toBe(false)
    const b = turn(turn(a))
    expect(b.stock).toEqual([])
    expect(over(b)).toBe(true)
    expect(score(b)).toBe(2)
    // clear the columns with stock to spare and the spare counts for you
    const c: Game = { ...g, cols: [[card('8h')], [], [], [], [], [], []] }
    expect(score(take(c, 0))).toBe(-2)
  })
})

describe('par', () => {
  it('agrees with trying every way through by brute force, on 300 small games', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const g = small(seed, seed % 3 === 0)
      expect(solve(g)).toEqual({ best: brute(g), exact: true })
    }
  })
  it('a slice at a time gives the same par as all at once', () => {
    for (const seed of [3, 11]) {
      const g = deal(seed)
      const s = solver(g)
      let slices = 0
      while (!s.step(500)) slices++
      expect(slices).toBeGreaterThan(5)
      expect(s.result()).toEqual(solve(g))
    }
  })
  it('is never worse than playing every card that fits, and often better', () => {
    let better = 0
    for (let seed = 1; seed <= 25; seed++) {
      let g = deal(seed)
      while (!over(g)) g = playable(g).length ? take(g, playable(g)[0]) : turn(g)
      const p = solve(deal(seed))
      expect(p.best).toBeLessThanOrEqual(score(g))
      if (p.best < score(g)) better++
      expect(left(deal(seed))).toBe(35)
    }
    expect(better).toBeGreaterThan(15)
  }, 120000)
})

describe('golf saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      back: 'stars',
      felt: 'red',
      wrap: true,
      hints: false,
      played: 40,
      cleared: 12,
      best: -6,
      onPar: 9,
      today: { day: 3999999999, score: -2 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad, and never claims more than was played', () => {
    expect(readSaved('nope')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ played: 3, cleared: 9, best: 99, onPar: 7 }))).toEqual({
      ...EMPTY,
      played: 3,
      cleared: 3,
      onPar: 3,
    })
  })
})
