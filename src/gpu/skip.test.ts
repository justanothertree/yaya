import { describe, expect, it } from 'vitest'
import {
  ANGLES,
  BEST_TILT,
  CHALLENGES,
  EMPTY,
  G,
  HAND,
  SLOWEST,
  SPEEDS,
  STEEPEST,
  WOBBLE,
  aim,
  describe as say,
  fly,
  judge,
  readSaved,
  wobble,
  type Throw,
} from './skip'

const OPEN = { shore: 500 }
const good: Throw = { speed: 16, angle: 0, tilt: BEST_TILT }

describe('the three facts the model is built on (Clanet, Hersen & Bocquet 2004)', () => {
  it('skips most at a tilt of about 20°, at every speed', () => {
    for (const speed of [8, 12, 16, 20]) {
      let best = -1
      let at = 0
      for (let tilt = 0; tilt <= 60; tilt++) {
        const n = fly({ speed, angle: 0, tilt }, OPEN).skips
        if (n > best) [best, at] = [n, tilt]
      }
      expect(Math.abs(at - BEST_TILT), `best tilt at ${speed} m/s`).toBeLessThanOrEqual(2)
    }
  })
  it('goes in, never skips, when it comes in steeper than about 45°', () => {
    // thrown hard at the water: its first touch is steeper than the limit
    const f = fly({ speed: 6, angle: -60, tilt: BEST_TILT }, OPEN)
    expect(f.touches[0].incoming).toBeGreaterThan(STEEPEST)
    expect(f.skips).toBe(0)
    // and every skip that did happen came in under it
    for (const h of fly(good, OPEN).touches.filter((t) => t.after > 0))
      expect(h.incoming).toBeLessThan(STEEPEST)
  })
  it('sinks once it is slower along the water than a few metres a second', () => {
    const f = fly(good, OPEN)
    for (const h of f.touches.filter((t) => t.after > 0)) expect(h.before).toBeGreaterThan(SLOWEST)
    expect(fly({ speed: SLOWEST * 0.9, angle: 0, tilt: BEST_TILT }, OPEN).skips).toBe(0)
  })
})

describe('a flight', () => {
  it('first falls from the hand as a stone does: it lands where the textbook arc says', () => {
    // thrown flat from 1 m, it falls 1 m in √(2h/g) — geometry, not the model
    const f = fly({ speed: 10, angle: 0, tilt: BEST_TILT }, OPEN)
    const t = Math.sqrt((2 * HAND) / G)
    expect(f.touches[0].x).toBeCloseTo(10 * t, 1)
    expect(f.touches[0].t).toBeCloseTo(t, 2)
    expect(f.touches[0].incoming).toBeCloseTo((Math.atan2(G * t, 10) * 180) / Math.PI, 0)
  })
  it('only ever loses speed, and after the first hop every hop is shorter than the last', () => {
    // the first hop is a fall from the hand; after that the shrinking is what people see on a lake
    for (const t of [good, { speed: 20, angle: -5, tilt: 22 }, { speed: 9, angle: 8, tilt: 17 }]) {
      const hs = fly(t, OPEN).touches
      for (const h of hs) expect(h.after).toBeLessThanOrEqual(h.before)
      for (let i = 2; i < hs.length; i++)
        expect(hs[i].x - hs[i - 1].x, `hop ${i}`).toBeLessThanOrEqual(hs[i - 1].x - hs[i - 2].x)
    }
  })
  it('a careless throw makes a few skips and a good one tens', () => {
    expect(fly({ speed: 8, angle: 10, tilt: 32 }, OPEN).skips).toBeLessThanOrEqual(4)
    expect(fly({ speed: 20, angle: -4, tilt: BEST_TILT }, OPEN).skips).toBeGreaterThanOrEqual(20)
  })
  it('stops at a bridge it rises into, and at the far shore', () => {
    const bridge = { shore: 500, bridge: { at: 3, width: 2, clear: 0.3 } }
    // thrown up, it is well above 0.3 m at x = 3
    expect(fly({ speed: 12, angle: 20, tilt: BEST_TILT }, bridge).end).toBe('bridge')
    const f = fly({ speed: 20, angle: 0, tilt: BEST_TILT }, { shore: 25 })
    expect(f.end).toBe('shore')
    expect(f.distance).toBe(25)
  })
  it('the replay path is a frame every 1/60 s and lands where the flight ended', () => {
    const f = fly(good, OPEN)
    expect(f.path.length).toBeGreaterThan(f.time * 60 * 0.9)
    expect(f.path.at(-1)![0]).toBeCloseTo(f.distance, 6)
  })
})

describe('throwing', () => {
  it('keeps a pull and an angle inside what a hand can do', () => {
    expect(aim(-1, -90)).toEqual({ speed: SPEEDS.min, angle: ANGLES.min })
    expect(aim(2, 90)).toEqual({ speed: SPEEDS.max, angle: ANGLES.max })
  })
  it('the wobble sweeps 0° to 60° and back, so 20° comes round twice a swing', () => {
    expect(wobble(0)).toBeCloseTo(0, 9)
    expect(wobble(WOBBLE / 2)).toBeCloseTo(60, 9)
    let passes = 0
    for (let i = 0; i < 1600; i++) {
      const a = wobble((i / 1600) * WOBBLE) - BEST_TILT
      const b = wobble(((i + 1) / 1600) * WOBBLE) - BEST_TILT
      if (a * b <= 0) passes++
    }
    expect(passes).toBe(2)
  })
})

describe('the challenges', () => {
  // throws a person could make: any pull, any angle, the tilt wherever the wobble was
  let s = 11
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32)
  const throws = Array.from({ length: 3000 }, () => ({
    ...aim(rand(), ANGLES.min + (ANGLES.max - ANGLES.min) * rand()),
    tilt: wobble(rand() * WOBBLE),
  }))
  it('every one can be done, and the last ones take skill rather than luck', () => {
    const rate: Record<string, number> = {}
    for (const c of CHALLENGES) {
      const passed = throws.filter((t) => judge(c, fly(t, c.course))).length
      rate[c.id] = passed / throws.length
      expect(passed, c.id).toBeGreaterThan(0)
    }
    expect(rate.three).toBeGreaterThan(0.2) // the first is fair to a beginner
    expect(rate.twenty).toBeLessThan(0.05) // the last is not won by flailing
  })
  it('under the bridge means past it and not into it', () => {
    const c = CHALLENGES.find((x) => x.id === 'bridge')!
    // 16 m/s at 25° is about 3 m up at x = 14 (1 + 6.76t − 4.9t², t = 14 / 14.5): into the deck
    const into = fly({ speed: 16, angle: 25, tilt: BEST_TILT }, c.course)
    expect(into.end).toBe('bridge')
    expect(judge(c, into)).toBe(false)
  })
  it('says what happened in words', () => {
    expect(say(fly({ speed: 20, angle: 0, tilt: BEST_TILT }, { shore: 25 }))).toMatch(
      /skips, and reached the far bank\.$/,
    )
    expect(say(fly({ speed: 6, angle: -60, tilt: 20 }, OPEN))).toMatch(/^0 skips, and sank/)
  })
})

describe('what is kept', () => {
  it('round-trips every field away from its default, and drops what makes no sense', () => {
    const s = { best: 17, furthest: 41.5, done: ['three', 'bridge'] }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ best: -1, furthest: 'far', done: ['nope', 3] }))).toEqual(
      EMPTY,
    )
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ done: ['ten', 'ten'] })).done).toEqual(['ten'])
  })
})
