import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  BREATH,
  EMPTY,
  R,
  ROUTES,
  aimFor,
  centreOf,
  dart,
  hitAt,
  newLeg,
  playLeg,
  points,
  readSaved,
  say,
  scoringAim,
  yourSpread,
  type Hit,
  type Saved,
} from './darts'

const h = (n: number, mult: 0 | 1 | 2 | 3): Hit => ({ n, mult })
/** what lands at radius r millimetres, `deg` degrees clockwise from the top */
const polar = (r: number, deg: number) =>
  hitAt(Math.sin((deg * Math.PI) / 180) * r, Math.cos((deg * Math.PI) / 180) * r)

describe('the board', () => {
  it('scores the rings from the middle out', () => {
    expect(hitAt(0, 0)).toEqual(h(25, 2))
    expect(hitAt(0, 10)).toEqual(h(25, 1))
    expect(hitAt(0, 50)).toEqual(h(20, 1))
    expect(hitAt(0, 103)).toEqual(h(20, 3))
    expect(hitAt(0, 130)).toEqual(h(20, 1))
    expect(hitAt(0, 166)).toEqual(h(20, 2))
    expect(hitAt(0, 175)).toEqual(h(0, 0))
  })
  it('goes round the numbers clockwise from 20 at the top', () => {
    // straight right is 6, straight down is 3, straight left is 11
    expect(polar(130, 90).n).toBe(6)
    expect(polar(130, 180).n).toBe(3)
    expect(polar(130, 270).n).toBe(11)
    // the edge between 20 and 1 is 9 degrees round
    expect(polar(130, 8.9).n).toBe(20)
    expect(polar(130, 9.1).n).toBe(1)
  })
  it('puts the middle of every target inside that target', () => {
    for (const n of [1, 5, 11, 14, 19, 20])
      for (const mult of [1, 2, 3] as const) {
        const c = centreOf(h(n, mult))
        expect(hitAt(c.x, c.y)).toEqual(h(n, mult))
      }
    const bull = centreOf(h(25, 2))
    expect(hitAt(bull.x, bull.y)).toEqual(h(25, 2))
    const outer = centreOf(h(25, 1))
    expect(hitAt(outer.x, outer.y)).toEqual(h(25, 1))
    expect(R.doubleOut).toBe(170)
  })
})

