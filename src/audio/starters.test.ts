import { describe, expect, it } from 'vitest'
import { BASS_STYLES, CHORD_PATTERNS, CHORD_STYLES } from './chordPatterns'
import { DRUM_PATTERNS } from './drumPatterns'
import { STARTERS, starterNow, styleBassVoice } from './starters'
import { BASS_VOICES } from './synth'

/**
 * A starter is a set of names for parts the backing panel already has. A name that points at
 * nothing is a button that lays half a backing, silently — so every one is asked of the table it
 * names.
 */
describe('every starter is made of parts that exist', () => {
  it.each(STARTERS.map((s) => [s.name, s] as const))('%s', (_n, s) => {
    expect(
      DRUM_PATTERNS.map((p) => p.id),
      `${s.name} beat`,
    ).toContain(s.beat)
    expect(
      CHORD_PATTERNS.map((p) => p.id),
      `${s.name} chords`,
    ).toContain(s.chords)
    expect(
      CHORD_STYLES.map((x) => x.id),
      `${s.name} chord style`,
    ).toContain(s.chordStyle)
    expect(
      BASS_STYLES.map((x) => x.id),
      `${s.name} bass`,
    ).toContain(s.bass)
    /* the room's own tempo range — see setBpm */
    expect(s.bpm).toBeGreaterThanOrEqual(40)
    expect(s.bpm).toBeLessThanOrEqual(200)
    expect(s.id).toMatch(/^[a-z]+$/)
  })
})

describe('the starters', () => {
  it('are around ten, each with its own name', () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(STARTERS.map((s) => s.name)).size).toBe(STARTERS.length)
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length)
  })

  /* two starters with the same parts are one starter with two buttons — and the pressed state,
     which is read back from the parts, could not tell which one you pressed */
  it('no two lay the same backing', () => {
    const recipes = STARTERS.map((s) => [s.beat, s.chords, s.chordStyle, s.bass].join('|'))
    expect(new Set(recipes).size).toBe(STARTERS.length)
  })

  it('reads back as pressed only when every part matches', () => {
    const reggae = STARTERS.find((s) => s.id === 'reggae')!
    const parts = {
      beat: reggae.beat,
      chords: reggae.chords,
      chordStyle: reggae.chordStyle,
      bass: reggae.bass,
    }
    expect(starterNow(parts)?.id).toBe('reggae')
    /* change one thing in the panel and it is no longer the starter, it is yours */
    expect(starterNow({ ...parts, bass: 'walk' })).toBe(null)
    expect(starterNow({ ...parts, beat: null })).toBe(null)
  })
})

/** Evan, 10 Nov 2026: "an 808 for Hip hop makes sense, so let styles pick a bass voice where it clearly fits". */
describe('a style can pick its bass voice', () => {
  const by = (id: string) => STARTERS.find((s) => s.id === id)!

  it('Hip hop is an 808, Funk slap, Jazz upright, House synth bass, Rock a pick — the rest plain Bass', () => {
    expect(by('hiphop').bassVoice).toBe('808')
    expect(by('funk').bassVoice).toBe('slap')
    expect(by('jazz').bassVoice).toBe('upright')
    expect(by('house').bassVoice).toBe('synthbass')
    expect(by('rock').bassVoice).toBe('pick')
    expect(
      STARTERS.filter((s) => s.bassVoice)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['funk', 'hiphop', 'house', 'jazz', 'rock'])
    for (const s of STARTERS) if (s.bassVoice) expect(BASS_VOICES, s.name).toContain(s.bassVoice)
  })

  it('a fresh bass, or one still on the plain Bass, takes the style’s voice', () => {
    expect(styleBassVoice(null, null, by('hiphop'))).toBe('808')
    expect(styleBassVoice('bass', null, by('hiphop'))).toBe('808')
  })

  it('moving from Hip hop to Pop takes the 808 back to plain Bass', () => {
    expect(styleBassVoice('808', by('hiphop'), by('pop'))).toBe('bass')
    expect(styleBassVoice('808', by('hiphop'), by('funk'))).toBe('slap')
  })

  /* the rule layChords keeps for the chords' sound: a style button is not yours to overrule */
  it('but a voice you picked yourself is kept', () => {
    expect(styleBassVoice('finger', null, by('hiphop'))).toBe(null)
    expect(styleBassVoice('finger', by('pop'), by('hiphop'))).toBe(null)
    /* an 808 you picked under Pop is yours too, not Hip hop's */
    expect(styleBassVoice('808', by('pop'), by('funk'))).toBe(null)
  })
})

/* Evan, 10 Nov 2026: bass lines that fit each style */
describe('three styles play their own bass line', () => {
  const by = (id: string) => STARTERS.find((s) => s.id === id)!
  it('Funk plays Funk, Reggae plays Dub, Bossa plays Bossa', () => {
    expect(by('funk').bass).toBe('funk')
    expect(by('reggae').bass).toBe('dub')
    expect(by('bossa').bass).toBe('bossa')
  })
})
