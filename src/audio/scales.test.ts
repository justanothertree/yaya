import { describe, expect, it } from 'vitest'
import { MAJOR_DEGREES, SCALES, degreesOf, type Scale } from './scales'
import { CHORDS, chordNotes, type ChordId } from './chords'

/**
 * The room's actual menu, asked rather than written down.
 *
 * `chords.test.ts` proves `chordNotes` is right for the degree lists it hands it. This proves the
 * lists the room really offers are ones it can be right about — which is a different question,
 * and the one that goes stale. A scale added in a year gets every check in this file for free;
 * that is the whole reason the list left the component.
 *
 * ⚠️ THESE ARE PROPERTIES, NOT A SECOND COPY OF THE TABLE. Asserting that Lydian is
 * `[0,2,4,6,7,9,11]` would be the same numbers twice and would catch nothing but a typo I had
 * already made. Asserting that every scale ascends inside one octave from its root, and that
 * every chord built on every degree of it lands back inside it, catches the typo AND everything
 * else.
 */

const label = (s: Scale) => s[1]

describe('every scale', () => {
  it.each(SCALES.map((s) => [s[1], s] as const))('%s is a well-formed scale', (_name, s) => {
    const [id, lab, degrees, hint] = s
    expect(id, 'id').toMatch(/^[a-zA-Z]+$/)
    expect(lab.length, 'label').toBeGreaterThan(0)
    expect(hint.length, 'hint').toBeGreaterThan(0)
    /* starts on the root — `chordNotes` subtracts `degrees[from]`, and the room's `noteAt` adds
       the root separately, so a list that did not start at 0 would be transposed twice */
    expect(degrees[0], 'starts on the root').toBe(0)
    /* ascending, inside one octave: the octave rollover is `Math.floor(n / length)`, which is
       only the right carry if the pattern spans exactly one octave */
    for (let i = 1; i < degrees.length; i++)
      expect(degrees[i], `${lab} degree ${i}`).toBeGreaterThan(degrees[i - 1])
    expect(Math.max(...degrees), 'inside one octave').toBeLessThan(12)
    expect(new Set(degrees).size, 'no repeats').toBe(degrees.length)
    /* two notes is not a scale you can stack a chord on, and twelve is Chromatic */
    expect(degrees.length).toBeGreaterThanOrEqual(5)
    expect(degrees.length).toBeLessThanOrEqual(12)
  })

  it('has no two with the same id, label or degrees', () => {
    /* a duplicate id is a picker entry you cannot select; duplicate degrees is two names for one
       scale, which is a menu that wastes somebody's time */
    expect(new Set(SCALES.map(([id]) => id)).size).toBe(SCALES.length)
    expect(new Set(SCALES.map(label)).size).toBe(SCALES.length)
    expect(new Set(SCALES.map(([, , d]) => d.join(','))).size).toBe(SCALES.length)
  })

  it('keeps Chromatic first and complete, because it is the default', () => {
    expect(SCALES[0][0]).toBe('chromatic')
    expect(SCALES[0][2]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('still carries every id a saved rig might name', () => {
    /**
     * ⚠️ IDS ARE FOREVER. `makeInstKits` validates a kit's scale against this list and silently
     * falls back to Chromatic for one it does not know, so dropping or renaming an id quietly
     * resets every rig that used it — and the only symptom is somebody's saved sound being
     * slightly wrong. These five shipped first and people have kits on them.
     */
    for (const id of ['chromatic', 'major', 'minor', 'penta', 'blues', 'dorian'])
      expect(SCALES.map(([i]) => i)).toContain(id)
  })
})

describe('the picker', () => {
  it('labels the two pentatonics so neither is just "Pentatonic"', () => {
    /* they arrived in different years and the ambiguity only exists now that both are here */
    const pents = SCALES.filter(([, , d]) => d.length === 5 && [2, 3].includes(d[1]))
    expect(pents.length).toBeGreaterThanOrEqual(2)
    for (const p of pents) expect(label(p)).not.toBe('Pentatonic')
  })

  it('keeps every label short enough not to widen the row on a phone', () => {
    /**
     * ⚠️ A `<select>` IS AS WIDE AS ITS LONGEST OPTION, and three of them share one row at
     * 375px. Measured in the pane: Scale 96px, Key 48px, Chord 89px inside a 327px row. The
     * sentence is printed under the picker precisely so it does not have to live here, and this
     * is the guard that keeps somebody from moving it back.
     */
    for (const s of SCALES) expect(label(s).length, label(s)).toBeLessThanOrEqual(16)
  })

  it('explains itself in one line, not a paragraph', () => {
    for (const [, lab, , hint] of SCALES) {
      expect(hint.length, lab).toBeLessThanOrEqual(60)
      /* a full stop would read oddly where the room prints it, which adds its own */
      expect(hint.endsWith('.'), lab).toBe(false)
    }
  })
})

describe('degreesOf', () => {
  it('answers for every scale on the menu', () => {
    for (const [id, , degrees] of SCALES) expect(degreesOf(id)).toEqual(degrees)
  })

  it('falls back to Chromatic for an id nobody has heard of', () => {
    /* an old localStorage value, or a shared rig from a future version */
    expect(degreesOf('locrian-ultra')).toEqual(SCALES[0][2])
    expect(degreesOf('')).toEqual(SCALES[0][2])
  })
})

describe('MAJOR_DEGREES', () => {
  it('is the major scale off the list, not a second copy of it', () => {
    expect(MAJOR_DEGREES).toBe(degreesOf('major'))
  })

  it('is what makes a chord on Chromatic come out major', () => {
    const notes = chordNotes('triad', 61, MAJOR_DEGREES, 61 % 12)
    expect(notes.map((n) => n - notes[0])).toEqual([0, 4, 7])
  })
})

describe('every chord on every degree of every scale', () => {
  /**
   * ⚠️ THE SWEEP THAT MAKES A NEW SCALE SAFE, and the reason this file exists at all. For each
   * scale on the menu, in each of the twelve keys, from each of the twenty-five keyboard
   * positions, every shape in the picker: the notes land inside the scale and they ascend.
   *
   * Written from the room's own `noteAt` arithmetic for the position-to-note step, because that
   * is the input being modelled — but the EXPECTATION is the musical property, never a second
   * evaluation of `chordNotes`.
   */
  it('stays inside the scale and ascends', () => {
    for (const [sid, lab, degrees] of SCALES) {
      /* Chromatic contains everything, so "inside the scale" is vacuous there — the room resolves
         its chords against Major instead, which is covered above and in chords.test.ts */
      if (sid === 'chromatic') continue
      for (let root = 0; root < 12; root++) {
        for (let i = 0; i < 25; i++) {
          const midi = 60 + root + Math.floor(i / degrees.length) * 12 + degrees[i % degrees.length]
          for (const [id] of CHORDS) {
            const notes = chordNotes(id as ChordId, midi, degrees, root)
            expect(notes[0], `${lab} key ${root} pos ${i} ${id}`).toBe(midi)
            for (let n = 1; n < notes.length; n++)
              expect(notes[n], `${lab} ${id} ascends`).toBeGreaterThan(notes[n - 1])
            /* the fixed-interval shapes are deliberately not diatonic — a power chord has no
               key to be in, which is the honest half of offering it */
            if (id !== 'octave' && id !== 'fifth' && id !== 'off')
              for (const n of notes)
                expect(degrees, `${lab} key ${root} pos ${i} ${id} played ${n}`).toContain(
                  (((n - root) % 12) + 12) % 12,
                )
          }
        }
      }
    }
  })

  it('never ADDS a note the synth cannot play', () => {
    /**
     * ⚠️ "ADDS", AND THE FIRST VERSION OF THIS TEST SAID "ASKS FOR" — which failed, and was
     * right to. The pressed note itself can be above 127: a five-note scale rolls over five
     * times across the twenty-five keys, so the top of the board at a high octave is already
     * past the end of MIDI before any chord is involved. That is the room's own `noteAt` and it
     * predates this feature by a long way (noted for Evan rather than changed here — what the
     * top octave should mean on a short scale is a product call).
     *
     * So the property a chord owes is narrower and is the one that matters: it never makes the
     * range worse than the single note already was. Everything it adds is playable, and the
     * note you pressed is passed through untouched — because a key that sounds nothing and
     * cannot be released is a dead key, where an inaudible one is merely high.
     */
    for (const [, lab, degrees] of SCALES)
      for (let root = 0; root < 12; root++)
        for (let i = 0; i < 25; i++) {
          const midi = 60 + root + Math.floor(i / degrees.length) * 12 + degrees[i % degrees.length]
          for (const [id] of CHORDS) {
            const notes = chordNotes(id as ChordId, midi, degrees, root)
            expect(notes.length, `${lab} ${id} is never silent`).toBeGreaterThan(0)
            expect(notes[0], `${lab} ${id} passes the pressed note through`).toBe(midi)
            for (const n of notes.slice(1))
              expect(n, `${lab} ${id} added an unplayable note`).toBeLessThanOrEqual(127)
          }
        }
  })
})
