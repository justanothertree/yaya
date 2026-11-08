import { describe, expect, it } from 'vitest'
import { heardTime } from './heard'

/**
 * The playhead's clock, asked about devices this machine does not have.
 *
 * ⚠️ THE NUMBERS ARE A HEADSET'S, NOT THE FORMULA'S: a quarter of a second behind is what a
 * Bluetooth output plausibly reports, and the expectation is "the sound you hear left the
 * renderer that long ago" — a fact about the device, not a rearrangement of the code.
 */
describe('what is reaching the speaker', () => {
  it('trails the render clock by what the output timestamp says', () => {
    /* the output reported context time 9.75 reaching the speaker at performance time 1000ms;
       20ms later it is hearing 9.77, while the renderer is already at 10 */
    const ctx = {
      currentTime: 10,
      getOutputTimestamp: () => ({ contextTime: 9.75, performanceTime: 1000 }),
    }
    expect(heardTime(ctx, 1020)).toBeCloseTo(9.77, 6)
  })

  it('falls back to the latency estimate before the output has a timestamp', () => {
    const ctx = {
      currentTime: 10,
      outputLatency: 0.25,
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    }
    expect(heardTime(ctx, 5000)).toBeCloseTo(9.75, 6)
  })

  it('and to the render clock when the browser says nothing at all', () => {
    expect(heardTime({ currentTime: 3 }, 0)).toBe(3)
    expect(heardTime({ currentTime: 3, outputLatency: NaN }, 0)).toBe(3)
  })

  it('is never ahead of what has been rendered, whatever a timestamp claims', () => {
    const ctx = {
      currentTime: 4,
      getOutputTimestamp: () => ({ contextTime: 3.9, performanceTime: 100 }),
    }
    /* a stale timestamp carried a whole second forward would land past the renderer */
    expect(heardTime(ctx, 1100)).toBe(4)
  })

  it('survives a context that refuses to answer', () => {
    const ctx = {
      currentTime: 2,
      outputLatency: 0.1,
      getOutputTimestamp: () => {
        throw new Error('closed')
      },
    }
    expect(heardTime(ctx, 0)).toBeCloseTo(1.9, 6)
  })
})
