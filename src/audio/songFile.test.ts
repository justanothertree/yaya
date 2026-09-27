import { describe, expect, it } from 'vitest'
import { packSong, readSong, songNotes, type Song } from './songFile'

/**
 * The song format, and the one path a stranger's file takes into the instrument.
 *
 * ⚠️ readSong IS A SECURITY BOUNDARY AND SAID SO WITHOUT A TEST. library/cloud.ts names it
 * outright — "a row off the network is exactly as trustworthy as a file off a disk: readSong and
 * readDrawing are the security boundary and this does not go around them". readDrawing has had
 * tests since the suite existed. This had none, which meant one half of a sentence about
 * trusting nothing was checked and the other half was a claim.
 *
 * ⚠️ AND THE FAILURE MODE IS NOT A CRASH. Everything here returns null or a default rather than
 * throwing, by design, so a bad file does not take the room down with it. What a bad file CAN do
 * is become a loop bound in the scheduler, a note that never stops, or a bar index a take does
 * not have — none of which looks like bad input when it happens. It looks like the instrument
 * is broken.
 */

/** A song built the way a file arrives: through the reader, so the fixture is not a fiction. */
const songFrom = (over: Record<string, unknown> = {}): Song =>
  readSong({
    v: 1,
    name: 'Tune',
    bpm: 120,
    bars: 2,
    layers: [
      {
        instrument: 'keys',
        len: 2,
        muted: false,
        fx: { echo: 0.5, echoTime: 0.3, space: 0.2, vibrato: 0.1, glide: 0.4 },
        events: [
          { t: 0, midi: 60, on: true },
          { t: 0.5, midi: 60, on: false },
          { t: 1, midi: 64, on: true },
          { t: 1.5, midi: 64, on: false },
        ],
      },
    ],
    ...over,
  })!

const layerOf = (events: unknown, over: Record<string, unknown> = {}) => ({
  instrument: 'keys',
  len: 2,
  muted: false,
  fx: {},
  events,
  ...over,
})

describe('a song survives being written down', () => {
  it('and comes back as itself', () => {
    const before = songFrom()
    const after = readSong(packSong(before))!
    expect(after.name).toBe(before.name)
    expect(after.bpm).toBe(before.bpm)
    expect(after.bars).toBe(before.bars)
    expect(after.layers).toHaveLength(before.layers.length)
    expect(songNotes(after)).toBe(songNotes(before))
  })

  it('and keeps what each layer is and how it sounds', () => {
    const before = songFrom()
    const after = readSong(packSong(before))!
    const [a, b] = [before.layers[0], after.layers[0]]
    expect(b.instrument).toBe(a.instrument)
    expect(b.len).toBeCloseTo(a.len, 3)
    expect(b.muted).toBe(a.muted)
    for (const key of ['echo', 'echoTime', 'space', 'vibrato', 'glide'] as const) {
      expect(b.fx[key], `fx.${key} did not survive`).toBeCloseTo(a.fx[key], 2)
    }
  })

  it('and the notes land where they were', () => {
    const before = songFrom()
    const after = readSong(packSong(before))!
    const ons = (s: Song) =>
      s.layers[0].events.filter((e) => e.on).map((e) => [Math.round(e.t * 1000), e.midi])
    expect(ons(after)).toEqual(ons(before))
  })

  /**
   * ⚠️ THE EFFECTS ARE A POSITIONAL ARRAY, WHICH IS WHY THE ORDER IS LOAD-BEARING. packSong's
   * own note: "glide is APPENDED, never inserted. This array is positional, so a fifth entry is
   * invisible to an older reader and a missing one simply defaults — where putting it in the
   * middle would silently turn every saved song's reverb into its vibrato."
   *
   * So this is a file written before glide existed: four entries, not five. Every one of them
   * has to land on the effect it was written for, and the missing one has to default rather
   * than shift the rest along.
   */
  it('and a file written before glide existed still sounds like itself', () => {
    const old = readSong({
      v: 2,
      name: 'Older',
      bpm: 100,
      bars: 2,
      l: [
        {
          i: 'keys',
          d: 2000,
          m: 0,
          p: -1,
          f: [0.7, 0.4, 0.3, 0.2],
          n: [0, 60, 500],
        },
      ],
    })!
    const fx = old.layers[0].fx
    expect(fx.echo, 'echo took the first slot').toBeCloseTo(0.7, 2)
    expect(fx.echoTime, 'echoTime took the second').toBeCloseTo(0.4, 2)
    expect(fx.space, 'space took the third').toBeCloseTo(0.3, 2)
    expect(fx.vibrato, 'vibrato took the fourth').toBeCloseTo(0.2, 2)
    expect(fx.glide, 'and the one that was not there defaults').toBe(0)
  })

  /**
   * ⚠️ AND IT SURVIVES AT ITS OWN LENGTH, which is the whole of it. A trailing `false` and an
   * absent entry are the same bit but not the same thing: the scheduler checks
   * `bar < play.length` before consulting the mask, so a bar past the end PLAYS — and setBars
   * depends on that, "going 2 -> 4 fill the new bars".
   *
   * Every saved mask used to come back 32 long, so every bar past its real end came back
   * silent. A two-bar arrangement grown to four sounded right until you saved it and lost bars
   * three and four on the way back in. Found by this round trip, not by listening.
   */
  it('and an arrangement mask survives the round trip', () => {
    const before = songFrom({
      layers: [
        layerOf(
          [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
          ],
          { play: [true, false, true, true] },
        ),
      ],
    })
    const after = readSong(packSong(before))!
    expect(after.layers[0].play).toEqual(before.layers[0].play)
  })
})

