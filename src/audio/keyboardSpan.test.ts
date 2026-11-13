import { describe, expect, it } from 'vitest'
import {
  isBlack,
  FULL_SPAN,
  OCTAVE_HIGH,
  OCTAVE_LOW,
  PHONE_KEYBOARD,
  keysToShow,
  shiftOctave,
} from './keyboardSpan'
import { SCALES } from './scales'

/**
 * A shorter keyboard must not be a smaller instrument.
 *
 * ⚠️ THE PROPERTY THAT MATTERS IS REACHABILITY, not the key count. Drawing fewer keys is only
 * safe if every note is still gettable — and the way it stops being safe is subtle and silent:
 * the octave buttons shift by twelve semitones, so a window narrower than an octave leaves a
 * hole between one setting and the next. Nine chromatic keys is C through G♯; Octave up jumps to
 * C5; A, A♯ and B exist at no setting at all. Nothing errors, the keyboard looks fine, and three
 * notes are missing from the instrument.
 *
 * So the load-bearing test here is a sweep that asks every scale whether the octave buttons can
 * reach every one of its notes, rather than four examples of the arithmetic.
 */

describe('every note stays reachable', () => {
  it.each(SCALES.map((s) => [s[1], s[2]] as const))(
    'the octave buttons cover all of %s with no hole',
    (_name, degrees) => {
      const span = keysToShow(degrees.length, true)
      /**
       * Walk the octave settings the room allows and collect every pitch the keys can produce.
       * `noteAt` in the room is `base + root + floor(i / L) * 12 + degrees[i % L]`, so this is
       * the same shape — the EXPECTATION, though, is "every note of the scale in every octave",
       * which is a claim about the instrument rather than about that formula.
       */
      const reachable = new Set<number>()
      for (let octave = 0; octave <= 6; octave++)
        for (let i = 0; i < span; i++)
          reachable.add(
            (octave + 1) * 12 + Math.floor(i / degrees.length) * 12 + degrees[i % degrees.length],
          )
      /* every note of the scale, in every octave the room offers */
      for (let octave = 0; octave <= 6; octave++)
        for (const d of degrees)
          expect(reachable, `octave ${octave} degree ${d}`).toContain((octave + 1) * 12 + d)
    },
  )

  it('shows at least one full octave of every scale', () => {
    /* the same rule stated directly: the top key is the root again, one octave up */
    for (const [, name, degrees] of SCALES) {
      const span = keysToShow(degrees.length, true)
      const lowest = degrees[0]
      const highest =
        Math.floor((span - 1) / degrees.length) * 12 + degrees[(span - 1) % degrees.length]
      expect(highest - lowest, name).toBeGreaterThanOrEqual(12)
    }
  })

  it('would FAIL to cover an octave if the + 1 were dropped', () => {
    /**
     * ⚠️ THE OFF-BY-ONE, ASSERTED RATHER THAN TRUSTED. `degreeCount` keys tiles the octave
     * exactly only if you count the gap after the last key, which the octave BUTTON does and
     * the eye does not — so `L` keys is a keyboard whose last note is a semitone short of home.
     * This is the one place the mistake is cheap to state, and it is why the test above is a
     * sweep rather than a spot check.
     */
    const chromatic = 12
    const withPlusOne = keysToShow(chromatic, true)
    expect(withPlusOne).toBe(13)
    /* degrees 0..11 is eleven semitones of span, not twelve: B is not C */
    expect(chromatic - 1).toBeLessThan(12)
  })
})

