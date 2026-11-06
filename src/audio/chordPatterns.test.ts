import { describe, expect, it } from 'vitest'
import {
  CHORD_PATTERNS,
  basslineEvents,
  leadBackStep,
  leadsBack,
  progressionEvents,
} from './chordPatterns'
import type { LoopEvent } from './looper'
import { nameChord } from './chordName'
import { MAJOR_DEGREES, SCALES, degreesOf } from './scales'

/**
 * A progression you did not have to play.
 *
 * ⚠️ THE EXPECTATIONS ARE THE CHORDS, BY NAME. `[1, 5, 6, 4]` in C major is C, G, A minor, F —
 * that is true of every songbook ever printed, and asserting it through `nameChord` rather than
 * through a list of MIDI numbers means the test says what a listener would say. A test built
 * from the same arithmetic as `progressionEvents` would agree with it however wrong it was,
 * which is the mistake this repository has paid for in the park's geometry three times.
 */

const major = degreesOf('major')
const minor = degreesOf('minor')
const chordsAt = (events: ReturnType<typeof progressionEvents>['events']) => {
  const byTime = new Map<number, number[]>()
  for (const e of events) {
    if (!e.on) continue
    byTime.set(e.t, [...(byTime.get(e.t) ?? []), e.midi])
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, notes]) => nameChord(notes))
}

describe('the four-chord song', () => {
  it('is C, G, A minor, F in C major', () => {
    const p = CHORD_PATTERNS.find((x) => x.id === 'four')!
    const { events } = progressionEvents(p, 8, major, 0)
    expect(chordsAt(events)).toEqual(['C major', 'G major', 'A minor', 'F major'])
  })

  it('moves with the key rather than ignoring it', () => {
    /* the same degrees in D major: D, A, B minor, G */
    const p = CHORD_PATTERNS.find((x) => x.id === 'four')!
    expect(chordsAt(progressionEvents(p, 8, major, 2).events)).toEqual([
      'D major',
      'A major',
      'B minor',
      'G major',
    ])
  })

  it('re-colours with the scale rather than ignoring it', () => {
    /**
     * ⚠️ THE WHOLE REASON THEY ARE DEGREES. `[1, 5, 6, 4]` on the minor scale is a different
     * progression made of the same numbers — minor where major was major — and nobody had to
     * write a second table for it.
     */
    const p = CHORD_PATTERNS.find((x) => x.id === 'four')!
    expect(chordsAt(progressionEvents(p, 8, minor, 0).events)).toEqual([
      'C minor',
      'G minor',
      'G♯ major',
      'F minor',
    ])
  })
})

describe('every progression', () => {
  it.each(CHORD_PATTERNS.map((p) => [p.name, p] as const))('%s is well formed', (_n, p) => {
    expect(p.id).toMatch(/^[a-z]+$/)
    expect(p.name.length).toBeGreaterThan(0)
    expect(p.hint.length).toBeGreaterThan(0)
    expect(p.degrees.length).toBeGreaterThanOrEqual(3)
    for (const d of p.degrees) {
      expect(Number.isInteger(d), `${p.name} degree ${d}`).toBe(true)
      expect(d, `${p.name} degree ${d}`).toBeGreaterThanOrEqual(1)
      expect(d, `${p.name} degree ${d}`).toBeLessThanOrEqual(7)
    }
  })

  it('names a chord at every step of every SEVEN-NOTE scale', () => {
    /**
     * ⚠️ SEVEN-NOTE ONLY, AND THAT IS A FINDING RATHER THAN A CONVENIENCE. Stacking degrees on
     * a five-note scale produces intervals that have no plain-English name — a triad on the
     * fourth degree of Hirajoshi is a cluster a theorist could label and nobody would call
     * anything. Demanding a name there would be demanding `chordName` cover exotic stacks, and
     * the readout is deliberately silent rather than inventive about those.
     *
     * So the promise is: on the scales people reach for, every chord in every progression is
     * a chord you could name out loud. On the short exotic ones it still PLAYS — the sweep
     * below checks that — it just may not have a word.
     */
    for (const [sid, label, degrees] of SCALES) {
      if (sid === 'chromatic' || degrees.length < 7) continue
      for (const p of CHORD_PATTERNS)
        for (let root = 0; root < 12; root += 5) {
          const got = chordsAt(progressionEvents(p, 8, degrees, root).events)
          expect(got.length, `${p.name} on ${label}`).toBe(p.degrees.length)
          for (const n of got) expect(n, `${p.name} on ${label} key ${root}`).not.toBeNull()
        }
    }
  })

  it('plays something at every step of every scale, nameable or not', () => {
    for (const [sid, label, degrees] of SCALES) {
      if (sid === 'chromatic') continue
      for (const p of CHORD_PATTERNS)
        for (let root = 0; root < 12; root += 5) {
          const { events } = progressionEvents(p, 8, degrees, root)
          const starts = new Set(events.filter((e) => e.on).map((e) => e.t))
          expect(starts.size, `${p.name} on ${label} key ${root}`).toBe(p.degrees.length)
          for (const e of events)
            expect((((e.midi - root) % 12) + 12) % 12, `${label}: ${e.midi}`).toBeOneOf(degrees)
        }
    }
  })

  it('has no two that play the same thing', () => {
    const seen = new Map<string, string>()
    for (const p of CHORD_PATTERNS) {
      const sig = p.degrees.join(',')
      expect(seen.has(sig), `${p.name} is ${seen.get(sig)} again`).toBe(false)
      seen.set(sig, p.name)
    }
  })
})

