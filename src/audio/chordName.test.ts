import { describe, expect, it } from 'vitest'
import { nameChord, pitchName } from './chordName'
import { CHORDS, chordNotes } from './chords'
import { SCALES } from './scales'

/**
 * Naming what somebody is holding.
 *
 * ⚠️ EVERY EXPECTATION IS A FACT ABOUT MUSIC, not a re-run of the matcher. C-E-G is C major in
 * every book ever printed; C-E-A is A minor with C underneath, and calling it a C chord is the
 * mistake this file exists to not make. The sweep at the bottom is the one that would catch a
 * change nobody thought about: every chord the room can actually produce either gets a name or
 * is honestly refused, and no chord is ever named after the wrong root.
 */

const C4 = 60

describe('one note', () => {
  it('is just the note', () => {
    expect(nameChord([60])).toBe('C')
    expect(nameChord([61])).toBe('C♯')
    expect(nameChord([71])).toBe('B')
  })

  it('is still one note when it is doubled at the octave', () => {
    /* the Octave strum shape plays exactly this, and "C and its fifth" for two Cs would be
       nonsense */
    expect(nameChord([60, 72])).toBe('C')
  })

  it('names nothing when nothing is held', () => {
    expect(nameChord([])).toBeNull()
  })
})

describe('two notes', () => {
  it('reads as a phrase rather than a chord', () => {
    expect(nameChord([60, 67])).toBe('C and its fifth')
    expect(nameChord([60, 65])).toBe('C and its fourth')
    expect(nameChord([60, 64])).toBe('C and its third')
    expect(nameChord([60, 63])).toBe('C and its minor third')
  })

  it('names the power chord the Fifth shape makes', () => {
    /* [0, 7, 12] — the octave is a duplicate pitch class, so this is a two-note shape */
    expect(nameChord(chordNotes('fifth', C4, [0, 2, 4, 5, 7, 9, 11], 0))).toBe('C and its fifth')
  })
})

describe('triads', () => {
  it.each([
    [[60, 64, 67], 'C major'],
    [[60, 63, 67], 'C minor'],
    [[60, 63, 66], 'C diminished'],
    [[60, 64, 68], 'C augmented'],
    [[60, 65, 67], 'C suspended fourth'],
    [[60, 62, 67], 'C suspended second'],
    [[62, 65, 69], 'D minor'],
    [[67, 71, 74], 'G major'],
  ])('%s is %s', (notes, want) => {
    expect(nameChord(notes)).toBe(want)
  })

  it('does not care what order they arrive in', () => {
    expect(nameChord([67, 60, 64])).toBe('C major')
  })

  it('does not care which octave they are in', () => {
    expect(nameChord([60, 76, 91])).toBe('C major')
  })
})

describe('sevenths', () => {
  it.each([
    [[60, 64, 67, 71], 'C major 7'],
    [[62, 65, 69, 72], 'D minor 7'],
    [[67, 71, 74, 77], 'G seventh'],
    [[71, 74, 77, 81], 'B half-diminished'],
  ])('%s is %s', (notes, want) => {
    expect(nameChord(notes)).toBe(want)
  })

  it('is never named as the triad hiding inside it', () => {
    /**
     * C-E-G-B contains C-E-G, so a matcher that stopped at the first three notes it recognised
     * would call a major seventh "C major" and quietly drop the note that makes it interesting.
     *
     * ⚠️ THIS TEST PASSES FOR A DIFFERENT REASON THAN I FIRST WROTE DOWN. I had it that the
     * shape table is ordered longest-first; shuffling the table to watch this go red left all
     * thirty green. The lookup is on the WHOLE interval set, so a four-note chord can only
     * match a four-entry shape and the ordering is cosmetic. The test is still worth having —
     * it pins the behaviour against a future matcher that works by prefix — the comment was
     * just describing machinery that was not doing the work.
     */
    expect(nameChord([60, 64, 67, 71])).not.toBe('C major')
  })
})

describe('inversions', () => {
  /**
   * ⚠️ THE CASE THE ROOM MAKES ON AN ORDINARY KEYPRESS. A Triad on the pentatonic scale is
   * degrees 0, 2 and 4 of [0,2,4,7,9] — C, E and A — which is A minor with C underneath. Naming
   * a chord from its lowest note would be wrong here, and confidently so.
   */
  it('finds the root rather than assuming the bass is it', () => {
    expect(nameChord([60, 64, 69])).toBe('A minor / C')
    expect(nameChord([64, 67, 72])).toBe('C major / E')
    expect(nameChord([67, 72, 76])).toBe('C major / G')
  })

  it('is what the pentatonic Triad actually produces', () => {
    const penta = SCALES.find(([id]) => id === 'penta')![2]
    expect(nameChord(chordNotes('triad', C4, penta, 0))).toBe('A minor / C')
  })

  it('says nothing about a bass note when the root IS the bass', () => {
    expect(nameChord([60, 64, 67])).toBe('C major')
    expect(nameChord([60, 64, 67])).not.toContain('/')
  })

  it('reads the bass from the lowest sounding note, not the lowest pitch class', () => {
    /* E below middle C under a C major triad is still C major over E */
    expect(nameChord([52, 60, 67])).toBe('C major / E')
  })
})

