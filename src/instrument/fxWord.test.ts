import { describe, expect, it } from 'vitest'
import type { Fx } from '../audio/synth'
import { fxWord } from './fxWord'

/**
 * Pinned before it moved out of InstrumentRoom.tsx, so the move is proven to change nothing.
 * Every expectation is what a layer row should say for a sound somebody could make — never the
 * thresholds' arithmetic.
 */
describe('a layer’s effects in a couple of words', () => {
  const fx = (over: Partial<Fx>): Fx => ({
    echo: 0,
    echoTime: 0.26,
    space: 0,
    vibrato: 0,
    glide: 0,
    tone: 0.5,
    ...over,
  })

  it('says dry when nothing is on', () => {
    expect(fxWord(fx({}))).toBe('dry')
  })

  it('names each effect that is really on, in a fixed order', () => {
    expect(fxWord(fx({ echo: 0.4 }))).toBe('echo')
    expect(fxWord(fx({ space: 0.6 }))).toBe('room')
    expect(fxWord(fx({ vibrato: 0.3 }))).toBe('wobble')
    expect(fxWord(fx({ glide: 0.5 }))).toBe('slide')
    expect(fxWord(fx({ glide: 0.5, echo: 0.4, space: 0.6, vibrato: 0.3 }))).toBe(
      'echo + room + wobble + slide',
    )
  })

  it('ignores a trace, and a little room, which every sound has', () => {
    expect(fxWord(fx({ echo: 0.01, vibrato: 0.01, glide: 0.01, space: 0.2 }))).toBe('dry')
  })

  it('and never mentions echo time or tone, which shape an effect rather than add one', () => {
    expect(fxWord(fx({ echoTime: 0.9, tone: 0.1 }))).toBe('dry')
  })
})
