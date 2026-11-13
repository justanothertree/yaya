import { describe, expect, it } from 'vitest'
import { seeded as archery } from './archery'
import { rng } from './bricks'
import { seeded as codebreaker } from './codebreaker'
import { seeded as dice } from './dice'
import { seeded as fireworks } from './fireworks'
import { seeded as lava } from './lava'
import { seeded as pegdrop } from './pegdrop'
import { seeded as poker } from './poker'
import { seeded as rps } from './rps'
import { seeded as stack } from './stack'

/**
 * Every daily puzzle, every seeded deal and every test that plays a fixed game rests on these
 * numbers, so a change to the generator is a change to all of them. Ten modules had their own copy;
 * they now share bricks.ts's, and this says the sharing changed nothing.
 */
describe('the seeded generator', () => {
  it('gives the numbers it always has', () => {
    const r = rng(1)
    expect([r(), r(), r()]).toEqual([
      0.00006295018829405308, 0.015747428173199296, 0.6164041024167091,
    ])
    const t = rng(20261112)
    expect([t(), t(), t()]).toEqual([0.1304497302044183, 0.2034371446352452, 0.920417565619573])
    // a seed of nought is not a stuck generator
    const z = rng(0)
    expect(z()).toBeGreaterThan(0)
  })
  it('is the same generator in every module that offers one', () => {
    for (const make of [archery, codebreaker, dice, fireworks, lava, pegdrop, poker, rps, stack])
      for (const seed of [0, 1, 7, 12345, 2 ** 31 + 5, 20261112]) {
        const a = make(seed)
        const b = rng(seed)
        for (let k = 0; k < 200; k++) expect(a()).toBe(b())
      }
  })
})