describe('refusing to guess', () => {
  /**
   * ⚠️ NULL IS THE IMPORTANT ANSWER. A readout that invented a name for every handful of keys
   * would be noise, and wrong in a way nobody could check — the same call `needsAName` makes in
   * the mobile audit about a checker that cries wolf.
   */
  it('says nothing about a cluster', () => {
    expect(nameChord([60, 61, 62])).toBeNull()
    expect(nameChord([60, 61, 62, 63])).toBeNull()
  })

  it('says nothing about five notes it has no shape for', () => {
    expect(nameChord([60, 61, 64, 66, 70])).toBeNull()
  })

  it('names a tritone pair as nothing rather than as something', () => {
    /* there is no plain word for it, and "C diminished fifth" is notation in disguise */
    expect(nameChord([60, 66])).toBeNull()
  })
})

describe('the sweep', () => {
  /**
   * ⚠️ THE ONE THAT WOULD CATCH WHAT NOBODY THOUGHT OF. Every chord the room can actually make
   * — every shape, on every degree, of every scale, in every key — is either named or honestly
   * refused, and when it IS named the root is a note that is actually sounding.
   */
  it('never names a chord after a note that is not being played', () => {
    const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
    for (const [sid, label, degrees] of SCALES) {
      if (sid === 'chromatic') continue
      for (let root = 0; root < 12; root++) {
        for (let i = 0; i < 12; i++) {
          const midi = 60 + root + Math.floor(i / degrees.length) * 12 + degrees[i % degrees.length]
          for (const [id] of CHORDS) {
            const notes = chordNotes(id, midi, degrees, root)
            const name = nameChord(notes)
            if (name === null) continue
            const heard = new Set(notes.map((n) => NAMES[((n % 12) + 12) % 12]))
            const named = name.split(' ')[0]
            expect(heard, `${label} ${id} at ${midi}: named ${name}`).toContain(named)
          }
        }
      }
    }
  })

  it('names most of what the room produces, or the readout is not worth having', () => {
    let named = 0
    let total = 0
    for (const [sid, , degrees] of SCALES) {
      if (sid === 'chromatic') continue
      for (let i = 0; i < 12; i++) {
        const midi = 60 + Math.floor(i / degrees.length) * 12 + degrees[i % degrees.length]
        for (const [id] of CHORDS) {
          if (id === 'off') continue
          total++
          if (nameChord(chordNotes(id, midi, degrees, 0))) named++
        }
      }
    }
    /* a readout that shrugged at half of what the instrument makes would teach nobody anything */
    expect(named / total, `named ${named} of ${total}`).toBeGreaterThan(0.8)
  })
})

describe('pitchName', () => {
  it('wraps in both directions', () => {
    expect(pitchName(0)).toBe('C')
    expect(pitchName(12)).toBe('C')
    expect(pitchName(127)).toBe('G')
    expect(pitchName(-1)).toBe('B')
    expect(pitchName(-12)).toBe('C')
  })
})

describe('harmonic minor, which had the only real gaps', () => {
  /**
   * Derived by stacking the scale's own degrees rather than guessed: of everything the room can
   * produce, these two were the only shapes the table had no word for — and the first is the
   * TONIC seventh, the chord you get pressing the first key with Seventh chosen. A blank line
   * there is a gap in exactly the place somebody would look.
   */
  it('names the tonic seventh', () => {
    /* C, E♭, G, B — minor triad with a major seventh on top */
    expect(nameChord([60, 63, 67, 71])).toBe('C minor major 7')
  })

  it('names the seventh on the third degree', () => {
    /* E♭, G, B, D — augmented triad with a major seventh */
    expect(nameChord([63, 67, 71, 74])).toBe('D♯ augmented major 7')
  })

  it('leaves nothing on harmonic minor unnamed', () => {
    const degrees = SCALES.find(([id]) => id === 'harmonic')![2]
    for (let i = 0; i < degrees.length; i++)
      for (const [id] of CHORDS) {
        if (id === 'off') continue
        const notes = chordNotes(id, 60 + degrees[i], degrees, 0)
        expect(nameChord(notes), `${id} on degree ${i}: ${notes.join()}`).not.toBeNull()
      }
  })
})
