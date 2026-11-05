import { describe, expect, it } from 'vitest'
import { CHORDS, chordNotes, usesScale, type ChordId } from './chords'

/**
 * What a chord button owes the key you are in.
 *
 * ⚠️ EVERY EXPECTATION HERE IS A FACT ABOUT MUSIC, NOT A RE-RUN OF THE LOOP. A triad on the
 * second degree of a major scale is MINOR — that is true of pianos, hymn books and this file
 * alike, and it is stated here as the semitone intervals 0-3-7 rather than as whatever
 * `midi + deg(from + s) - degrees[from]` evaluates to. A test built from the same sum as the code
 * confirms the mistake, which this repository has paid for three times in the park's geometry;
 * the whole point of the scale-step stack is that ONE list of steps produces different
 * qualities, so a test that cannot tell a major third from a minor one is testing nothing.
 *
 * The scales are spelled out locally on purpose. `chordNotes` has to be right for any degree
 * list it is handed, not only for the six on the room's menu — the menu gets swept against it in
 * `scales.test.ts`, where the real list lives.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const PENTA = [0, 2, 4, 7, 9]

/** What a chord sounds like, independent of where it is: the gaps from its lowest note. */
const shape = (notes: number[]) => notes.map((n) => n - notes[0])

const C4 = 60

describe('off', () => {
  it('is one note, which is what a keyboard is', () => {
    expect(chordNotes('off', C4, MAJOR, 0)).toEqual([C4])
  })

  it('is one note whatever scale it is handed', () => {
    for (const d of [MAJOR, MINOR, PENTA, []]) expect(chordNotes('off', C4, d, 0)).toEqual([C4])
  })
})

describe('the fixed shapes', () => {
  it('doubles at the octave', () => {
    expect(chordNotes('octave', C4, MAJOR, 0)).toEqual([60, 72])
  })

  it('plays a fifth and an octave, with no third to be wrong about', () => {
    expect(shape(chordNotes('fifth', C4, MAJOR, 0))).toEqual([0, 7, 12])
  })

  it('is the same interval on every degree, in or out of key', () => {
    /* ⚠️ THE HONEST PART OF OFFERING IT. A fixed fifth above the seventh degree of a major
       scale is not in that scale — B to F♯ in C major. That is not a bug in the shape, it is
       what a power chord IS, and it is why this one is labelled as a fixed interval and the
       triad is labelled as coming from the scale. */
    for (const n of [60, 61, 66, 71])
      expect(shape(chordNotes('fifth', n, MAJOR, 0))).toEqual([0, 7, 12])
  })
})

describe('a triad takes its quality from the degree it sits on', () => {
  /**
   * The seven triads of a major scale, which every book agrees on: major, minor, minor, major,
   * major, minor, diminished. One list of steps, seven different chords — and if the steps were
   * read as semitones every one of these would be 0-2-4.
   */
  it.each([
    ['C (I)', 60, [0, 4, 7], 'major'],
    ['D (ii)', 62, [0, 3, 7], 'minor'],
    ['E (iii)', 64, [0, 3, 7], 'minor'],
    ['F (IV)', 65, [0, 4, 7], 'major'],
    ['G (V)', 67, [0, 4, 7], 'major'],
    ['A (vi)', 69, [0, 3, 7], 'minor'],
    ['B (vii°)', 71, [0, 3, 6], 'diminished'],
  ])('on %s in C major is %s semitones — %s', (_name, midi, want) => {
    expect(shape(chordNotes('triad', midi, MAJOR, 0))).toEqual(want)
  })

  it('names the right notes, not just the right gaps', () => {
    /* C-E-G and A-C-E, the second of which has to roll over the top of the scale into the next
       octave to find its third */
    expect(chordNotes('triad', 60, MAJOR, 0)).toEqual([60, 64, 67])
    expect(chordNotes('triad', 69, MAJOR, 0)).toEqual([69, 72, 76])
  })

  it('is minor on the first degree of a minor scale', () => {
    expect(shape(chordNotes('triad', 60, MINOR, 0))).toEqual([0, 3, 7])
  })

  it('transposes with the key rather than ignoring it', () => {
    /* the same degree of D major must be the same chord a whole tone up */
    const inC = chordNotes('triad', 62, MAJOR, 0) // ii of C major — D minor
    const inD = chordNotes('triad', 64, MAJOR, 2) // ii of D major — E minor
    expect(shape(inD)).toEqual(shape(inC))
    expect(inD[0] - inC[0]).toBe(2)
  })
})

