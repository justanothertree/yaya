import { describe, expect, it } from 'vitest'
import { MAKERS, VISUALS } from '../audio/visualModes'
import { BUILDERS } from './clickFx'
import { FX_STYLE_OPTIONS } from './fxStyles'

/**
 * Everything offered can be chosen, and everything choosable is offered.
 *
 * ⚠️ THE COMPILER HOLDS THREE SIDES OF THIS AND NOT THE FOURTH. `MAKERS` is
 * `Record<VisualId, () => Visual>` and `BUILDERS` is `Record<FxStyle, …>`, so a mode in the
 * type without an implementation does not compile — that edge is safe and needs no test. But
 * `VISUALS` and `FX_STYLE_OPTIONS` are plain ARRAYS of tuples, and an array does not have to be
 * exhaustive. A style can be declared, implemented, working, and simply absent from the list
 * the picker is built from: present and unchoosable, with nothing to notice it but somebody
 * counting.
 *
 * It is the same failure `presets.test.ts` guards for the instrument list, where the shape has
 * already been worth catching, and the same one the arpeggio bug was in a different key — a
 * thing that exists without a control that reaches it.
 *
 * ⚠️ CHECKED AT RUNTIME RATHER THAN BY PARSING THE SOURCE. The first version of this read the
 * files and regexed the union out of them, which is fragile in exactly the way a test must not
 * be: it would go quietly green the day somebody reformatted a type. Both modules import
 * cleanly in node — probed before relying on it — so the lists and the maps can simply be
 * compared as the values they are.
 */

describe('the visualiser modes', () => {
  it('offers every mode that has a maker, and no more', () => {
    expect(VISUALS.map(([id]) => id).sort()).toEqual(Object.keys(MAKERS).sort())
  })

  it('offers each one once', () => {
    const ids = VISUALS.map(([id]) => id)
    expect(new Set(ids).size, 'a duplicate is one entry nobody can reach').toBe(ids.length)
  })

  it('gives every mode a label and a glyph, and a sane fade', () => {
    for (const [id, glyph, label, fade] of VISUALS) {
      expect(glyph.length, id).toBeGreaterThan(0)
      expect(label.length, id).toBeGreaterThan(0)
      /* how much of the previous frame lingers — outside 0..1 is either no trail at all or a
         frame that never clears */
      expect(fade, id).toBeGreaterThanOrEqual(0)
      expect(fade, id).toBeLessThanOrEqual(1)
    }
  })
})

describe('the click flairs', () => {
  it('offers every style that has a builder, and no more', () => {
    expect(FX_STYLE_OPTIONS.map(([id]) => id).sort()).toEqual(Object.keys(BUILDERS).sort())
  })

  it('offers each one once, with its own label and glyph', () => {
    const ids = FX_STYLE_OPTIONS.map(([id]) => id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(FX_STYLE_OPTIONS.map(([, , label]) => label)).size).toBe(ids.length)
    for (const [id, glyph, label] of FX_STYLE_OPTIONS) {
      expect(glyph.length, id).toBeGreaterThan(0)
      expect(label.length, id).toBeGreaterThan(0)
    }
  })
})

describe('both lists', () => {
  it('are long enough that the next one added is an addition, not a rewrite', () => {
    /* a floor rather than an exact count: a test asserting "33" is a second copy of the list
       that has to be edited every time the list is, which the backup suite calls out by name */
    expect(FX_STYLE_OPTIONS.length).toBeGreaterThanOrEqual(30)
    expect(VISUALS.length).toBeGreaterThanOrEqual(30)
  })
})