describe('it fills exactly one lap', () => {
  /**
   * ⚠️ THE OPPOSITE OF A DRUM PATTERN, ON PURPOSE. A beat is a bar that TILES — the scheduler
   * repeats any take shorter than the loop. Harmony does not: four chords crammed into the
   * first bar of a four-bar loop, then three bars of silence, is not the progression anybody
   * meant. So the lap is divided between the chords.
   */
  it.each([2.5, 5, 10, 20])('across a %ss loop', (len) => {
    const p = CHORD_PATTERNS[0]
    const { events, len: out } = progressionEvents(p, len, major, 0)
    expect(out).toBe(len)
    const starts = [...new Set(events.filter((e) => e.on).map((e) => e.t))].sort((a, b) => a - b)
    expect(starts).toHaveLength(p.degrees.length)
    expect(starts[0]).toBe(0)
    /* evenly spaced, and the last chord ends inside the lap rather than over the edge */
    for (let i = 1; i < starts.length; i++)
      expect(starts[i] - starts[i - 1]).toBeCloseTo(len / p.degrees.length, 9)
    expect(Math.max(...events.map((e) => e.t))).toBeLessThan(len)
  })

  it('pairs every note-on with a note-off', () => {
    /* an unpaired on is the shape the packer, the file reader and the note editor all drop —
       drumPatterns says so and pays the same tax with its fixed tail */
    const { events } = progressionEvents(CHORD_PATTERNS[0], 8, major, 0)
    const open = new Map<number, number>()
    for (const e of events) {
      if (e.on) open.set(e.midi, (open.get(e.midi) ?? 0) + 1)
      else open.set(e.midi, (open.get(e.midi) ?? 0) - 1)
    }
    for (const [midi, n] of open) expect(n, `midi ${midi}`).toBe(0)
  })

  it('sits under what you play rather than in the middle of it', () => {
    /**
     * ⚠️ THE FIRST VERSION OF THIS ASKED FOR SOMETHING UNMUSICAL and failed at 64. "Every note
     * below middle C" sounds like the right property and is not: a triad spans up to an octave,
     * and the sixth degree is nine semitones up, so keeping the TOP under 60 would need the
     * roots down at C2 where triads turn to mud. Real backing parts overlap the bottom of the
     * playing range and that is fine.
     *
     * What actually matters is that every chord is ROOTED below the keyboard's starting note
     * and never climbs into the middle of it, so the hand playing over the top always has
     * clear air above the progression.
     */
    for (const [, , degrees] of SCALES.filter(([, , d]) => d.length >= 7))
      for (const p of CHORD_PATTERNS) {
        const { events } = progressionEvents(p, 8, degrees, 0)
        const byTime = new Map<number, number[]>()
        for (const e of events) if (e.on) byTime.set(e.t, [...(byTime.get(e.t) ?? []), e.midi])
        for (const notes of byTime.values()) {
          expect(Math.min(...notes), 'rooted below middle C').toBeLessThan(60)
          expect(Math.max(...notes), 'never up into the playing range').toBeLessThanOrEqual(67)
        }
      }
  })
})

