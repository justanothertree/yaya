import { describe, expect, it } from 'vitest'
import { analyse, singLine, type Style } from './sing'
import { SR, hiss, vowel } from './voiceFixture'

/*
 * Where a sung syllable lands, read off the output's own loudness — one syllable at a time, because
 * in a legato line the last syllable is still sounding when the next begins and an onset cannot be
 * read off the sum.
 */

const HARD: Style = {
  hard: true,
  vibrato: false,
  formant: 1,
  transpose: 0,
  cents: 0,
  stutter: false,
}

/** "sa": 60ms of hiss and then a vowel, as a voice would say it */
function word(): Float32Array {
  const x = new Float32Array(Math.round(SR * 0.5))
  x.set(hiss(0.06, 0.06, 3), Math.round(SR * 0.04))
  x.set(vowel(210, 0.3), Math.round(SR * 0.1))
  return x
}

/** loudness every 5ms */
function envelope(y: Float32Array): Float32Array {
  const hop = SR * 0.005
  const e = new Float32Array(Math.ceil(y.length / hop))
  for (let f = 0; f < e.length; f++) {
    let s = 0
    for (let i = f * hop; i < Math.min(y.length, (f + 1) * hop); i++) s += y[i] * y[i]
    e[f] = Math.sqrt(s / hop)
  }
  return e
}

const rms = (y: Float32Array, a: number, b: number) => {
  let s = 0
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += y[i] * y[i]
  return Math.sqrt(s / (Math.round(b * SR) - Math.round(a * SR)))
}

describe('singLine', () => {
  const spoken = [analyse(word(), SR, 1)]
  const note = (t: number, end: number) => ({
    word: 0,
    syl: 0,
    t,
    end,
    pitches: [{ at: t, midi: 64 }],
  })

  it('puts the vowel on the beat and the consonant before it', () => {
    const y = singLine([note(0.5, 0.9)], spoken, HARD, 0.5)
    const e = envelope(y)
    let top = 0
    for (let f = 100; f < 180; f++) top = Math.max(top, e[f])
    let on = 60
    while (e[on] < top * 0.5) on++
    expect(Math.abs(on * 0.005 - 0.5)).toBeLessThanOrEqual(0.015)
    /* the hiss sits in the 60ms before the beat, over a silence before it */
    expect(rms(y, 0.445, 0.49)).toBeGreaterThan(rms(y, 0.2, 0.4) * 10)
  })

  it('holds to the end of the note and stops there', () => {
    const y = singLine([note(0.5, 1.4)], spoken, HARD, 0.5)
    expect(rms(y, 1.3, 1.38)).toBeGreaterThan(rms(y, 0.6, 0.7) * 0.3)
    expect(rms(y, 1.42, 1.6)).toBeLessThan(rms(y, 0.6, 0.7) * 0.01)
  })

  it('squeezes a syllable into a note shorter than it, still starting before the beat', () => {
    const y = singLine([note(0.5, 0.6)], spoken, HARD, 0.5)
    expect(rms(y, 0.45, 0.6)).toBeGreaterThan(0)
    expect(rms(y, 0.62, 0.8)).toBeLessThan(rms(y, 0.5, 0.58) * 0.01)
  })
})
