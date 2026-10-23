import { describe, expect, it } from 'vitest'
import {
  FLOOR_QUALITY,
  FULL_BYTES,
  MAX_QUALITY,
  THUMB_BYTES,
  clampQuality,
  fitWithin,
  nextQuality,
  savedBy,
  sayBytes,
} from './shrink'

describe('fitting a picture inside an edge', () => {
  it('leaves a small one alone rather than enlarging it', () => {
    expect(fitWithin(200, 150, 1600)).toEqual({ w: 200, h: 150 })
  })

  it('fits the long edge, whichever edge that is', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 })
    /* the same picture stood up: the long edge is still the one that lands on 1600 */
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 })
  })

  /**
   * ⚠️ THE SHAPE IS THE CLAIM, not the arithmetic. Asserting `1600 x 1200` for one case says the
   * sum was done; asserting that the ratio survives says the picture is not distorted, which is
   * the thing a person would see. Swept rather than sampled, because an off-by-one in the
   * rounding only shows at particular sizes.
   */
  it('keeps the shape it was given, over 300 sizes', () => {
    let seed = 20261022
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let i = 0; i < 300; i++) {
      const w = 1 + Math.floor(rnd() * 6000)
      const h = 1 + Math.floor(rnd() * 6000)
      const got = fitWithin(w, h, 1600)
      expect(Math.max(got.w, got.h)).toBeLessThanOrEqual(1600)
      expect(got.w).toBeGreaterThanOrEqual(1)
      expect(got.h).toBeGreaterThanOrEqual(1)
      /* never enlarged */
      expect(got.w).toBeLessThanOrEqual(w)
      expect(got.h).toBeLessThanOrEqual(h)
      /* and the long edge lands exactly on the contract rather than near it */
      expect(Math.max(got.w, got.h)).toBe(Math.min(1600, Math.max(w, h)))
      /**
       * ⚠️ THE TOLERANCE COMES FROM THE SHORT EDGE, and a flat percentage here was wrong. This
       * first read `< 0.02` and failed at **5720x9 -> 1600x3**: exact is 1600 x 2.52, so rounding
       * to 3 is 16.1% off the ratio. The code is right — whole pixels cannot preserve a ratio
       * better than half a pixel on the shorter side, and on a 3px edge one pixel IS 33% — so the
       * bound has to be the physical limit rather than a number that felt tidy. On an ordinary
       * 1600x1200 that is 1/1200, which is tight enough to catch a real distortion.
       */
      const short = Math.min(got.w, got.h)
      const was = w / h
      const now = got.w / got.h
      expect(Math.abs(now - was) / was).toBeLessThanOrEqual(1 / short)
    }
  })

  /**
   * ⚠️ A PANORAMA IS WHERE A NAIVE SCALE ROUNDS AN EDGE TO ZERO, and a canvas of height 0 throws
   * rather than drawing something odd — so this is a crash, not a cosmetic fault. 8000x20 at an
   * edge of 320 wants a height of 0.8.
   */
  it('never rounds an edge away to nothing', () => {
    /**
     * ⚠️ THE NUMBERS HAVE TO REACH ZERO, and the first version of this did not. It used 8000x20,
     * which scales to 0.8 and rounds to 1 WITHOUT any floor — so it passed with the floor removed
     * and read as coverage of the thing it is named after. 8000x10 scales to 0.4, which is the
     * side of the rounding that actually produces a zero, and a canvas of height 0 throws rather
     * than drawing something odd.
     */
    expect(fitWithin(8000, 10, 320)).toEqual({ w: 320, h: 1 })
    expect(fitWithin(10, 8000, 320)).toEqual({ w: 1, h: 320 })
    /* and the one that merely rounds up on its own is still right */
    expect(fitWithin(8000, 20, 320).h).toBe(1)
  })

  it('has no opinion about a picture with no size', () => {
    expect(fitWithin(0, 100, 1600)).toEqual({ w: 0, h: 0 })
    expect(fitWithin(100, 100, 0)).toEqual({ w: 0, h: 0 })
  })
})