describe('the edges', () => {
  it('gives nothing for a loop with no length', () => {
    expect(progressionEvents(CHORD_PATTERNS[0], 0, major, 0).events).toEqual([])
  })

  it('gives nothing for a scale with no degrees', () => {
    expect(progressionEvents(CHORD_PATTERNS[0], 8, [], 0).events).toEqual([])
  })

  it('wraps a degree past the end of a short scale instead of falling off it', () => {
    /* a pentatonic has five degrees and these progressions ask for a sixth — degree 6 is the
       first degree an octave up, which is what a musician would play */
    const penta = degreesOf('penta')
    const { events } = progressionEvents(CHORD_PATTERNS.find((p) => p.id === 'four')!, 8, penta, 0)
    expect(chordsAt(events).every((n) => n !== null)).toBe(true)
  })
})

describe('a bassline that follows the chords', () => {
  /**
   * ⚠️ THE PROPERTY THAT MATTERS IS AGREEMENT. A bass playing a different chord from the pad
   * above it is the single most audible wrong thing a backing can do, and it is exactly what a
   * second copy of the degree arithmetic would eventually produce. Both come from `triadAt`,
   * and these tests check the result rather than trusting that.
   */
  it('plays the root of each chord the pad is playing', () => {
    const p = CHORD_PATTERNS.find((x) => x.id === 'four')!
    const pad = progressionEvents(p, 8, major, 0).events.filter((e) => e.on)
    const bass = basslineEvents(p, 8, major, 0).events.filter((e) => e.on)
    const padRootAt = (t: number) => Math.min(...pad.filter((e) => e.t === t).map((e) => e.midi))
    for (const slot of [0, 2, 4, 6]) {
      const low = Math.min(...bass.filter((e) => e.t === slot).map((e) => e.midi))
      /* same pitch class as the chord above it, just lower */
      expect((low % 12) + 12, `slot ${slot}`).toBe((padRootAt(slot) % 12) + 12)
      expect(low, `slot ${slot}`).toBeLessThan(padRootAt(slot))
    }
  })

  it('agrees with the pad in every key and every seven-note scale', () => {
    for (const [sid, label, degrees] of SCALES) {
      if (sid === 'chromatic' || degrees.length < 7) continue
      for (const p of CHORD_PATTERNS)
        for (let root = 0; root < 12; root += 4) {
          const pad = progressionEvents(p, 8, degrees, root).events.filter((e) => e.on)
          const bass = basslineEvents(p, 8, degrees, root).events.filter((e) => e.on)
          const slot = 8 / p.degrees.length
          for (let i = 0; i < p.degrees.length; i++) {
            const t = i * slot
            const padPcs = new Set(
              pad.filter((e) => e.t === t).map((e) => ((e.midi % 12) + 12) % 12),
            )
            for (const e of bass.filter((x) => x.t >= t && x.t < t + slot))
              expect(padPcs, `${p.name} ${label} key ${root} at ${t}`).toContain(
                ((e.midi % 12) + 12) % 12,
              )
          }
        }
    }
  })

  it('moves rather than holding, so it is a part and not a doubled root', () => {
    const p = CHORD_PATTERNS[0]
    const on = basslineEvents(p, 8, major, 0).events.filter((e) => e.on)
    /* two notes per chord, not one */
    expect(on).toHaveLength(p.degrees.length * 2)
    const firstSlot = on.filter((e) => e.t < 2).map((e) => e.midi)
    expect(new Set(firstSlot).size, 'the second note is a different pitch').toBe(2)
  })

  it('sits below the chords it follows', () => {
    const p = CHORD_PATTERNS[0]
    const pad = progressionEvents(p, 8, major, 0).events.map((e) => e.midi)
    const bass = basslineEvents(p, 8, major, 0).events.map((e) => e.midi)
    expect(Math.max(...bass)).toBeLessThan(Math.min(...pad))
  })

  it('pairs every note-on with a note-off, and stays inside the lap', () => {
    const { events, len } = basslineEvents(CHORD_PATTERNS[0], 8, major, 0)
    expect(events.filter((e) => e.on)).toHaveLength(events.filter((e) => !e.on).length)
    expect(Math.max(...events.map((e) => e.t))).toBeLessThan(len)
  })

  it('gives nothing for a loop with no length or a scale with no degrees', () => {
    expect(basslineEvents(CHORD_PATTERNS[0], 0, major, 0).events).toEqual([])
    expect(basslineEvents(CHORD_PATTERNS[0], 8, [], 0).events).toEqual([])
  })
})