describe('a song file from somebody else', () => {
  it('is refused outright when it is not a song', () => {
    for (const junk of [null, undefined, 42, 'song', [], {}, { layers: 'nope' }, { l: 7 }]) {
      expect(readSong(junk), `${JSON.stringify(junk)} got through`).toBeNull()
    }
  })

  it('and refused when nothing in it actually sounds', () => {
    /* every event a note-OFF: individually valid, collectively silence */
    expect(
      readSong({
        layers: [layerOf([{ t: 0, midi: 60, on: false }])],
      }),
    ).toBeNull()
    expect(readSong({ layers: [layerOf([])] }), 'no events at all').toBeNull()
  })

  /**
   * ⚠️ A NOTE NUMBER IS A PITCH, AND MIDI HAS 128 OF THEM. Anything else is either silence or a
   * frequency nobody asked for, so it is dropped rather than clamped — clamping would put a note
   * somebody never wrote into a song they are listening to.
   */
  it('and every note that gets through is a pitch that exists', () => {
    const s = readSong({
      layers: [
        layerOf([
          { t: 0, midi: 60, on: true },
          { t: 0.1, midi: 60, on: false },
          { t: 0.2, midi: 999, on: true },
          { t: 0.3, midi: -5, on: true },
          { t: 0.4, midi: 60.5, on: true },
          { t: 0.5, midi: Number.NaN, on: true },
          { t: 0.6, midi: '64', on: true },
        ]),
      ],
    })!
    for (const e of s.layers[0].events) {
      expect(Number.isInteger(e.midi), `midi ${e.midi}`).toBe(true)
      expect(e.midi).toBeGreaterThanOrEqual(0)
      expect(e.midi).toBeLessThanOrEqual(127)
    }
    expect(s.layers[0].events.some((e) => e.midi === 60)).toBe(true)
  })

  it('and no note is scheduled outside the take it belongs to', () => {
    const s = readSong({
      layers: [
        layerOf(
          [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
            { t: 99, midi: 62, on: true },
            { t: -4, midi: 63, on: true },
            { t: Number.POSITIVE_INFINITY, midi: 64, on: true },
          ],
          { len: 2 },
        ),
      ],
    })!
    const layer = s.layers[0]
    for (const e of layer.events) {
      expect(Number.isFinite(e.t)).toBe(true)
      expect(e.t).toBeGreaterThanOrEqual(0)
      expect(e.t).toBeLessThanOrEqual(layer.len)
    }
  })

  /**
   * ⚠️ EVERY NOTE-ON GETS A NOTE-OFF, which is what the normaliser buys over mere validation.
   * readLayer's own note: passing the events through the converter "is what guarantees the
   * result is playable... Checking the numbers alone would let a file through that is
   * individually valid and collectively a stuck note." A stuck note does not look like a bad
   * file — it looks like the instrument is broken, and it keeps sounding after you leave.
   */
  it('and nothing it plays can be left sounding', () => {
    const s = readSong({
      layers: [
        layerOf([
          { t: 0, midi: 60, on: true },
          { t: 0.2, midi: 62, on: true },
          { t: 0.4, midi: 64, on: true },
          /* not one note-off anywhere */
        ]),
      ],
    })!
    const held = new Map<number, number>()
    for (const e of s.layers[0].events) {
      held.set(e.midi, (held.get(e.midi) ?? 0) + (e.on ? 1 : -1))
    }
    for (const [midi, open] of held) {
      expect(open, `midi ${midi} is still held down at the end`).toBe(0)
    }
  })

  it('and one pitch cannot be held twice at once', () => {
    const s = readSong({
      layers: [
        layerOf([
          { t: 0, midi: 60, on: true },
          { t: 0.1, midi: 60, on: true },
          { t: 0.2, midi: 60, on: true },
          { t: 1.5, midi: 60, on: false },
        ]),
      ],
    })!
    let open = 0
    for (const e of s.layers[0].events) {
      open += e.on ? 1 : -1
      expect(open, 'the same pitch was on twice over').toBeLessThanOrEqual(1)
    }
  })

  /**
   * ⚠️ EVERY ARRAY OFF A FILE IS A LOOP BOUND SOMEWHERE. readPlay's own note: a mask "becomes a
   * loop bound in the scheduler, so a million-entry mask is a million comparisons per
   * repetition". The same is true of layers and of events, and none of it is a crash — it is a
   * room that stops responding, which reads as the site being broken.
   */
  it('and no array it hands on is unbounded', () => {
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i))
    /* ⚠️ REAL PAIRS, ASCENDING, or the normaliser folds them away and the layer is dropped —
       which made the first version of this test measure nothing at all. A hostile file is big
       AND valid; one that is merely big never reaches the bound being tested. */
    const s = readSong({
      layers: many(80, () =>
        layerOf(
          many(20000, (i) => ({
            t: +((i * 0.0005) % 1.9).toFixed(4),
            midi: 21 + (i % 100),
            on: i % 2 === 0,
          })),
          { len: 2, play: many(5000, () => true), plan: many(5000, (i) => i) },
        ),
      ),
    })!
    const events = s.layers.reduce((n, l) => n + l.events.length, 0)
    expect(s.layers.length, 'layers').toBeLessThanOrEqual(12)
    expect(events, 'events in total').toBeLessThanOrEqual(6000)
    for (const l of s.layers) {
      expect(l.play?.length ?? 0, 'the arrangement mask').toBeLessThanOrEqual(32)
      expect(l.plan?.length ?? 0, 'the arrangement plan').toBeLessThanOrEqual(32)
    }
    /**
     * ⚠️ AND THE BUDGET IS WHAT ACTUALLY BINDS, not the layer cap. 80 fat layers come back as
     * three, because the 6000 EVENTS are spent before the twelfth layer is reached — so
     * MAX_LAYERS only ever bites on a file that is wide and thin. Asserting the caps without
     * this said nothing: `layers <= 12` passes at three the same as it would at zero, and
     * counting NOTES rather than events halves the figure and clears the bound by accident.
     */
    expect(events, 'the event budget is what ran out').toBeGreaterThan(2000)
    expect(s.layers.length, 'so the layer cap was never the thing being tested').toBeLessThan(12)
  })

  it('and an unknown instrument becomes one the room has', () => {
    const s = readSong({
      layers: [
        layerOf(
          [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
          ],
          { instrument: '../../etc/passwd' },
        ),
      ],
    })!
    expect(s.layers[0].instrument).toBe('keys')
  })

  it('and the numbers that drive the room are pulled into a range that plays', () => {
    const s = readSong({
      name: 'x'.repeat(500),
      bpm: 1e9,
      bars: -40,
      layers: [
        layerOf(
          [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
          ],
          { len: 1e9, gain: 99, fx: { echo: 50, space: -20, vibrato: Number.NaN } },
        ),
      ],
    })!
    expect(s.name.length).toBeLessThanOrEqual(60)
    expect(s.bpm).toBeGreaterThanOrEqual(40)
    expect(s.bpm).toBeLessThanOrEqual(200)
    expect(s.bars).toBeGreaterThanOrEqual(1)
    expect(s.bars).toBeLessThanOrEqual(8)
    const l = s.layers[0]
    expect(l.len).toBeGreaterThan(0)
    expect(l.len).toBeLessThanOrEqual(60)
    expect(l.gain!).toBeGreaterThanOrEqual(0)
    expect(l.gain!).toBeLessThanOrEqual(1.5)
    for (const v of Object.values(l.fx)) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  /** ⚠️ a bar index the take does not have schedules nothing and reads as a broken sequencer */
  it('and an arrangement never points at a bar that is not there', () => {
    const s = readSong({
      layers: [
        layerOf(
          [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
          ],
          { plan: [0, 1, -3, 'two', null, Number.NaN, 2.7] },
        ),
      ],
    })!
    for (const x of s.layers[0].plan ?? []) {
      if (x === null) continue
      expect(Number.isInteger(x), `${x} is not a bar`).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('counting what is in a song', () => {
  it('counts the notes that sound, not the events', () => {
    const s = songFrom()
    const ons = s.layers.reduce((n, l) => n + l.events.filter((e) => e.on).length, 0)
    expect(songNotes(s)).toBe(ons)
    expect(songNotes(s), 'every note-off was counted as a note').toBeLessThan(
      s.layers.reduce((n, l) => n + l.events.length, 0),
    )
  })
})
