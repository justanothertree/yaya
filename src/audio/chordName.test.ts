import { describe, expect, it } from 'vitest'
import { keySpeller, nameChord, pitchName } from './chordName'
import { CHORDS, chordNotes } from './chords'
import { SCALES, degreesOf } from './scales'

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

/**
 * Evan, 9 Nov 2026: the backing's hint read "A♯ major underneath" in D minor. It is B♭.
 *
 * ⚠️ THE EXPECTATIONS ARE WHAT A SONGBOOK PRINTS for each key, never derived from the spelling
 * arithmetic — the chords of a key are written down in every theory book and that is the claim.
 */
describe('chords spelled in the room’s key', () => {
  const major = degreesOf('major')
  const minor = degreesOf('minor')
  /** a triad from its root's pitch class and quality, around middle C */
  const triad = (pc: number, kind: 'major' | 'minor' | 'dim') =>
    [0, kind === 'major' ? 4 : 3, kind === 'dim' ? 6 : 7].map((i) => 60 + pc + i)

  it('D minor’s sixth chord is B♭ major, not A♯', () => {
    expect(nameChord(triad(10, 'major'))).toBe('A♯ major')
    expect(nameChord(triad(10, 'major'), keySpeller(minor, 2))).toBe('B♭ major')
  })

  it('the flat keys read flat: F, B♭, E♭, A♭, D♭ major and their relative minors', () => {
    expect(nameChord(triad(10, 'major'), keySpeller(major, 5))).toBe('B♭ major')
    expect(nameChord(triad(3, 'major'), keySpeller(minor, 7))).toBe('E♭ major')
    expect(nameChord(triad(8, 'major'), keySpeller(major, 3))).toBe('A♭ major')
    expect(nameChord(triad(3, 'minor'), keySpeller(major, 1))).toBe('E♭ minor')
    expect(nameChord(triad(10, 'minor'), keySpeller(minor, 10))).toBe('B♭ minor')
  })

  it('and the sharp keys still read sharp', () => {
    /* E major: G♯ minor and C♯ minor, D♯ diminished */
    expect(nameChord(triad(8, 'minor'), keySpeller(major, 4))).toBe('G♯ minor')
    expect(nameChord(triad(1, 'minor'), keySpeller(major, 4))).toBe('C♯ minor')
    expect(nameChord(triad(3, 'dim'), keySpeller(major, 4))).toBe('D♯ diminished')
    /* C♯ minor is written with sharps, though its root is a black key */
    expect(nameChord(triad(1, 'minor'), keySpeller(minor, 1))).toBe('C♯ minor')
  })

  it('gives every degree its own letter — D harmonic minor has B♭ and C♯ together', () => {
    const harmonic = degreesOf('harmonic')
    expect(nameChord(triad(10, 'major'), keySpeller(harmonic, 2))).toBe('B♭ major')
    expect(nameChord(triad(1, 'dim'), keySpeller(harmonic, 2))).toBe('C♯ diminished')
    /* F♯ major's seventh is E♯, not a second F */
    expect(nameChord(triad(5, 'dim'), keySpeller(major, 6))).toBe('E♯ diminished')
  })

  it('every seven-note scale in every key spells its degrees on seven different letters', () => {
    const bad: string[] = []
    let keys = 0
    for (const [id, , degrees] of SCALES) {
      if (degrees.length !== 7) continue
      for (let root = 0; root < 12; root++) {
        keys++
        const spell = keySpeller(degrees, root)
        const names = degrees.map((d) => spell(root + d))
        if (new Set(names.map((n) => n[0])).size !== 7)
          bad.push(`${id} ${root}: ${names.join(' ')}`)
      }
    }
    expect(keys).toBe(84)
    expect(bad).toEqual([])
  })

  it('and the two that need a double sharp are spelled from their flat names', () => {
    /* D♯ harmonic minor would need C𝄪; E♭ harmonic minor is E♭ F G♭ A♭ B♭ C♭ D */
    const harmonic = degreesOf('harmonic')
    expect(harmonic.map((d) => keySpeller(harmonic, 3)(3 + d))).toEqual([
      'E♭',
      'F',
      'G♭',
      'A♭',
      'B♭',
      'C♭',
      'D',
    ])
  })

  it('a note outside the scale takes the key’s accidentals, and an inversion’s bass is spelled too', () => {
    /* D♭ added by hand in F major */
    expect(keySpeller(major, 5)(1)).toBe('D♭')
    /* B♭ major over D, in F */
    expect(nameChord([62, 65, 70], keySpeller(major, 5))).toBe('B♭ major / D')
    expect(nameChord([65, 70, 74], keySpeller(major, 5))).toBe('B♭ major / F')
  })

  /* five notes cannot be spelled by letters, so the key signature alone decides — and a minor
     scale's signature is its relative major's: G minor's is B♭ major's, two flats */
  it('a five-note scale takes the signature of its key — G minor pentatonic reads B♭', () => {
    expect(nameChord(triad(10, 'major'), keySpeller(degreesOf('minorPenta'), 7))).toBe('B♭ major')
    /* and B minor pentatonic, whose relative major is D, keeps F♯ */
    expect(keySpeller(degreesOf('minorPenta'), 11)(6)).toBe('F♯')
  })

  it('Chromatic has no key, and keeps its sharps', () => {
    expect(nameChord(triad(10, 'major'), keySpeller(degreesOf('chromatic'), 0))).toBe('A♯ major')
  })
})
