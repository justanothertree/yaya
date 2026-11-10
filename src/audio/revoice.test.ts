import { describe, expect, it } from 'vitest'
import {
  BASS_STYLES,
  CHORD_PATTERNS,
  CHORD_STYLES,
  basslineEvents,
  outsideScale,
  leadsBack,
  progressionEvents,
  revoice,
  type ChordStyle,
  type Voicing,
} from './chordPatterns'
import type { LoopEvent } from './looper'
import { nameChord } from './chordName'
import { SCALES, degreesOf } from './scales'

/**
 * Evan's call, 9 Nov 2026: changing key re-voices chords already laid.
 *
 * ⚠️ THE EXPECTATIONS ARE CHORD NAMES, as in chordPatterns.test.ts — "Four chords in D is D, A,
 * B minor, G" is what any songbook says, and asking `nameChord` keeps the test from agreeing with
 * the arithmetic it is checking. The `lay` passed in is the room's own call, because that is the
 * thing under test's input, not its expectation.
 */

const major = degreesOf('major')
const minor = degreesOf('minor')
const SCALE_DEGREES = SCALES.filter(([id]) => id !== 'chromatic').map(([, , d]) => d)
const four = CHORD_PATTERNS.find((p) => p.id === 'four')!
const inKey = (degrees: readonly number[], root: number): Voicing => ({ degrees, root })
const C = inKey(major, 0)
const D = inKey(major, 2)

/** the room's own call, for a progression of `len` seconds in a style, at 120bpm */
const chordsLay =
  (len = 8, style: ChordStyle = 'pad', p = four) =>
  (d: readonly number[], r: number, lead: boolean) =>
    progressionEvents(p, len, d, r, lead, style, 0.5).events
const lay = (v: Voicing, lead = false, style: ChordStyle = 'pad') =>
  chordsLay(8, style)(v.degrees, v.root, lead)

/** the chords a take strikes, by name, in order — one name per chord change */
const chords = (events: readonly LoopEvent[]) => {
  const byTime = new Map<number, number[]>()
  for (const e of events) if (e.on) byTime.set(e.t, [...(byTime.get(e.t) ?? []), e.midi])
  const names = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => nameChord(n))
  return names.filter((n, i) => n !== names[i - 1])
}

describe('changing key re-voices the chords', () => {
  it('Four chords laid in C, moved to D, is D, A, B minor, G', () => {
    const next = revoice(lay(C), chordsLay(), C, D, SCALE_DEGREES)
    expect(chords(next)).toEqual(['D major', 'A major', 'B minor', 'G major'])
  })

  it('and a change of scale re-colours it: C major to A minor is A minor, E minor, F, D minor', () => {
    const next = revoice(lay(C), chordsLay(), C, inKey(minor, 9), SCALE_DEGREES)
    expect(chords(next)).toEqual(['A minor', 'E minor', 'F major', 'D minor'])
  })

  it('keeps its lead-back: IV then V in C becomes IV then V in D', () => {
    const next = revoice(lay(C, true), chordsLay(), C, D, SCALE_DEGREES)
    expect(leadsBack(next, four, 8)).toBe(true)
    expect(chords(next)).toEqual(['D major', 'A major', 'B minor', 'G major', 'A major'])
  })

  it('keeps its rhythm: stabs land on the same beats, only the notes move', () => {
    const before = lay(C, false, 'stabs')
    const next = revoice(before, chordsLay(8, 'stabs'), C, D, SCALE_DEGREES)
    const onsets = (es: readonly LoopEvent[]) => [
      ...new Set(es.filter((e) => e.on).map((e) => e.t)),
    ]
    expect(onsets(next)).toEqual(onsets(before))
    expect(chords(next)).toEqual(['D major', 'A major', 'B minor', 'G major'])
  })

  it('keeps its own length, whatever the loop is now', () => {
    /* laid for a 16-second loop; the room's loop has nothing to do with it */
    const long = chordsLay(16)
    const next = revoice(long(major, 0, false), long, C, D, SCALE_DEGREES)
    expect(Math.max(...next.map((e) => e.t))).toBeCloseTo(
      Math.max(...long(major, 0, false).map((e) => e.t)),
    )
  })

  it('goes there and back to the very same notes', () => {
    const there = revoice(lay(C, true, 'pulse'), chordsLay(8, 'pulse'), C, D, SCALE_DEGREES)
    const back = revoice(there, chordsLay(8, 'pulse'), D, C, SCALE_DEGREES)
    expect(back).toEqual(lay(C, true, 'pulse'))
  })

  /**
   * ⚠️ A SONG DOES NOT STORE ITS KEY, so a progression laid in D can be opened in a room set to C.
   * It still lands in the key the picker now names — not two semitones past it.
   */
  it('a progression laid in another key still lands in the one the picker now names', () => {
    const next = revoice(lay(D), chordsLay(), C, inKey(major, 4), SCALE_DEGREES)
    expect(chords(next)).toEqual(['E major', 'B major', 'C♯ minor', 'A major'])
  })

  /* setBpm rescales every time by a ratio: the same progression by a different route */
  it('a tempo change since it was laid is not an edit', () => {
    const ratio = 96 / 120
    const scaled = lay(C).map((e) => ({ ...e, t: e.t * ratio }))
    const atNewTempo = (d: readonly number[], r: number, lead: boolean) =>
      progressionEvents(four, 8 * ratio, d, r, lead, 'pad', 0.5 * ratio).events
    /* recognised, it is re-laid in A minor; taken for an edit, it would stay C–G–Am–F */
    const next = revoice(scaled, atNewTempo, C, inKey(minor, 9), SCALE_DEGREES)
    expect(chords(next)).toEqual(['A minor', 'E minor', 'F major', 'D minor'])
  })
})

