import { describe, expect, it } from 'vitest'
import { BASS_STYLES, CHORD_PATTERNS, CHORD_STYLES } from './chordPatterns'
import { DRUM_PATTERNS } from './drumPatterns'
import { STARTERS, starterNow } from './starters'

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
