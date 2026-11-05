import { describe, expect, it } from 'vitest'
import { INSTRUMENTS, SHAPES } from './synth'

/**
 * The loudness doctrine, asked on every test run instead of remembered.
 *
 * `scripts/synth-levels.py` has carried this since September and its header explains it better
 * than this one can: `level` is PER PARTIAL and the partials sum, so a four-partial patch at
 * 0.30 is louder than a one-partial patch at 0.50. PEAK is `level × Σgains` — what the ear gets
 * at the top of the envelope — and HELD is that times the sustain fraction, which is what a note
 * in a LOOP settles to.
 *
 * ⚠️ THE TWO COLUMNS DISAGREED ONCE, AND THAT IS WHY THIS FILE EXISTS. Peaks were already inside
 * 2.5× and looked fine while held notes ran 0.052 to 0.636, so a whistle layer sat three times
 * under an organ one and the fader could not close the gap. Reported by a person, as "the layer
 * volume is almost not loud enough for some of the instruments".
 *
 * The script is still the right tool for LOOKING — it prints a table and sorts it. What it
 * cannot do is run. A rule that lives in a script somebody has to remember to invoke is a rule
 * nobody checks, which is the same sentence this repository has already written about
 * `sanitizeSettings`, `parseTrades` and the migration md5s. Adding a voice now has to get past
 * these whether or not anybody thinks to measure it.
 */

type Shape = (typeof SHAPES)[keyof typeof SHAPES]

const peakOf = (sh: Shape) => sh.level * sh.partials.reduce((t, p) => t + p.gain, 0)
const heldOf = (sh: Shape) => peakOf(sh) * sh.s
const named = Object.entries(SHAPES) as Array<[string, Shape]>

describe('every instrument on the picker can make a sound', () => {
  it('has a preset, with the drum kit as the one stated exception', () => {
    /**
     * ⚠️ `drums` IS NOT A PRESET AND MUST NOT BECOME ONE. `noteOn` branches on it before any of
     * this and hands the note to `hitDrum`, because a twelve-piece kit is twelve different
     * noises rather than one patch transposed. Naming it here is what stops somebody "fixing"
     * its absence from the table.
     */
    /* ⚠️ WIDENED ONLY FOR THE LOOKUP. `SHAPES` is typed `Record<Exclude<InstrumentId,
       'drums'>, Shape>`, so `SHAPES[someInstrumentId]` does not compile — the type already
       says drums has no preset, which is a pleasant confirmation and an inconvenience here. */
    const table = SHAPES as Record<string, Shape | undefined>
    for (const [id] of INSTRUMENTS) {
      if (id === 'drums') continue
      expect(table[id], id).toBeDefined()
    }
    expect('drums' in SHAPES).toBe(false)
  })

  it('has no preset that the picker cannot reach', () => {
    /* the other direction: a shape nobody can choose is dead weight shipped to every visitor */
    const offered = new Set(INSTRUMENTS.map(([id]) => id))
    for (const [id] of named)
      expect(offered, `${id} is in SHAPES but not on the picker`).toContain(id)
  })

  it('gives every instrument its own id, label and glyph', () => {
    /* two entries with the same glyph is a picker you cannot read; two with the same id is one
       of them being unreachable */
    expect(new Set(INSTRUMENTS.map(([id]) => id)).size).toBe(INSTRUMENTS.length)
    expect(new Set(INSTRUMENTS.map(([, , label]) => label)).size).toBe(INSTRUMENTS.length)
    expect(new Set(INSTRUMENTS.map(([, glyph]) => glyph)).size).toBe(INSTRUMENTS.length)
  })
})

describe('how loud', () => {
  /**
   * ⚠️ THERE IS NO BAND ASSERTED HERE, AND THAT IS THE POINT OF THIS BLOCK.
   *
   * This file was written to turn `scripts/synth-levels.py` into a gate — its PEAK column,
   * `level × Σgains`, is the number the repository's loudness doctrine has been built on since
   * September. Before shipping the gate I measured what the presets actually put out, with an
   * analyser on the synth's own tap, holding one note for three seconds and taking the maximum:
   *
   *       preset    modelled   measured   ratio
   *       Reed         0.550      0.349    0.63
   *       Keys         0.650      0.297    0.46
   *       Organ        0.636      0.144    0.23
   *       Strings      0.603      0.079    0.13
   *       Drone        0.590      0.026    0.04
   *
   * The model says those are within 1.3x of each other. They are THIRTEEN TIMES apart. The
   * traces had plateaued, so this is steady state and not a slow attack caught early.
   *
   * The reason is that `Σgains` assumes every partial adds in phase and nothing is removed:
   * detuned unison pairs beat rather than sum, a sawtooth stack through a lowpass loses most of
   * what the sum counted, and each preset's filter takes a different amount. The ratio tracks
   * exactly that — square and triangle voices with one fundamental are nearest the model, and
   * detuned sawtooth voices behind a filter are furthest.
   *
   * So the September rebalance evened out the MODEL, and the complaint it came from — "the
   * layer volume is almost not loud enough for some of the instruments" — is still true of the
   * sound. ⚠️ WRITTEN DOWN FOR EVAN RATHER THAN FIXED: re-levelling thirty presets against
   * measurement changes the sound of every song and loop anybody has saved, which is his call.
   *
   * Asserting the band would have been worse than asserting nothing, because it reads as
   * authority. The proof is in this very commit: the accordion is levelled to sit beside the
   * organ BY EAR (0.144 against 0.140, measured) and its modelled peak is 1.07, the highest in
   * the table — a voice that is right in the room and would have failed the gate.
   *
   * What is still worth asserting is what the arithmetic can actually answer.
   */

  it('never sustains louder than it peaks', () => {
    for (const [id, sh] of named) expect(heldOf(sh), id).toBeLessThanOrEqual(peakOf(sh) + 1e-9)
  })

  it('gives every voice a level that could make a sound at all', () => {
    /* the one loudness claim the model is sound for: a zero or negative level is silence, and
       no amount of phase cancellation explains that */
    for (const [id, sh] of named) {
      expect(sh.level, `${id} is silent`).toBeGreaterThan(0)
      expect(peakOf(sh), `${id} has no partial gain`).toBeGreaterThan(0)
    }
  })
})

