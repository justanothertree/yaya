import { describe, expect, it } from 'vitest'
import { HOLD_FLOOR_MS, holdDelay, msToFullSpeed, stepsWithin } from './hold'

/**
 * ⚠️ EVERY NUMBER BELOW COMES FROM THE CLAIM, NOT FROM THE CONSTANTS. "A plus and minus button to
 * really adjust single increments that I can easily press and hold to ramp faster" is a sentence
 * with quantities in it: a tap is ONE, a short hold is a handful, a long hold crosses an hour,
 * and it never goes so fast that letting go lands somewhere you did not choose. Asserting
 * `holdDelay(1) === 180` would just be the constant typed twice — green whatever the ramp feels
 * like, which is the failure CLAUDE.md §2 keeps describing.
 */
describe('the ramp a held button follows', () => {
  /** a person's click is 60–120ms; anything in that range must not repeat */
  it('treats a tap as exactly one step', () => {
    for (const press of [10, 60, 120, 250, 399]) expect(stepsWithin(press), `${press}ms`).toBe(1)
  })

  it('starts repeating soon after a deliberate hold, not instantly', () => {
    expect(stepsWithin(401)).toBe(2)
    /* half a second of holding is a nudge, not a scroll */
    expect(stepsWithin(500)).toBeLessThanOrEqual(2)
  })

  it('never speeds up before the first repeat', () => {
    expect(holdDelay(0)).toBeGreaterThan(holdDelay(1))
  })

  it('only ever gets faster', () => {
    for (let i = 0; i < 200; i++)
      expect(holdDelay(i + 1), `step ${i + 1}`).toBeLessThanOrEqual(holdDelay(i))
  })

  /**
   * ⚠️ 25ms COMES FROM THE PERSON, NOT FROM THE CONSTANT, and the first version of this test got
   * that wrong. It asserted `holdDelay(i) >= HOLD_FLOOR_MS` — both sides out of the same number,
   * so it agreed with whatever the floor happened to be, including zero. Perturbing `FAST` to 0
   * left it green. The claim worth holding is about a hand: letting go has to land where you
   * meant, so the gap between steps cannot be shorter than it takes to notice one. 25ms is
   * 40 steps a second, already past that; `HOLD_FLOOR_MS` is still checked, but only for the
   * weaker property that the ramp actually REACHES its floor rather than approaching it.
   */
  it('has a floor a hand can keep up with', () => {
    for (let i = 0; i < 500; i++) expect(holdDelay(i), `step ${i}`).toBeGreaterThanOrEqual(25)
    expect(holdDelay(10_000), 'settles exactly on the floor').toBe(HOLD_FLOOR_MS)
  })

  it('reaches full speed inside a couple of seconds of holding', () => {
    const at = msToFullSpeed()
    expect(at).toBeGreaterThan(900)
    expect(at).toBeLessThan(2600)
  })

  /**
   * The sentence this ramp is making, in minutes, for the chronicle time editor where one step is
   * one minute. These are deliberately wide ranges: the claim is about the FEEL, and pinning it
   * to an exact count would make the test a copy of the arithmetic again.
   */
  it('moves a sensible number of minutes for how long you hold', () => {
    const oneSecond = stepsWithin(1000)
    expect(oneSecond, 'a second should be a few minutes, not a jump').toBeGreaterThanOrEqual(3)
    expect(oneSecond).toBeLessThanOrEqual(10)

    const threeSeconds = stepsWithin(3000)
    expect(threeSeconds, 'three seconds should cross half an hour-ish').toBeGreaterThan(20)
    expect(threeSeconds, 'and not a whole day').toBeLessThan(80)

    const tenSeconds = stepsWithin(10_000)
    expect(tenSeconds, 'ten seconds of holding should cross hours').toBeGreaterThan(150)
    expect(tenSeconds, 'but still be something you could stop in time').toBeLessThan(400)
  })

  /** monotonic in the obvious direction: holding longer never moves you less far */
  it('never moves less far for holding longer', () => {
    let last = 0
    for (let ms = 0; ms <= 8000; ms += 37) {
      const n = stepsWithin(ms)
      expect(n, `${ms}ms`).toBeGreaterThanOrEqual(last)
      last = n
    }
  })
})