describe('a seventh', () => {
  it.each([
    ['C (Imaj7)', 60, [0, 4, 7, 11]],
    ['D (ii7)', 62, [0, 3, 7, 10]],
    ['G (V7)', 67, [0, 4, 7, 10]],
  ])('on %s in C major is %s semitones', (_name, midi, want) => {
    expect(shape(chordNotes('seventh', midi, MAJOR, 0))).toEqual(want)
  })

  it('is four notes, which is the most the voice budget allows', () => {
    /* MAX_VOICES is 16, so four notes is four keys before the synth starts cutting the oldest */
    expect(chordNotes('seventh', C4, MAJOR, 0)).toHaveLength(4)
  })
})

describe('the invariant, swept', () => {
  /**
   * ⚠️ THE ONE TEST THAT DOES NOT NAME A CHORD, and the strongest of them. Whatever the shape,
   * whatever the key, whatever the degree: a chord built from the scale is IN the scale. It needs
   * no theory to read and it would catch a rollover, a sign error or an off-by-one in the octave
   * carry on any scale, including one added years from now.
   */
  it('never plays a note outside the scale', () => {
    for (const degrees of [MAJOR, MINOR, PENTA]) {
      for (let rootPc = 0; rootPc < 12; rootPc++) {
        /* every key on the board, which is how far a chord can be stacked from */
        for (let i = 0; i < 25; i++) {
          const oct = Math.floor(i / degrees.length)
          const midi = 60 + rootPc + oct * 12 + degrees[i % degrees.length]
          for (const id of ['triad', 'seventh'] as ChordId[]) {
            for (const n of chordNotes(id, midi, degrees, rootPc)) {
              const pc = (((n - rootPc) % 12) + 12) % 12
              expect(degrees, `${id} from midi ${midi}, root ${rootPc} played ${n}`).toContain(pc)
            }
          }
        }
      }
    }
  })

  it('always ascends, so the pressed note is the bottom of the chord', () => {
    for (const degrees of [MAJOR, MINOR, PENTA]) {
      for (const id of ['octave', 'fifth', 'triad', 'seventh'] as ChordId[]) {
        for (let i = 0; i < 20; i++) {
          const notes = chordNotes(id, 60 + i, degrees, 0)
          for (let n = 1; n < notes.length; n++)
            expect(notes[n], `${id} at ${60 + i}`).toBeGreaterThan(notes[n - 1])
        }
      }
    }
  })

  it('always starts on the note the key would have played alone', () => {
    /**
     * ⚠️ A CONTRACT THE ROOM DEPENDS ON. The first note of a press keeps the bare voice id, so
     * the single-note path through the synth is unchanged — and the keyboard lights the key you
     * pressed because that key's own note is in the list.
     */
    for (const [id] of CHORDS)
      for (const d of [MAJOR, MINOR, PENTA]) expect(chordNotes(id, 67, d, 0)[0]).toBe(67)
  })
})

describe('pentatonic', () => {
  it('stacks to a sixth rather than a triad, and stays in the scale', () => {
    /* [0,2,4] of [0,2,4,7,9] is C-E-A — not a textbook triad, and that is the right answer:
       the scale has no fourth or fifth degree to borrow, and every note is still one you chose */
    expect(chordNotes('triad', 60, PENTA, 0)).toEqual([60, 64, 69])
  })

  it('rolls into the next octave when the pattern runs out', () => {
    /* from the fourth degree of five, a three-note stack must wrap twice */
    expect(shape(chordNotes('triad', 67, PENTA, 0))).toEqual([0, 5, 9])
  })
})

describe('chromatic, resolved against major', () => {
  /**
   * Chromatic has no degrees that can answer "two steps up" — every semitone is in it. The room
   * therefore hands over the MAJOR degrees with the pressed note as the root, which makes every
   * chord major: predictable, and what a chord button on a cheap keyboard does.
   */
  it('is a major triad on every one of the twelve notes', () => {
    for (let pc = 0; pc < 12; pc++)
      expect(shape(chordNotes('triad', 60 + pc, MAJOR, (60 + pc) % 12))).toEqual([0, 4, 7])
  })

  it('is a major seventh on every one of the twelve notes', () => {
    for (let pc = 0; pc < 12; pc++)
      expect(shape(chordNotes('seventh', 60 + pc, MAJOR, (60 + pc) % 12))).toEqual([0, 4, 7, 11])
  })
})

