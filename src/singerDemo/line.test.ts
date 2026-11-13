import { describe, expect, it } from 'vitest'
import { planLine } from './line'

const notes = [0, 0.5, 1, 1.5, 2, 3].map((t, i) => ({ t, dur: t === 2 ? 1 : 0.5, midi: 60 + i }))

describe('planLine', () => {
  it('keeps each syllable with the word it came from', () => {
    const { words, sung } = planLine('glit-ter in the dark', notes)
    expect(words.map((w) => [w.text, w.syllables])).toEqual([
      ['glitter', 2],
      ['in', 1],
      ['the', 1],
      ['dark', 1],
    ])
    expect(sung.slice(0, 2).map((s) => [s.word, s.syl])).toEqual([
      [0, 0],
      [0, 1],
    ])
  })

  it('carries a hold onto the syllable before it, with the hold note’s pitch', () => {
    const { sung } = planLine('glit-ter in the dark _', notes)
    expect(sung).toHaveLength(5)
    expect(sung[4].end).toBe(3.5)
    expect(sung[4].pitches).toEqual([
      { at: 2, midi: 64 },
      { at: 3, midi: 65 },
    ])
  })

  it('counts words that do not fit rather than dropping them in silence', () => {
    expect(planLine('one two three four five six red blue', notes).spare).toBe(2)
  })
})