describe('an edited backing', () => {
  /* a seventh added by hand on top of the first chord */
  const edited = () => [...lay(C), { t: 0, midi: 59, on: true }, { t: 1.9, midi: 59, on: false }]

  it('moves with a change of key, the edit included', () => {
    const next = revoice(edited(), chordsLay(), C, D, SCALE_DEGREES)
    expect(next).toHaveLength(edited().length)
    expect(next.map((e) => e.midi)).toEqual(edited().map((e) => e.midi + 2))
    expect(next.map((e) => e.t)).toEqual(edited().map((e) => e.t))
  })

  /**
   * ⚠️ A CHANGE OF SCALE CANNOT BE DONE TO NOTES MOVED BY HAND, so they keep their scale — and the
   * row says so, read off the notes. The first version kept a record of skipped layers instead, and
   * the next change of key moved the same notes along and wiped the record with them.
   */
  it('keeps its notes through a change of scale alone, and its notes say so', () => {
    const minorC = inKey(minor, 0)
    const next = revoice(edited(), chordsLay(), C, minorC, SCALE_DEGREES)
    expect(next).toEqual(edited())
    expect(outsideScale(next, minorC)).toBe(true)
  })

  it('and still says so after the key moves it along', () => {
    const minorC = inKey(minor, 0)
    const left = revoice(edited(), chordsLay(), C, minorC, SCALE_DEGREES)
    const moved = revoice(left, chordsLay(), minorC, inKey(minor, 2), SCALE_DEGREES)
    expect(moved.map((e) => e.midi)).toEqual(edited().map((e) => e.midi + 2))
    expect(outsideScale(moved, inKey(minor, 2))).toBe(true)
    /* and goes quiet once the room is back in the scale its notes are in */
    expect(outsideScale(moved, inKey(major, 2))).toBe(false)
  })

  it('a change of key and scale at once still moves it by the key', () => {
    const next = revoice(edited(), chordsLay(), C, inKey(minor, 2), SCALE_DEGREES)
    expect(next.map((e) => e.midi)).toEqual(edited().map((e) => e.midi + 2))
  })
})

/**
 * ⚠️ THE CAPTION MUST NEVER SPEAK ABOUT A BACKING NOBODY TOUCHED — "outside this scale" under a
 * progression the room laid itself would be the room accusing its own work. So every pattern, in
 * every style, in every key of every scale, with and without the lead-back, is asked.
 */
describe('anything this module lays is inside its own scale', () => {
  it('every progression and bassline, every style, every key', () => {
    const misses: string[] = []
    for (const p of CHORD_PATTERNS)
      for (const degrees of SCALE_DEGREES)
        for (let root = 0; root < 12; root++)
          for (const lead of [false, true]) {
            const v = inKey(degrees, root)
            for (const st of CHORD_STYLES)
              if (outsideScale(progressionEvents(p, 8, degrees, root, lead, st.id, 0.5).events, v))
                misses.push(`${p.id} ${st.id} ${degrees.join()} ${root}`)
            for (const st of BASS_STYLES)
              if (outsideScale(basslineEvents(p, 8, degrees, root, lead, st.id, 0.5).events, v))
                misses.push(`${p.id} bass ${st.id} ${degrees.join()} ${root}`)
          }
    expect(misses).toEqual([])
  })

  it('and a progression laid in another key is not', () => {
    expect(outsideScale(lay(D), C)).toBe(true)
    expect(outsideScale(lay(C), C)).toBe(false)
  })
})

describe('the bass follows the chords', () => {
  const bassLay = (d: readonly number[], r: number, lead: boolean) =>
    basslineEvents(four, 8, d, r, lead, 'walk', 0.5).events
  /** the note each chord's bar starts on, as a pitch class name */
  const roots = (events: readonly LoopEvent[]) =>
    [0, 2, 4, 6].map((t) => {
      const e = events.find((x) => x.on && Math.abs(x.t - t) < 1e-9)!
      return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][e.midi % 12]
    })

  it('a walking bass in C, moved to D, walks under D, A, B minor, G', () => {
    expect(roots(bassLay(major, 0, false))).toEqual(['C', 'G', 'A', 'F'])
    const next = revoice(bassLay(major, 0, false), bassLay, C, D, SCALE_DEGREES)
    expect(roots(next)).toEqual(['D', 'A', 'B', 'G'])
  })
})