describe('every preset is well formed', () => {
  it.each(named.map(([id, sh]) => [id, sh] as const))('%s', (id, sh) => {
    /* an envelope with a negative stage is a node that never starts or never stops */
    for (const stage of ['a', 'd', 'r'] as const)
      expect(sh[stage], `${id}.${stage}`).toBeGreaterThanOrEqual(0)
    expect(sh.s, `${id}.s`).toBeGreaterThanOrEqual(0)
    expect(sh.s, `${id}.s`).toBeLessThanOrEqual(1)
    expect(sh.level, `${id}.level`).toBeGreaterThan(0)
    expect(['sine', 'square', 'sawtooth', 'triangle']).toContain(sh.wave)

    expect(sh.partials.length, `${id} has no partials`).toBeGreaterThan(0)
    for (const p of sh.partials) {
      expect(p.ratio, `${id} ratio`).toBeGreaterThan(0)
      expect(p.gain, `${id} gain`).toBeGreaterThan(0)
      /* a detune past a semitone is not a detune, it is a different note */
      expect(Math.abs(p.detune), `${id} detune`).toBeLessThanOrEqual(100)
    }

    /**
     * ⚠️ A FUNDAMENTAL AT RATIO 1, which every preset in the table has. Without it the pitch
     * you hear is not the pitch you pressed — the ear infers a fundamental from the partials,
     * so a stack starting at 2 plays an octave high and a scale built on it is simply wrong.
     * `sub` leads with 0.5, an octave BELOW, and still carries the 1.
     */
    expect(
      sh.partials.map((p) => p.ratio),
      `${id} has no fundamental`,
    ).toContain(1)

    if (sh.filter) {
      expect(sh.filter.from, `${id} filter.from`).toBeGreaterThan(0)
      expect(sh.filter.to, `${id} filter.to`).toBeGreaterThan(0)
      expect(sh.filter.q, `${id} filter.q`).toBeGreaterThan(0)
    }
    if (sh.pitch) {
      expect(sh.pitch.mult, `${id} pitch.mult`).toBeGreaterThan(0)
      expect(sh.pitch.time, `${id} pitch.time`).toBeGreaterThan(0)
    }
  })
})

describe('the three voices added alongside this file', () => {
  /* spot checks on what makes each one itself, so a later tidy-up cannot quietly flatten them */

  it('gives the Rhodes an inharmonic tine', () => {
    /* the 4.2 is the whole sound — without it this is `keys` with a longer tail */
    const odd = SHAPES.rhodes.partials.filter((p) => !Number.isInteger(p.ratio))
    expect(odd.length).toBeGreaterThan(0)
  })

  it('keeps the accordion a sustaining instrument', () => {
    /**
     * ⚠️ ASSERTED BY NAME, BECAUSE THE GENERAL RULE CANNOT CATCH THIS. "A sustaining voice must
     * be audible in a loop" is only asked of voices with `s >= 0.5` — and when I dropped the
     * accordion's sustain to 0.15 to watch that rule go red, all forty tests stayed GREEN. The
     * perturbation had moved the voice out of the category that the check applies to, which is
     * the fixture-neutralisation trap wearing a threshold: the one dimension under test pinned
     * flat by the change being tested.
     *
     * Whether an accordion holds a note is a fact about accordions, not something to infer from
     * the number being checked. Bellows do not pluck.
     */
    expect(SHAPES.accordion.s).toBeGreaterThanOrEqual(0.8)
    expect(SHAPES.rhodes.s, 'a Rhodes rings on after the strike').toBeGreaterThan(0)
    expect(SHAPES.handpan.s, 'a struck pan decays to nothing').toBe(0)
  })

  it('gives the accordion two reeds rather than one', () => {
    /* a pair at ratio 1, detuned apart: the beat between them IS the instrument */
    const fundamentals = SHAPES.accordion.partials.filter((p) => p.ratio === 1)
    expect(fundamentals).toHaveLength(2)
    expect(Math.abs(fundamentals[0].detune - fundamentals[1].detune)).toBeGreaterThan(5)
  })

  it('keeps the handpan harmonic where the steel pan is not', () => {
    /**
     * The one difference that makes them different instruments. A steel pan is hammered to
     * ring at 2.4 and 3.7 — deliberately inharmonic, which is the clang. A handpan's overtones
     * are tuned to the octave and the fifth above it, which is why it sounds consonant with
     * itself.
     */
    const handpanUpper = SHAPES.handpan.partials.filter((p) => p.ratio > 1 && p.ratio < 5)
    for (const p of handpanUpper) expect(Number.isInteger(p.ratio), `handpan ${p.ratio}`).toBe(true)
    const panUpper = SHAPES.steelpan.partials.filter((p) => p.ratio > 1 && p.ratio < 5)
    expect(panUpper.some((p) => !Number.isInteger(p.ratio))).toBe(true)
  })
})