describe('walking the quality down to a budget', () => {
  it('stops as soon as it fits', () => {
    expect(nextQuality(100_000, FULL_BYTES, 0.8)).toBe(null)
  })

  it('steps further when it is further over', () => {
    /* three times over wants a much lower guess than a whisker over */
    const far = nextQuality(600_000, 200_000, 0.9)
    const near = nextQuality(210_000, 200_000, 0.9)
    expect(far).not.toBe(null)
    expect(near).not.toBe(null)
    expect(far!).toBeLessThan(near!)
  })

  it('always moves, even when the proportional guess would not', () => {
    /* one byte over: the proportional step rounds to the quality it was just handed, and a
       ladder that proposes what it just tried is a loop rather than a search */
    const q = nextQuality(200_001, 200_000, 0.8)
    expect(q).not.toBe(null)
    expect(q!).toBeLessThan(0.8)
  })

  it('gives up at the floor rather than going below it', () => {
    expect(nextQuality(9_000_000, 100_000, FLOOR_QUALITY)).toBe(null)
    expect(nextQuality(9_000_000, 100_000, 0.31)).toBe(FLOOR_QUALITY)
  })

  /**
   * ⚠️ THE ONE THAT MATTERS ON A PHONE: this runs a real encode each time round, so a ladder that
   * does not terminate is a locked tab rather than a slow one. Driven against a stand-in encoder
   * whose size falls with quality, from every starting point, it has to reach an answer.
   */
  it('terminates from any starting quality, against a stand-in encoder', () => {
    const budget = THUMB_BYTES
    for (let start = 30; start <= 100; start++) {
      let q: number | null = start / 100
      let rounds = 0
      while (q !== null) {
        /* a plausible shape: bytes fall roughly with quality, and never below a floor */
        const bytes = Math.round(40_000 + 900_000 * q * q)
        const next: number | null = nextQuality(bytes, budget, q)
        if (next === null) break
        expect(next).toBeLessThan(q)
        q = next
        if (++rounds > 40) throw new Error(`did not terminate from ${start / 100}`)
      }
      expect(rounds).toBeLessThanOrEqual(40)
    }
  })

  /** a picture that can never fit still stops, at the floor, rather than refusing for ever */
  it('bottoms out instead of looping on something that cannot fit', () => {
    let q: number | null = 0.95
    let rounds = 0
    while (q !== null && rounds < 50) {
      const next: number | null = nextQuality(5_000_000, 1000, q)
      if (next === null) break
      q = next
      rounds++
    }
    expect(q).toBe(FLOOR_QUALITY)
    expect(rounds).toBeLessThan(50)
  })
})

describe('saying it in words', () => {
  it('rounds hard, because it changes while a slider moves', () => {
    expect(sayBytes(900)).toBe('900 B')
    expect(sayBytes(188_000)).toBe('184 KB')
    expect(sayBytes(4_000_000)).toBe('3.8 MB')
    expect(sayBytes(0)).toBe('0 KB')
  })

  it('says how much smaller, and says nothing when that is nothing', () => {
    expect(savedBy(4_000_000, 200_000)).toBe('20× smaller')
    expect(savedBy(500_000, 200_000)).toBe('2.5× smaller')
    /* under a tenth saved is not a thing worth a line of its own */
    expect(savedBy(210_000, 200_000)).toBe(null)
    expect(savedBy(100, 200)).toBe(null)
    expect(savedBy(0, 200)).toBe(null)
  })
})

describe('the band the dial offers', () => {
  /**
   * ⚠️ THE TOP OF THE DIAL IS 0.95 AND NOT 1, AND THIS IS THE ONE RULE THAT MATTERS. WebP quality
   * 1.0 is a different encoder mode, not the last notch of a curve — measured at 3.83 MB against
   * 1.19 MB at 0.95 on the same 1600×1067 image — so asking for it blows the ceiling, triggers
   * the walk-down, and lands at 0.51. The dial's top notch was the second-worst setting on it.
   */
  it('never offers a quality the encoder treats as a different mode', () => {
    expect(MAX_QUALITY).toBeLessThan(1)
    expect(clampQuality(1)).toBe(MAX_QUALITY)
    expect(clampQuality(0.99)).toBe(MAX_QUALITY)
  })

  it('holds a quality inside the band, from either end', () => {
    expect(clampQuality(0)).toBe(FLOOR_QUALITY)
    expect(clampQuality(-5)).toBe(FLOOR_QUALITY)
    expect(clampQuality(0.6)).toBe(0.6)
    expect(clampQuality(MAX_QUALITY)).toBe(MAX_QUALITY)
    expect(clampQuality(FLOOR_QUALITY)).toBe(FLOOR_QUALITY)
  })

  /** NaN is what an empty number input gives you, and it must not become a 3.83 MB upload */
  it('reads nonsense as the top of the band rather than as 1', () => {
    expect(clampQuality(Number.NaN)).toBe(MAX_QUALITY)
    expect(clampQuality(Number.POSITIVE_INFINITY)).toBe(MAX_QUALITY)
  })

  /**
   * ⚠️ THE WALK-DOWN IS ONLY EVER CATASTROPHIC FROM THE CLIFF, which is why the cap is the fix
   * rather than a cleverer `nextQuality`. Stepping down from the capped top, the proportional
   * guess is a sane neighbour; stepping down from 1.0 it was less than half.
   */
  it('steps down gently from the capped top, where it did not from 1.0', () => {
    /* the measured cliff: 3.83 MB at q 1.0 against a 2 MB ceiling */
    expect(nextQuality(4_019_718, FULL_BYTES, 1)).toBeLessThan(0.6)
    /* and from the cap, a plausible photograph over the ceiling */
    const fromCap = nextQuality(2_600_000, FULL_BYTES, MAX_QUALITY)
    expect(fromCap).not.toBeNull()
    expect(fromCap!).toBeGreaterThan(0.7)
  })
})
