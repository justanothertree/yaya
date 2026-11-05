import { describe, expect, it } from 'vitest'
import { STRUMS, strumDelays, strumSpread, type StrumId } from './strum'

/**
 * What a rolled chord owes the person pressing the key.
 *
 * ⚠️ THE LOAD-BEARING ONE IS "THE CHORD STARTS NOW". Everything else here is about taste, and
 * taste can be argued with; latency cannot. A spread that pushed every note back — even the 22ms
 * that makes the roll audible — would read as the keyboard being slow rather than as a chord
 * being rolled, and nobody would file it as "the strum setting feels wrong", they would file it
 * as "the instrument lags". So one note always has a delay of zero, in every shape, at every
 * size, and that is asserted as a sweep rather than as four examples.
 */

const ids = STRUMS.map(([id]) => id)

describe('the chord always starts now', () => {
  it('leaves one note undelayed, whatever the shape and however many notes', () => {
    for (const id of ids)
      for (let n = 1; n <= 8; n++) expect(Math.min(...strumDelays(id, n)), `${id} × ${n}`).toBe(0)
  })

  it('never asks for a note before the press', () => {
    for (const id of ids)
      for (let n = 1; n <= 8; n++)
        for (const d of strumDelays(id, n)) expect(d, `${id} × ${n}`).toBeGreaterThanOrEqual(0)
  })
})

describe('one delay per note', () => {
  it('answers the same number of delays as there are notes', () => {
    /* the room zips these against the chord, so a short list would silently drop a note and a
       long one would ask the synth for a voice that does not exist */
    for (const id of ids) for (let n = 0; n <= 8; n++) expect(strumDelays(id, n)).toHaveLength(n)
  })

  it('has nothing to say about an empty chord', () => {
    for (const id of ids) expect(strumDelays(id, 0)).toEqual([])
  })
})

describe('a single note is never rolled', () => {
  it('is immediate in every shape, because one note is not a chord', () => {
    /**
     * ⚠️ NOT A CURIOSITY — IT IS THE COMMON CASE. The picker only appears once a chord is
     * chosen, but a chord can still come back as one note: the drum kit ignores chords, and at
     * the top of the keyboard `chordNotes` clips everything above MIDI 127. If those went
     * through a roll, the single note left would be the LAST one in `down` — a key that plays
     * 66ms after you press it, on exactly the keys where nothing looks wrong.
     */
    for (const id of ids) expect(strumDelays(id, 1), id).toEqual([0])
  })
})

describe('off', () => {
  it('fires everything on the same instant, which is what it did before this existed', () => {
    expect(strumDelays('off', 4)).toEqual([0, 0, 0, 0])
    expect(strumSpread('off', 4)).toBe(0)
  })
})

describe('direction', () => {
  it('rolls up from the pressed note', () => {
    /* `chordNotes` gives notes ascending with the pressed one first, so rising delays are a
       rising chord */
    const d = strumDelays('up', 4)
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1])
    expect(d[0]).toBe(0)
  })

  it('rolls down from the top note', () => {
    const d = strumDelays('down', 4)
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1])
    /* the pressed note is last here — the chord still starts on time, led by its top note */
    expect(d[d.length - 1]).toBe(0)
    expect(d[0]).toBeGreaterThan(0)
  })

  it('is the same gesture either way round, only reversed', () => {
    /* up and down must differ in order and not in speed, or one of them is a different feature
       wearing the other's name */
    expect(strumDelays('down', 5)).toEqual([...strumDelays('up', 5)].reverse())
  })
})

describe('how fast', () => {
  it('spreads a chord audibly without smearing it', () => {
    /**
     * Under about 15ms a note the ear fuses the chord back into one event and the setting
     * appears to do nothing; past about 35ms a four-note chord stops being one gesture. Stated
     * as the bracket rather than as the constant, so a tweak inside the bracket is free and a
     * tweak outside it has to be argued for.
     */
    for (const id of ['up', 'down'] as StrumId[]) {
      const gap = strumSpread(id, 2)
      expect(gap, id).toBeGreaterThanOrEqual(0.015)
      expect(gap, id).toBeLessThanOrEqual(0.035)
    }
  })

  it('makes Spread clearly slower, or it is the same setting twice', () => {
    expect(strumSpread('slow', 4)).toBeGreaterThan(2 * strumSpread('up', 4))
  })

  it('keeps even the slowest roll inside a quarter of a second', () => {
    /* a four-note harp roll is the longest the room can ask for; beyond this it stops reading
       as one chord and starts reading as an arpeggio nobody asked for */
    expect(strumSpread('slow', 4)).toBeLessThanOrEqual(0.25)
  })

  it('grows with the chord rather than squeezing into a fixed window', () => {
    /* a constant total would make a seventh chord tighter than a triad, which is backwards:
       more strings means a longer stroke */
    for (const id of ['up', 'down', 'slow'] as StrumId[])
      expect(strumSpread(id, 4), id).toBeGreaterThan(strumSpread(id, 3))
  })
})

describe('the picker', () => {
  it('offers Together first, because that is what the room did before', () => {
    expect(STRUMS[0][0]).toBe('off')
  })

  it('gives every shape a distinct id, a label and a sentence', () => {
    for (const [id, label, hint] of STRUMS) {
      expect(label.length, id).toBeGreaterThan(0)
      expect(hint.length, id).toBeGreaterThan(0)
      expect(hint.endsWith('.'), id).toBe(false)
    }
    expect(new Set(ids).size).toBe(STRUMS.length)
  })

  it('does not name a direction a guitarist and everybody else would read differently', () => {
    /* "down-strum" is the low string first to one of them and the top note first to the other,
       so the labels talk about pitch instead */
    for (const [, label, hint] of STRUMS)
      expect(`${label} ${hint}`.toLowerCase()).not.toMatch(/strum (up|down)|up-?strum|down-?strum/)
  })

  it('offers nothing that does the same thing as something else', () => {
    const seen = new Map<string, StrumId>()
    for (const id of ids) {
      const sig = strumDelays(id, 4).join(',')
      expect(seen.has(sig), `${id} is the same as ${seen.get(sig)}`).toBe(false)
      seen.set(sig, id)
    }
  })

  it('plays one note immediately for a shape it has never heard of', () => {
    expect(strumDelays('nonsense' as StrumId, 3)).toEqual([0, 0, 0])
  })
})