describe('how many keys', () => {
  it('leaves the desktop keyboard exactly as it was', () => {
    /* two octaves, matching the four typing rows — a desktop has a computer keyboard and the
       keys on screen have to keep answering to it */
    for (const [, , degrees] of SCALES) expect(keysToShow(degrees.length, false)).toBe(FULL_SPAN)
    expect(FULL_SPAN).toBe(25)
  })

  it('is one octave plus the root on a phone', () => {
    expect(keysToShow(12, true)).toBe(13) // Chromatic
    expect(keysToShow(7, true)).toBe(8) // Major, Minor, the modes
    expect(keysToShow(6, true)).toBe(7) // Blues, Whole tone
    expect(keysToShow(5, true)).toBe(6) // the pentatonics, Hirajoshi
  })

  it('never draws more on a phone than on a desktop', () => {
    /* a scale with thirty degrees is not a thing today; if one arrived the phone must not end
       up with the longer keyboard */
    for (const n of [1, 5, 12, 24, 25, 40, 1000])
      expect(keysToShow(n, true)).toBeLessThanOrEqual(FULL_SPAN)
  })

  it('falls back to the long keyboard for a degree count that makes no sense', () => {
    for (const n of [0, -3, NaN, Infinity]) expect(keysToShow(n, true)).toBe(FULL_SPAN)
  })

  it('always leaves enough keys to play a chord on', () => {
    /* a Seventh stacks four scale degrees, so a keyboard shorter than that would have chords
       running off the end of it on every key */
    for (const [, name, degrees] of SCALES)
      expect(keysToShow(degrees.length, true), name).toBeGreaterThanOrEqual(6)
  })
})

describe('the breakpoint', () => {
  it('is the one the stylesheet uses, written once', () => {
    /**
     * ⚠️ THE DRIFT THIS GUARDS. `src/index.css` moves the keyboard to the top of the room at
     * exactly this query. A JS copy that fell out of step would hand a phone the phone LAYOUT
     * and the desktop KEYBOARD — the one combination neither half was designed for, and nothing
     * would report it.
     */
    expect(PHONE_KEYBOARD).toBe(
      '(max-width: 780px), (orientation: landscape) and (max-height: 560px)',
    )
  })

  it('asks about height as well as width, because a phone turns sideways', () => {
    /* a phone held sideways is 844px wide, so a width-only rule misses the orientation
       somebody rotated into in order to play */
    expect(PHONE_KEYBOARD).toContain('max-width')
    expect(PHONE_KEYBOARD).toContain('max-height')
    expect(PHONE_KEYBOARD).toContain('landscape')
  })
})

describe('moving the octave', () => {
  it('steps by one in each direction', () => {
    expect(shiftOctave(4, 1)).toBe(5)
    expect(shiftOctave(4, -1)).toBe(3)
  })

  it('stops at the ends rather than wrapping or running off', () => {
    /* ⚠️ a wrap would be the worst answer: pressing "up" at the top and landing five octaves
       lower is a jump nobody asked for, in the middle of playing */
    expect(shiftOctave(OCTAVE_HIGH, 1)).toBe(OCTAVE_HIGH)
    expect(shiftOctave(OCTAVE_LOW, -1)).toBe(OCTAVE_LOW)
    expect(shiftOctave(OCTAVE_HIGH, 99)).toBe(OCTAVE_HIGH)
    expect(shiftOctave(OCTAVE_LOW, -99)).toBe(OCTAVE_LOW)
  })

  it('clamps a stored octave that is out of range', () => {
    /* localStorage is somebody's old value, or a rig from a future version */
    expect(shiftOctave(99, 0)).toBe(OCTAVE_HIGH)
    expect(shiftOctave(-4, 0)).toBe(OCTAVE_LOW)
  })

  it('agrees with the range the buttons and the number input use', () => {
    expect([OCTAVE_LOW, OCTAVE_HIGH]).toEqual([1, 6])
  })
})

/** The one isBlack, shared by the keyboard and the note editor since 11 Nov 2026 (it was two). */
describe('which keys are black', () => {
  it('C♯ D♯ F♯ G♯ A♯ in every octave, and nothing else', () => {
    const black = Array.from({ length: 12 }, (_, pc) => pc).filter((pc) => isBlack(60 + pc))
    expect(black).toEqual([1, 3, 6, 8, 10])
    expect(isBlack(61)).toBe(isBlack(61 - 48))
  })

  it('below MIDI 0 as well, which a transpose can reach', () => {
    expect(isBlack(-11)).toBe(true) // the C♯ below C-1
    expect(isBlack(-12)).toBe(false)
  })
})