describe('the edges', () => {
  it('drops a note that would be above the top of MIDI rather than asking for it', () => {
    /* the keyboard tops out well below this; a kit or a shared layer need not */
    expect(chordNotes('octave', 120, MAJOR, 0)).toEqual([120])
    expect(chordNotes('seventh', 126, MAJOR, 0)).toEqual([126])
  })

  it('keeps the pressed note even when every other note is out of range', () => {
    for (const [id] of CHORDS) expect(chordNotes(id, 127, MAJOR, 0)).toEqual([127])
  })

  it('plays one note for a scale with no degrees', () => {
    expect(chordNotes('triad', C4, [], 0)).toEqual([C4])
  })

  it('snaps a note outside the scale to the root rather than falling silent', () => {
    /**
     * ⚠️ WHICH WAY IT FAILS MATTERS. The room cannot produce this — `noteAt` only returns scale
     * notes — but a control that is a chord on most keys and one note on others is worse than one
     * that is slightly wrong everywhere. C♯ is not in C major; it still gets three notes.
     */
    const notes = chordNotes('triad', 61, MAJOR, 0)
    expect(notes).toHaveLength(3)
    expect(notes[0]).toBe(61)
    expect(shape(notes)).toEqual([0, 4, 7])
  })

  it('plays one note for a shape it has never heard of', () => {
    expect(chordNotes('nonsense' as ChordId, C4, MAJOR, 0)).toEqual([C4])
  })
})

describe('the picker', () => {
  it('offers one note first, because that is what the room is', () => {
    expect(CHORDS[0][0]).toBe('off')
  })

  it('stays short enough to choose in a second', () => {
    /* the room's own tempo list: "FOUR, NOT TWELVE — a list long enough to need reading is the
       same blank page with more steps on it" */
    expect(CHORDS.length).toBeLessThanOrEqual(6)
  })

  it('gives every shape a label and a sentence, and no two the same id', () => {
    for (const [id, label, hint] of CHORDS) {
      expect(label.length, id).toBeGreaterThan(0)
      expect(hint.length, id).toBeGreaterThan(0)
    }
    expect(new Set(CHORDS.map(([id]) => id)).size).toBe(CHORDS.length)
  })

  it('offers exactly the shapes that do something, with nothing unreachable', () => {
    /* a shape in the table that the picker does not list is dead code; a picker entry with no
       shape silently falls back to one note */
    for (const [id] of CHORDS) expect(chordNotes(id, C4, MAJOR, 0).length).toBeGreaterThan(0)
    expect(chordNotes('octave', C4, MAJOR, 0)).toHaveLength(2)
  })
})

describe('usesScale', () => {
  it('is true only of the shapes whose notes come from the scale', () => {
    /**
     * ⚠️ THE ROOM PRINTS COPY OFF THIS. "On Chromatic every chord is major" is true of a triad
     * and a seventh, and flatly false of a fifth — a power chord has no third, which is the
     * whole reason it is offered. Getting this wrong told somebody the opposite of what their
     * ears were telling them.
     */
    expect(usesScale('triad')).toBe(true)
    expect(usesScale('seventh')).toBe(true)
    expect(usesScale('fifth')).toBe(false)
    expect(usesScale('octave')).toBe(false)
    expect(usesScale('off')).toBe(false)
  })

  it('agrees with what the shapes actually do', () => {
    /* the property rather than the table: a shape that consults the scale gives different notes
       in different scales, and one that does not gives the same ones everywhere */
    for (const [id] of CHORDS) {
      const inMajor = chordNotes(id, 60, MAJOR, 0).join()
      const inPenta = chordNotes(id, 60, PENTA, 0).join()
      expect(inMajor !== inPenta, id).toBe(usesScale(id))
    }
  })

  it('is false for a shape it has never heard of', () => {
    expect(usesScale('nonsense' as ChordId)).toBe(false)
  })
})
