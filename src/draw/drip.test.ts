import { describe, expect, it } from 'vitest'
import { dripsFrom, RUN_MOST, type Drop } from './drip'
import { simplifyDrawing } from './strokes'
import type { Drawing, Stroke } from './strokes'

/** a wandering line, long enough that a 12%-wet brush sheds a useful number of runs */
const line = (n: number): number[] => {
  const p: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    p.push(0.1 + t * 0.8, 0.5 + Math.sin(t * 7) * 0.12)
  }
  return p
}

const stroke = (p: number[]): Stroke => ({ t: 'drip', c: '#222', a: 1, w: 0.03, p })
const drawing = (p: number[]): Drawing => ({
  v: 1,
  name: 'Wet',
  ratio: 1,
  bg: null,
  strokes: [stroke(p)],
})

const key = (d: Drop) => `${d.x},${d.y},${d.fall},${d.thick}`

describe('ink too wet to stay where you put it', () => {
  it('says the same thing twice', () => {
    const p = line(120)
    expect(dripsFrom(p, 0.03)).toEqual(dripsFrom(p, 0.03))
  })

  /**
   * ⚠️ THE BOUND IS IN BRUSH WIDTHS, ASKED OF THE CONSTANT THAT STATES IT. A run that can grow
   * without limit is a curtain down the page, and the thing that stops it must be the sentence in
   * the file rather than a number typed in here — so this reads RUN_MOST rather than 6.
   */
  it('and a run is never longer than the brush can carry', () => {
    for (const w of [0.004, 0.012, 0.03, 0.08, 0.2]) {
      for (const d of dripsFrom(line(200), w)) {
        expect(d.fall, `w ${w}`).toBeGreaterThan(0)
        expect(d.fall, `w ${w}`).toBeLessThanOrEqual(RUN_MOST * w)
        /* and a run is thinner than the line it escaped, or it is a second stroke */
        expect(d.thick, `w ${w}`).toBeLessThan(w)
      }
    }
  })

  /**
   * ⚠️ THE WHOLE REASON THE SEED IS A POSITION. This is the invariant that would break silently
   * and cost somebody their picture: a drawing on its way to the account is thinned by
   * `simplifyDrawing` to fit a byte ceiling, and this brush is freehand, so its points really do
   * get removed. Every drip that survives has to be the SAME drip, in the same place, at the same
   * length — the kept picture must be the drawn picture, a little drier.
   *
   * Asked as a subset rather than as equality, because losing runs is exactly what thinning is
   * allowed to do.
   */
  it('and thinning a drawing can only take runs away, never move them', () => {
    const p = line(240)
    const full = new Set(dripsFrom(p, 0.03).map(key))
    for (const tol of [0.0005, 0.002, 0.008, 0.03]) {
      const thinned = simplifyDrawing(drawing(p), tol).strokes[0].p
      expect(thinned.length, `tol ${tol} really did thin it`).toBeLessThan(p.length)
      for (const d of dripsFrom(thinned, 0.03)) {
        expect(full.has(key(d)), `tol ${tol}: ${key(d)} is not one of the originals`).toBe(true)
      }
    }
  })

  /**
   * ⚠️ AND IT IS NOT A COMB. Runs all of one length read as a fringe somebody drew on purpose,
   * which is the opposite of ink escaping. Asked across a whole stroke rather than between two
   * points, because any two drips may happen to agree.
   */
  it('and no two runs are the same length by design', () => {
    const lens = new Set(dripsFrom(line(300), 0.03).map((d) => d.fall.toFixed(6)))
    expect(lens.size, 'distinct run lengths').toBeGreaterThan(3)
  })

  /**
   * ⚠️ SLOW HANDS SHED MORE INK, which is the brush answering the gesture. Nothing stores how
   * fast anybody drew — but points land as the pointer moves, so a slow passage is a dense one.
   * Two strokes over the SAME ground, one sampled finely and one coarsely, must differ in how wet
   * they are, or the brush is ignoring the only record of speed there is.
   */
  it('and a slow hand leaves more of it than a quick one', () => {
    const slow = dripsFrom(line(400), 0.03).length
    const quick = dripsFrom(line(40), 0.03).length
    expect(slow).toBeGreaterThan(quick)
  })

  it('and a dry stroke is allowed — not every line weeps', () => {
    /* two points is a dab; at 12% wet it may shed nothing, and nothing is a valid answer */
    expect(() => dripsFrom([0.5, 0.5], 0.03)).not.toThrow()
    expect(dripsFrom([], 0.03)).toEqual([])
  })

  it('and refuses a width that is not one', () => {
    for (const w of [0, -1, Number.NaN]) expect(dripsFrom(line(100), w)).toEqual([])
  })

  it('and ignores a point that is not a point', () => {
    const p = [0.2, 0.3, Number.NaN, 0.4, 0.5, Number.NaN, 0.6, 0.7]
    for (const d of dripsFrom(p, 0.03)) {
      expect(Number.isFinite(d.x)).toBe(true)
      expect(Number.isFinite(d.y)).toBe(true)
      expect(Number.isFinite(d.fall)).toBe(true)
    }
  })
})
