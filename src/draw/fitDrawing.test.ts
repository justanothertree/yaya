import { describe, expect, it } from 'vitest'
import {
  fitDrawing,
  packDrawing,
  simplifyDrawing,
  THIN_LADDER,
  type Drawing,
  type Stroke,
} from './strokes'

/**
 * Making a drawing fit where it has to go.
 *
 * ⚠️ THERE WERE THREE ANSWERS TO ONE QUESTION, AND TWO OF THEM SAID NO. The park thinned down a
 * ladder until a creature fitted the wire; a pet block thinned ONCE at a fixed tolerance and
 * greyed out anything still too big; an art block did not thin at all and answered "too many
 * strokes for one block — try a simpler drawing". That last one is the maker and the site
 * contradicting each other: the paint room says draw whatever you like and the profile says not
 * that. simplifyDrawing's own note says it was written for exactly the block case, and the block
 * was the one place that never called it.
 *
 * ⚠️ AND THE PROPERTY THAT MATTERS IS "NO HARDER THAN IT HAS TO". A ladder that always went to
 * the bottom rung would fit everything and make every drawing worse, which is the failure mode
 * nobody would report because it looks like the drawing was always like that.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.03,
  p: [0.3, 0.3, 0.7, 0.7],
  ...over,
})

/** a hand-drawn stroke: many samples along a curve, which is where the redundancy is */
const drawn = (strokes: number, points: number): Drawing => ({
  v: 1,
  name: 'Creature',
  ratio: 1,
  bg: null,
  strokes: Array.from({ length: strokes }, (_, i) =>
    stroke({
      p: Array.from({ length: points * 2 }, (_, k) => {
        const t = (k >> 1) / points
        return k % 2 === 0 ? 0.2 + 0.6 * t : 0.5 + 0.25 * Math.sin(t * Math.PI + i)
      }),
    }),
  ),
})

const chars = (d: Drawing) => JSON.stringify(packDrawing(d)).length
const packedChars = (p: unknown) => JSON.stringify(p).length

describe('thinning until it fits', () => {
  it('leaves a drawing that already fits alone', () => {
    const small = drawn(4, 12)
    const room = chars(small) * 4
    const out = fitDrawing(small, packDrawing, (p) => packedChars(p) <= room)
    /* the first rung is the tolerance everything was always packed at, so this is what the park
       and the blocks have been sending all along */
    expect(packedChars(out)).toBe(packedChars(packDrawing(simplifyDrawing(small, THIN_LADDER[0]))))
  })

  /**
   * ⚠️ NO HARDER THAN IT HAS TO. A tight budget should cost more detail than a loose one — if
   * both came back the same size, the ladder would be going straight to the bottom and quietly
   * flattening every drawing on the site.
   */
  /* ⚠️ the budgets straddle what it packs to at the first rung, which is 7,536 for this
     creature — measured, because packing is far better than it looks and a pair of budgets
     picked by eye were both above it, so the same rung answered both and the test proved
     nothing */
  it('and thins harder for a tighter budget than a loose one', () => {
    const big = drawn(60, 60)
    const atFirstRung = packedChars(packDrawing(simplifyDrawing(big, THIN_LADDER[0])))
    const loose = fitDrawing(big, packDrawing, (p) => packedChars(p) <= atFirstRung)
    const tight = fitDrawing(big, packDrawing, (p) => packedChars(p) <= atFirstRung / 2)
    expect(packedChars(loose)).toBe(atFirstRung)
    expect(packedChars(tight)).toBeLessThan(packedChars(loose))
  })

  it('and gets an elaborate creature into a profile block', () => {
    const elaborate = drawn(120, 80)
    const BLOCK = 64000
    /* 79,720 packed — over a block, and the test is worthless if the fixture already fits */
    expect(
      chars(elaborate),
      'the fixture already fits, so nothing is being tested',
    ).toBeGreaterThan(BLOCK)
    const out = fitDrawing(elaborate, packDrawing, (p) => packedChars(p) <= BLOCK)
    expect(packedChars(out), 'it should have got in').toBeLessThanOrEqual(BLOCK)
  })

  /**
   * ⚠️ AND IT STILL HANDS BACK THE ROUGHEST ATTEMPT WHEN NOTHING FITS, rather than null. The
   * caller still has to ask whether the answer fits — an art block does, and refuses — but it
   * gets the best available copy to say that about instead of nothing.
   */
  it('and returns something even when nothing it can do is enough', () => {
    const out = fitDrawing(drawn(60, 60), packDrawing, () => false)
    expect(out, 'it gave up and returned nothing').toBeTruthy()
    const bottom = packDrawing(simplifyDrawing(drawn(60, 60), THIN_LADDER[THIN_LADDER.length - 1]))
    expect(packedChars(out), 'and it is the roughest rung').toBe(packedChars(bottom))
  })

  it('and the ladder only ever gets coarser', () => {
    expect(THIN_LADDER.length).toBeGreaterThan(1)
    for (let i = 1; i < THIN_LADDER.length; i++) {
      expect(THIN_LADDER[i], `rung ${i} is not coarser than ${i - 1}`).toBeGreaterThan(
        THIN_LADDER[i - 1],
      )
    }
  })

  /** ⚠️ only the copy that travels — the gallery keeps every point somebody drew */
  it('and never touches the drawing it was given', () => {
    const art = drawn(20, 40)
    const before = JSON.stringify(art)
    fitDrawing(art, packDrawing, (p) => packedChars(p) <= 500)
    expect(JSON.stringify(art), 'it thinned the original').toBe(before)
  })
})