/**
 * The keyboard's hint: which notes belong to the chord playing right now.
 *
 * ⚠️ EVERY EXPECTATION IS A STATEMENT ABOUT MUSIC, not a re-run of the code. "Four chords in C
 * major starts on C major, so the lit keys are C, E and G" is a claim somebody can argue with;
 * `expect(chordToneClasses(...)).toEqual(chordToneClasses(...))` is not a test. Where a sweep is
 * used it asserts a PROPERTY — the hint agrees with the pad — rather than a value.
 */

describe('the chord that leans back to the top', () => {
  const by = (id: string) => CHORD_PATTERNS.find((p) => p.id === id)!
  const SEVEN = MAJOR_DEGREES.length

  /**
   * ⚠️ THE WHOLE RULE IN ONE TABLE, written in roman numerals because that is the form the
   * decision was made in. A turnaround pulls toward the chord that comes NEXT, and the chord
   * that comes next is the progression's first one — which is not always the tonic.
   */
  it('is a fifth above whatever the progression returns to', () => {
    expect(leadBackStep(by('four'), SEVEN), 'I V vi IV returns to I, so V').toBe(5)
    expect(leadBackStep(by('simple'), SEVEN), 'I IV V IV returns to I, so V').toBe(5)
    expect(leadBackStep(by('sad'), SEVEN), 'vi IV I V returns to vi, so iii').toBe(3)
    expect(leadBackStep(by('turnaround'), SEVEN), 'ii V I I returns to ii, so vi').toBe(6)
  })

  /**
   * ⚠️ NULL IS A REAL ANSWER. Fifties ends on its own dominant already — it IS a turnaround,
   * which is what doo-wop is — so a second V would repeat the chord rather than lead anywhere.
   */
  it('is nothing when the progression already ends there', () => {
    expect(leadBackStep(by('fifties'), SEVEN), 'I vi IV V already ends on V').toBeNull()
  })

  it('stays inside the scale, whatever size it is', () => {
    /* four STEPS up, not seven semitones — a chord from outside the scale is the one thing
       scale lock exists to prevent */
    for (const [, , degrees] of SCALES) {
      for (const p of CHORD_PATTERNS) {
        const lead = leadBackStep(p, degrees.length)
        if (lead === null) continue
        expect(lead, `${p.id} in a ${degrees.length}-note scale`).toBeGreaterThanOrEqual(1)
        expect(lead, `${p.id} in a ${degrees.length}-note scale`).toBeLessThanOrEqual(
          degrees.length,
        )
      }
    }
  })

  it('answers nothing rather than throwing on a scale with no notes', () => {
    expect(leadBackStep(by('four'), 0)).toBeNull()
  })
})

