import { describe, expect, it } from 'vitest'
import {
  dragTo,
  fitBar,
  heardFor,
  moveBy,
  MIN_HEARD,
  NUDGE,
  sayWhere,
  stepFor,
  tAt,
  whereIs,
  xAt,
} from './timeline'

/**
 * The expectations are written from the song's shape — a bar of so many pixels, a take whose
 * singing lands on a beat — never from the sum the functions do.
 */

/* four bars at 120 bpm: a beat is half a second, a bar two, a pass eight */
const song = { beat: 0.5, len: 8, beatsPerBar: 4 }
/* a bar drawn 98px wide with 2px before the next: a bar line every 100px */
const scale = { pitch: 100, barLen: 2 }

describe('how wide a bar is drawn', () => {
  it('as wide as lets every bar, and the gaps between them, fill the strip', () => {
    const w = fitBar(690, 4, 2, 12, 400)
    /* four bars and the three gaps between them fit … */
    expect(4 * w + 3 * 2).toBeLessThanOrEqual(690)
    /* … and a pixel more each would not */
    expect(4 * (w + 1) + 3 * 2).toBeGreaterThan(690)
  })

  it('never narrower than a bar tile, so a long song scrolls rather than vanishing', () => {
    expect(fitBar(300, 32, 2, 12, 400)).toBe(12)
  })

  it('never wider than the most a bar is drawn, and the tile size when nothing is measured', () => {
    expect(fitBar(2000, 1, 2, 12, 400)).toBe(400)
    expect(fitBar(0, 4, 2, 12, 400)).toBe(12)
    expect(fitBar(690, 0, 2, 12, 400)).toBe(12)
  })
})

describe('where a moment is drawn', () => {
  it('halfway through bar 2 is half a bar past the second bar line', () => {
    expect(xAt(3, scale)).toBe(150)
    expect(tAt(150, scale)).toBe(3)
  })
})

describe('dragging a recording', () => {
  /* punched in at 3.12s: the recorder began 0.88s before the singing, which lands on beat 9 (4.0s) */
  const take = 3.12
  const singingAt = (at: number) => at + 0.88
  const onABeat = (t: number) => Math.abs(t / song.beat - Math.round(t / song.beat)) < 1e-9

  it('moves it by whole beats, so the singing stays on the beat', () => {
    /* 75px is three-quarters of a bar: three beats */
    const at = dragTo(take, 75, { ...song, snap: true, scale })
    expect(at).toBe(4.62)
    expect(onABeat(singingAt(at))).toBe(true)
    /* 60px is 2.4 beats, and it goes the whole two */
    expect(dragTo(take, 60, { ...song, snap: true, scale })).toBe(4.12)
    expect(onABeat(singingAt(dragTo(take, -137, { ...song, snap: true, scale })))).toBe(true)
  })

  it('goes exactly where it is put with snapping off', () => {
    expect(dragTo(take, 60, { ...song, snap: false, scale })).toBe(4.32)
  })

  it('stays put for the wobble of a tap', () => {
    expect(dragTo(take, 2, { ...song, snap: false, scale })).toBe(take)
    expect(dragTo(take, -2, { ...song, snap: true, scale })).toBe(take)
  })

  it('stops at the top, on its own beat when snapping', () => {
    /* the nearest whole beats to the top leave it 0.12s in, which keeps the singing on a beat */
    expect(dragTo(take, -10000, { ...song, snap: true, scale })).toBe(0.12)
    expect(dragTo(take, -10000, { ...song, snap: false, scale })).toBe(0)
  })

  it('stops before the end of the song, where it would still be heard', () => {
    const snapped = dragTo(take, 10000, { ...song, snap: true, scale })
    expect(snapped).toBe(7.12)
    /* at least a beat of it plays before the pass ends */
    expect(heardFor(snapped, 2, song.len)).toBeGreaterThanOrEqual(song.beat)
    const free = dragTo(take, 10000, { ...song, snap: false, scale })
    expect(heardFor(free, 2, song.len)).toBeCloseTo(MIN_HEARD, 9)
  })

  it('already in the last beat, moving it on leaves it where it is rather than pulling it back', () => {
    /* put at 7.95 with Snap off, then Snap turned on: there is no whole beat left to the right */
    expect(moveBy(7.95, 0.5, { ...song, snap: true })).toBe(7.95)
    expect(dragTo(7.6, 5, { ...song, snap: true, scale })).toBe(7.6)
    /* and it still moves back a beat when asked to */
    expect(moveBy(7.6, -0.5, { ...song, snap: true })).toBe(7.1)
  })

  it('past the end of a song made shorter since, any move brings it back in, on its own beat', () => {
    /* placed at 7.12 in eight seconds, then the song cut to four: it plays nothing where it is */
    const short = { ...song, len: 4 }
    expect(moveBy(7.12, 0.5, { ...short, snap: true })).toBe(3.12)
    expect(moveBy(7.12, -0.5, { ...short, snap: true })).toBe(3.12)
    expect(heardFor(3.12, 2, short.len)).toBeGreaterThan(0)
  })

  it('a sound at the top moves onto the beats themselves', () => {
    const at = dragTo(0, 270, { ...song, snap: true, scale })
    /* 270px is 5.4s: the nearest beat */
    expect(at).toBe(5.5)
    expect(onABeat(at)).toBe(true)
  })

  it('never anywhere that is not a number', () => {
    expect(moveBy(Number.NaN, 1, { ...song, snap: true })).toBe(0)
    expect(moveBy(2, Number.POSITIVE_INFINITY, { ...song, snap: false })).toBe(2)
  })
})

describe('the arrow keys', () => {
  it('a beat when snapping, a nudge when not, a bar with Shift', () => {
    expect(stepFor({ ...song, snap: true }, false)).toBe(0.5)
    expect(stepFor({ ...song, snap: false }, false)).toBe(NUDGE)
    expect(stepFor({ ...song, snap: false }, true)).toBe(2)
    /* a nudge is small enough to fix a take that is a little late by ear */
    expect(NUDGE).toBeLessThanOrEqual(0.01)
  })
})

describe('what a place is called', () => {
  it('bar and beat counted from 1, and how far past the beat', () => {
    expect(whereIs(3.12, song)).toEqual({ bar: 2, beat: 3, past: 120 })
    expect(whereIs(0, song)).toEqual({ bar: 1, beat: 1, past: 0 })
    expect(whereIs(7.5, song)).toEqual({ bar: 4, beat: 4, past: 0 })
    expect(sayWhere(3.12, song)).toBe('bar 2, beat 3 + 120 ms')
    expect(sayWhere(4, song)).toBe('bar 3, beat 1')
  })
})

describe('how much of a recording is heard', () => {
  it('all of it, unless the pass ends first', () => {
    expect(heardFor(1, 3, 8)).toBe(3)
    expect(heardFor(7, 3, 8)).toBe(1)
    expect(heardFor(8, 3, 8)).toBe(0)
  })
})
