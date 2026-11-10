import { describe, expect, it } from 'vitest'
import { VOWELS, assignSyllables, autoSplit, harmonyAbove, phonesOf, splitLyrics } from './lyrics'
import { degreesOf } from './scales'

/**
 * Lyrics to sung notes. Every expectation is what a person reading the words aloud would say —
 * how a word breaks, which vowel it sings, which note harmonises — never the rule's arithmetic.
 */
describe('typed lyrics become syllables', () => {
  it('hyphens split where you put them, and _ holds', () => {
    expect(
      splitLyrics('glit-ter in the dark _ _ to-night').map((s) => (s.hold ? '_' : s.text)),
    ).toEqual(['glit', 'ter', 'in', 'the', 'dark', '_', '_', 'to', 'night'])
  })

  it('a word without hyphens is split the way it is said', () => {
    expect(autoSplit('glitter')).toEqual(['glit', 'ter'])
    expect(autoSplit('tonight')).toEqual(['to', 'night'])
    expect(autoSplit('twinkle')).toEqual(['twin', 'kle'])
    expect(autoSplit('baby')).toEqual(['ba', 'by'])
    /* a silent e is not a syllable */
    expect(autoSplit('time')).toEqual(['time'])
    expect(autoSplit('love')).toEqual(['love'])
    expect(autoSplit('dark')).toEqual(['dark'])
    /* a y at the start is a consonant */
    expect(autoSplit('you')).toEqual(['you'])
  })
})

describe('syllables land on notes', () => {
  const notes = [0, 0.5, 1, 1.5, 2].map((t) => ({ t, dur: 0.4, midi: 60 }))

  it('one each, in time order, and a hold carries the last vowel', () => {
    const { sung, spare } = assignSyllables(notes, splitLyrics('glit-ter _ dark'))
    expect(sung.map((s) => `${s.text}${s.hold ? '~' : ''}`)).toEqual([
      'glit',
      'ter',
      'ter~',
      'dark',
      'dark~',
    ])
    expect(spare).toBe(0)
  })

  it('notes are taken in time order however they were stored', () => {
    const shuffled = [notes[3], notes[0], notes[2], notes[1]]
    const { sung } = assignSyllables(shuffled, splitLyrics('one two three four'))
    expect(sung.map((s) => s.t)).toEqual([0, 0.5, 1, 1.5])
    expect(sung.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four'])
  })

  it('words left over are counted, not lost', () => {
    const { sung, spare } = assignSyllables(notes.slice(0, 2), splitLyrics('one two three four'))
    expect(sung).toHaveLength(2)
    expect(spare).toBe(2)
  })

  it('a hold with no word before it sings "oo"', () => {
    const { sung } = assignSyllables(notes.slice(0, 1), splitLyrics('_'))
    expect(sung[0].text).toBe('oo')
  })
})

describe('spelling becomes the sound a voice makes', () => {
  const v = (s: string, whole = false) => {
    const p = phonesOf(s, whole)
    return p.to ? `${p.vowel}>${p.to}` : p.vowel
  }

  it('the vowels you would sing', () => {
    expect(v('glit')).toBe('ih')
    expect(v('dark')).toBe('ah')
    expect(v('ter')).toBe('er')
    expect(v('to')).toBe('ah')
    expect(v('moon')).toBe('oo')
    expect(v('see')).toBe('ee')
  })

  it('the diphthongs: night, time, my, make, now', () => {
    expect(v('night')).toBe('ah>ee')
    expect(v('time')).toBe('ah>ee')
    expect(v('my', true)).toBe('ah>ee')
    expect(v('make')).toBe('eh>ee')
    expect(v('now')).toBe('ah>oo')
  })

  it('and the consonants around them', () => {
    expect(phonesOf('sky').onset).toEqual({ kind: 'hiss', hz: 6500 })
    expect(phonesOf('dark').onset?.kind).toBe('click')
    expect(phonesOf('dark').coda?.kind).toBe('click')
    expect(phonesOf('moon').onset?.kind).toBe('hum')
    expect(phonesOf('moon').coda?.kind).toBe('hum')
    expect(phonesOf('love').onset).toEqual({ kind: 'glide', from: 'ou' })
    expect(phonesOf('she').onset).toEqual({ kind: 'hiss', hz: 3200 })
  })

  /* the published values, and the order every vowel chart has them in */
  it('every vowel has three rising formants inside a female voice’s range', () => {
    for (const [id, [f1, f2, f3]] of Object.entries(VOWELS)) {
      expect(f1, id).toBeLessThan(f2)
      expect(f2, id).toBeLessThan(f3)
      expect(f1, id).toBeGreaterThanOrEqual(250)
      expect(f3, id).toBeLessThanOrEqual(3500)
    }
    /* "ee" is the front vowel, "oo" the back one: F2 far apart */
    expect(VOWELS.ee[1] - VOWELS.oo[1]).toBeGreaterThan(1500)
  })
})

describe('the harmony is a third above, inside the scale', () => {
  const major = degreesOf('major')
  const minor = degreesOf('minor')

  it('in C major: C→E, D→F, E→G, B→D', () => {
    expect([60, 62, 64, 71].map((m) => harmonyAbove(m, major, 0))).toEqual([64, 65, 67, 74])
  })

  it('in C minor: C→E♭, G→B♭', () => {
    expect([60, 67].map((m) => harmonyAbove(m, minor, 0))).toEqual([63, 70])
  })

  it('a note outside the scale keeps its distance from the step below it', () => {
    /* C♯ in C major: the step below is C, whose third is E, so C♯ takes F */
    expect(harmonyAbove(61, major, 0)).toBe(65)
  })

  it('on Chromatic it is a plain major third', () => {
    expect(harmonyAbove(60, degreesOf('chromatic'), 0)).toBe(64)
  })
})