describe('the way out', () => {
  it('knows the classic finishes', () => {
    expect(ROUTES.get(170)!.map(say)).toEqual(['T20', 'T20', 'the bull'])
    expect(ROUTES.get(100)!.map(say)).toEqual(['T20', 'D20'])
    expect(ROUTES.get(40)!.map(say)).toEqual(['D20'])
    expect(ROUTES.get(50)!.map(say)).toEqual(['the bull'])
  })
  it('has a route for every score up to 170 except the seven no three darts can finish', () => {
    const none = []
    for (let s = 2; s <= 170; s++) if (!ROUTES.has(s)) none.push(s)
    expect(none).toEqual([159, 162, 163, 165, 166, 168, 169])
  })
  it('only ever routes to a double, adding up exactly', () => {
    for (const [s, route] of ROUTES) {
      expect(route.reduce((t, x) => t + points(x), 0)).toBe(s)
      expect(route[route.length - 1].mult).toBe(2)
      expect(route.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('a leg', () => {
  it('takes the score off, three darts a turn, then hands over', () => {
    let g = newLeg(0)
    g = dart(g, h(20, 3))
    g = dart(g, h(20, 3))
    expect(g.turn).toBe(0)
    g = dart(g, h(20, 3))
    expect(g.scores).toEqual([501 - 180, 501])
    expect(g.turn).toBe(1)
    expect(g.history[0]).toMatchObject({ who: 0, total: 180, bust: false })
  })
  it('is bust below nought, on one, or on nought without a double — back to where the turn began', () => {
    for (const [left, hit] of [
      [32, h(20, 2)], // 32 - 40 is below nought
      [3, h(1, 2)], // 3 - 2 leaves one
      [20, h(20, 1)], // nought, but not on a double
    ] as const) {
      const g = dart({ ...newLeg(0), scores: [left, 501], from: left }, hit)
      expect(g.scores[0]).toBe(left)
      expect(g.turn).toBe(1)
      expect(g.history.at(-1)!.bust).toBe(true)
    }
  })
  it('restores the score from before the FIRST dart of a bust turn', () => {
    let g = { ...newLeg(0), scores: [60, 501] as [number, number], from: 60 }
    g = dart(g, h(20, 1)) // 40
    g = dart(g, h(20, 3)) // -20: bust
    expect(g.scores[0]).toBe(60)
  })
  it('is won on a double that makes nought exactly', () => {
    let g = { ...newLeg(0), scores: [50, 501] as [number, number], from: 50 }
    g = dart(g, h(25, 2))
    expect(g.winner).toBe(0)
    expect(dart(g, h(20, 3))).toBe(g)
  })
})

describe('the computer', () => {
  it('follows a route when it has the darts for it, and sets up when it does not', () => {
    const g = { ...newLeg(1), scores: [501, 100] as [number, number], from: 100 }
    expect(aimFor(g, 'hard').label).toBe('T20')
    expect(aimFor({ ...g, scores: [501, 40], from: 40 }, 'hard').label).toBe('D20')
    // 170 with only one dart left cannot be finished: it scores instead
    const one = { ...g, scores: [501, 170] as [number, number], darts: [h(1, 1), h(1, 1)] }
    expect(aimFor(one, 'hard').label).toBe(scoringAim('hard').label)
    // 61 with one dart: a single that leaves a liked double, not a treble
    const sixtyOne = { ...g, scores: [501, 61] as [number, number], darts: [h(1, 1), h(1, 1)] }
    expect(aimFor(sixtyOne, 'fair').label).toMatch(/^\d+$|^25$/)
  })
  it('aims where its own hand scores best: the steady hand at T20', () => {
    expect(scoringAim('hard').label).toBe('T20')
    // a loose hand chooses something else, because T20 sits between 5 and 1
    expect(scoringAim('easy').label).not.toBe('T20')
  })
  it('wins more level by level, from both seats', () => {
    const rate = (a: 'easy' | 'fair' | 'hard', b: 'easy' | 'fair' | 'hard', n: number) => {
      const r = rng(7)
      let won = 0
      for (let i = 0; i < n; i++) {
        if (playLeg(a, b, 0, r).winner === 0) won++
        if (playLeg(b, a, 0, r).winner === 1) won++
      }
      return won / (2 * n)
    }
    // measured over three hundred legs: Fair beats Easy 80%, Hard beats Fair 92%
    expect(rate('fair', 'easy', 60)).toBeGreaterThan(0.65)
    expect(rate('hard', 'fair', 60)).toBeGreaterThan(0.8)
  })
})

describe('your hand', () => {
  it('steadies to its best after a held breath, and loosens if held too long', () => {
    expect(yourSpread(0)).toBeGreaterThan(yourSpread(BREATH / 2))
    expect(yourSpread(BREATH / 2)).toBeGreaterThan(yourSpread(BREATH))
    expect(yourSpread(BREATH * 1.5)).toBeGreaterThan(yourSpread(BREATH))
    expect(yourSpread(BREATH)).toBeCloseTo(16, 5)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      board: 'pub',
      hints: false,
      record: {
        easy: { won: 3, lost: 1, best: 81, fewest: 18, tons: 1 },
        fair: { won: 2, lost: 5, best: 121, fewest: 15, tons: 2 },
        hard: { won: 1, lost: 7, best: 170, fewest: 12, tons: 4 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise, and no checkout is over 170', () => {
    expect(readSaved('[]')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ record: { easy: { best: 180 } } })).record.easy.best).toBe(
      170,
    )
  })
})
