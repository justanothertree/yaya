import { describe, expect, it } from 'vitest'
import { oklab } from './palette'
import {
  MATCH,
  PAINTS,
  TARGETS,
  hintFor,
  plan,
  colourOf,
  describe as words,
  difference,
  fewest,
  readSaved,
  reflectance,
  stars,
  targetColour,
  total,
  type Drops,
} from './mix'

const lch = (d: Drops) => {
  const [L, a, b] = oklab(colourOf(d))
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}
const W = 0
const K = 1
const Y = 2
const B = 3
const R = 4
const drops = (spec: Partial<Record<number, number>>): Drops => PAINTS.map((_, i) => spec[i] ?? 0)

describe('paint, not light', () => {
  it('one paint alone is itself, and only the proportions matter', () => {
    PAINTS.forEach((p, i) => {
      const r = reflectance(drops({ [i]: 3 }))
      r.forEach((v, k) => expect(v).toBeCloseTo(p.reflect[k], 6))
    })
    expect(colourOf(drops({ [Y]: 2, [B]: 2 }))).toEqual(colourOf(drops({ [Y]: 1, [B]: 1 })))
  })

  it('yellow and blue make green; blue and red make purple; yellow and red make orange', () => {
    const green = lch(drops({ [Y]: 1, [B]: 1 }))
    expect(green.h).toBeGreaterThan(130)
    expect(green.h).toBeLessThan(175)
    expect(green.C).toBeGreaterThan(0.08) // a green, not a grey
    const purple = lch(drops({ [B]: 1, [R]: 1 }))
    expect(purple.h).toBeGreaterThan(270)
    expect(purple.h).toBeLessThan(340)
    const orange = lch(drops({ [Y]: 1, [R]: 1 }))
    expect(orange.h).toBeGreaterThan(20)
    expect(orange.h).toBeLessThan(65)
  })

  it('white lightens and black darkens, a drop at a time, every paint', () => {
    for (const p of [Y, B, R]) {
      let last = lch(drops({ [p]: 2 })).L
      for (let n = 1; n <= 6; n++) {
        const L = lch(drops({ [p]: 2, [W]: n })).L
        expect(L, `${PAINTS[p].name} + ${n} white`).toBeGreaterThan(last)
        last = L
      }
      last = lch(drops({ [p]: 6 })).L
      for (let n = 1; n <= 3; n++) {
        const L = lch(drops({ [p]: 6, [K]: n })).L
        expect(L).toBeLessThan(last)
        last = L
      }
    }
  })
})

describe('the targets', () => {
  /** every recipe of exactly n drops — nested loops, nothing shared with the module's search */
  const exactly = (n: number) => {
    const out: Drops[] = []
    for (let a = 0; a <= n; a++)
      for (let b = 0; a + b <= n; b++)
        for (let c = 0; a + b + c <= n; c++)
          for (let d = 0; a + b + c + d <= n; d++) out.push([a, b, c, d, n - a - b - c - d])
    return out
  }

  it('each has a par no bigger than its recipe, a recipe at par that matches, and none below it', () => {
    for (const t of TARGETS) {
      const target = targetColour(t)
      const f = fewest(target)!
      expect(f, t.name).not.toBeNull()
      expect(f.n).toBeLessThanOrEqual(total(t.recipe))
      expect(difference(colourOf(f.drops), target)).toBeLessThan(MATCH)
      for (let n = 1; n < f.n; n++)
        for (const d of exactly(n))
          expect(difference(colourOf(d), target), `${t.name} in ${n}: ${d}`).toBeGreaterThanOrEqual(
            MATCH,
          )
    }
  })

  it('are all different from each other, by more than a match', () => {
    for (const a of TARGETS)
      for (const b of TARGETS)
        if (a !== b)
          expect(
            difference(targetColour(a), targetColour(b)),
            `${a.name} ~ ${b.name}`,
          ).toBeGreaterThan(MATCH * 2)
  })

  it('following the hints alone, a drop at a time, gets to a match on every one — in par', () => {
    for (const t of TARGETS) {
      const target = targetColour(t)
      const par = fewest(target)!.n
      const d: Drops = PAINTS.map(() => 0)
      let n = 0
      for (let h = hintFor(d, target); h && h.left > 0 && n < 24; h = hintFor(d, target)) {
        d[h.paint]++
        n++
      }
      expect(difference(colourOf(d), target), `${t.name}: ${d}`).toBeLessThan(MATCH)
      expect(n, t.name).toBe(par)
    }
  })

  it('says so when paint already in the cup puts the target out of reach', () => {
    const plum = targetColour(TARGETS.find((t) => t.name === 'Plum')!)
    expect(plan(drops({ [W]: 6 }), plum)).toBeNull() // six whites: no plum is that pale
    expect(hintFor(drops({ [W]: 6 }), plum)).toBeNull()
    expect(plan(drops({ [B]: 1, [R]: 2 }), plum)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('words and records', () => {
  it('says how yours differs, the way a painter would', () => {
    expect(words(colourOf(drops({ [B]: 1, [W]: 1 })), colourOf(drops({ [B]: 1, [W]: 4 })))).toMatch(
      /^darker/,
    )
    expect(words(colourOf(drops({ [Y]: 2, [B]: 1 })), colourOf(drops({ [Y]: 2, [B]: 1 })))).toBe(
      'a match',
    )
    expect(words(colourOf(drops({ [Y]: 3, [R]: 1 })), colourOf(drops({ [Y]: 1, [R]: 3 })))).toMatch(
      /more (orange|yellow)/,
    )
  })
  it('stars, and a record read back with its damage dropped', () => {
    expect([3, 4, 5, 6].map((n) => stars(3, n))).toEqual([3, 2, 2, 1])
    expect(
      readSaved(
        JSON.stringify({ best: { Leaf: 4, Sky: 0, Teal: 2.5, Nope: 3, Peach: 30, Rose: 6 } }),
      ),
    ).toEqual({ best: { Leaf: 4, Rose: 6 } })
    expect(readSaved('{')).toEqual({ best: {} })
  })
})