describe('a progression with the lead-back on', () => {
  const four = CHORD_PATTERNS.find((p) => p.id === 'four')!
  const fifties = CHORD_PATTERNS.find((p) => p.id === 'fifties')!

  const chordsAt = (events: LoopEvent[]) => {
    const byTime = new Map<number, number[]>()
    for (const e of events) {
      if (!e.on) continue
      const k = Math.round(e.t * 1000)
      byTime.set(k, [...(byTime.get(k) ?? []), ((e.midi % 12) + 12) % 12])
    }
    return [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, pcs]) => ({ t, pcs: [...new Set(pcs)].sort((x, y) => x - y) }))
  }

  it('adds a fifth chord in the second half of the last slot', () => {
    const plain = chordsAt(progressionEvents(four, 8, MAJOR_DEGREES, 0).events)
    const led = chordsAt(progressionEvents(four, 8, MAJOR_DEGREES, 0, true).events)
    expect(plain).toHaveLength(4)
    expect(led, 'the lead-back is a fifth chord, not a replacement').toHaveLength(5)
    /* the first three are untouched, and the fourth still starts where it did */
    expect(led.slice(0, 4).map((c) => c.t)).toEqual(plain.map((c) => c.t))
    expect(led[4].t, 'halfway through the last slot of an 8s lap over four chords').toBe(7000)
    /* C G Am F then G — in C major, G is G B D */
    expect(led[4].pcs).toEqual([2, 7, 11])
  })

  it('does not run past the end of the lap', () => {
    const { events, len } = progressionEvents(four, 8, MAJOR_DEGREES, 0, true)
    for (const e of events)
      expect(e.t, `an event at ${e.t} in a ${len}s lap`).toBeLessThanOrEqual(len)
  })

  it('changes nothing for a progression that already ends on its lead-back', () => {
    const plain = progressionEvents(fifties, 8, MAJOR_DEGREES, 0).events
    const led = progressionEvents(fifties, 8, MAJOR_DEGREES, 0, true).events
    expect(led, 'Fifties already ends on V — there is nothing to add').toEqual(plain)
  })

  it('is off unless asked, so nothing anybody already has changes', () => {
    for (const p of CHORD_PATTERNS) {
      expect(progressionEvents(p, 8, MAJOR_DEGREES, 0).events, `${p.id} with no argument`).toEqual(
        progressionEvents(p, 8, MAJOR_DEGREES, 0, false).events,
      )
    }
  })

  /**
   * ⚠️ THE PROPERTY THAT MATTERS, and the reason `slotsOf` is shared. The bass splitting the
   * last slot differently from the pad would change chord half a beat away from it — the same
   * disagreement `triadOf` prevents, in a smaller window and harder to hear a cause for.
   */
  it('and the bass turns around at the same instant, in every key and scale', () => {
    for (const [, , degrees] of SCALES) {
      if (degrees.length !== 7) continue
      for (let root = 0; root < 12; root++) {
        for (const p of CHORD_PATTERNS) {
          const pad = chordsAt(progressionEvents(p, 8, degrees, root, true).events)
          const bass = chordsAt(basslineEvents(p, 8, degrees, root, true).events)
          /* the bass plays twice a chord, so its starts are a superset of the pad's */
          const padStarts = pad.map((c) => c.t)
          const bassStarts = new Set(bass.map((c) => c.t))
          for (const t of padStarts) {
            expect(bassStarts.has(t), `${p.id} root ${root}: no bass note at ${t}`).toBe(true)
          }
        }
      }
    }
  })
})

describe('reading the turnaround back off a take', () => {
  const four = CHORD_PATTERNS.find((p) => p.id === 'four')!
  const fifties = CHORD_PATTERNS.find((p) => p.id === 'fifties')!

  it('sees one that is there', () => {
    const { events } = progressionEvents(four, 8, MAJOR_DEGREES, 0, true)
    expect(leadsBack(events, four)).toBe(true)
  })

  it('and does not invent one that is not', () => {
    const { events } = progressionEvents(four, 8, MAJOR_DEGREES, 0)
    expect(leadsBack(events, four)).toBe(false)
  })

  it('says no for a progression that cannot have one', () => {
    /* Fifties already ends on its lead-back, so asking for one changes nothing and there is
       nothing to read back — the control is disabled for exactly this reason */
    const { events } = progressionEvents(fifties, 8, MAJOR_DEGREES, 0, true)
    expect(leadsBack(events, fifties)).toBe(false)
  })

  /**
   * ⚠️ IN EVERY KEY AND SCALE, because this is what a CONTROL will show and a control that is
   * right in C and wrong in F# is worse than one that is always wrong — nobody would look.
   */
  it('agrees with what was asked for, whatever the key', () => {
    for (const [, , degrees] of SCALES) {
      if (degrees.length !== 7) continue
      for (let root = 0; root < 12; root++) {
        for (const p of CHORD_PATTERNS) {
          const asked = leadBackStep(p, degrees.length) !== null
          const built = progressionEvents(p, 8, degrees, root, true).events
          expect(leadsBack(built, p), `${p.id} root ${root}`).toBe(asked)
          expect(leadsBack(progressionEvents(p, 8, degrees, root).events, p)).toBe(false)
        }
      }
    }
  })

  it('answers nothing for a pattern with no degrees', () => {
    expect(leadsBack([], { id: 'x', name: 'x', degrees: [], hint: '' })).toBe(false)
  })
})
