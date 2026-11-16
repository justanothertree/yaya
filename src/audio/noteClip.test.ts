import { describe, expect, it } from 'vitest'
import { atPlayhead, clipNow, copyNotes, placeClip, sameBarShift } from './noteClip'
import type { Note } from './noteEdit'

/**
 * Notes copied in one part and pasted into another (noteClip.ts).
 *
 * At 120bpm a bar is two seconds and a sixteenth is an eighth of a second; the expectations below
 * are written in those terms — "bar 3, beat 2" is 4.5s because that is where it is in the song.
 */

const BAR = 2
const phrase: Note[] = [
  { midi: 60, t: 4.5, dur: 0.25 },
  { midi: 64, t: 5, dur: 0.5 },
  { midi: 67, t: 5.75, dur: 0.25 },
]

describe('the clipboard', () => {
  it('outlives the part it was filled in, and is a copy rather than the notes themselves', () => {
    const mine = phrase.map((n) => ({ ...n }))
    copyNotes(mine, 'part-a')
    mine[0].t = 99
    expect(clipNow().clip?.from).toBe('part-a')
    expect(clipNow().clip?.notes[0].t).toBe(4.5)
  })

  it('ignores an empty copy rather than emptying itself', () => {
    copyNotes(phrase, 'part-a')
    copyNotes([], 'part-b')
    expect(clipNow().clip?.from).toBe('part-a')
  })
})

describe('pasting into the same bar', () => {
  it('lands where it was in a part just as long — keeping the timing between the notes', () => {
    const { placed } = placeClip(phrase, [], 4 * BAR, sameBarShift(phrase, 4 * BAR))
    expect(placed.map((n) => n.t)).toEqual([4.5, 5, 5.75])
    expect(placed.map((n) => n.midi)).toEqual([60, 64, 67])
  })

  it('lands at the same beat of the bar in a one-bar part, which plays that bar every bar', () => {
    const { placed } = placeClip(phrase, [], BAR, sameBarShift(phrase, BAR))
    expect(placed.map((n) => n.t)).toEqual([0.5, 1, 1.75])
  })
})

describe('pasting at the playhead', () => {
  it('starts the phrase under the playhead, on the nearest step, keeping its rhythm', () => {
    /* the playhead a hair after beat 2 of bar 1; sixteenths are 0.125s */
    const shift = atPlayhead(phrase, 0.51, 0.125, 4 * BAR)
    const { placed } = placeClip(phrase, [], 4 * BAR, shift)
    expect(placed.map((n) => n.t)).toEqual([0.5, 1, 1.75])
  })

  it('wraps a playhead at the very end round to the top rather than off the end', () => {
    expect(atPlayhead(phrase, 7.99, 0.125, 4 * BAR)).toBe(0 - 4.5)
  })
})

describe('a paste never disturbs what is already there', () => {
  it('refuses a note whose start falls inside one of its own pitch, and counts it', () => {
    const there: Note[] = [{ midi: 64, t: 4.75, dur: 1 }]
    const { notes, placed, refused } = placeClip(phrase, there, 4 * BAR, 0)
    expect(refused).toBe(1)
    expect(placed.map((n) => n.midi)).toEqual([60, 67])
    expect(notes).toContainEqual(there[0])
  })

  it('shortens a note that would run into the next one of its pitch, rather than over it', () => {
    const there: Note[] = [{ midi: 64, t: 5.25, dur: 0.25 }]
    const { placed } = placeClip(phrase, there, 4 * BAR, 0)
    const e = placed.find((n) => n.midi === 64)!
    expect(e.t).toBe(5)
    expect(e.dur).toBeCloseTo(0.25, 9)
  })

  it('refuses what would fall off either end of the part', () => {
    const { placed, refused } = placeClip(phrase, [], BAR * 2.8, 0)
    expect(placed.map((n) => n.t)).toEqual([4.5, 5])
    expect(refused).toBe(1)
    expect(placeClip(phrase, [], 4 * BAR, -6).refused).toBe(3)
  })

  it('leaves notes of other pitches alone even where the paste lands on top of them in time', () => {
    const there: Note[] = [{ midi: 48, t: 4, dur: 4 }]
    const { notes, placed } = placeClip(phrase, there, 4 * BAR, 0)
    expect(placed).toHaveLength(3)
    expect(notes.find((n) => n.midi === 48)).toEqual(there[0])
  })
})
