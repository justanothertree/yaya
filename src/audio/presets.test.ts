import { describe, expect, it } from 'vitest'
import { FAMILIES } from './families'
import {
  BASS_VOICES,
  INSTRUMENTS,
  SHAPES,
  driveCurve,
  filterSweeps,
  type InstrumentId,
} from './synth'
import { packSong, readSong } from './songFile'

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

/**
 * ⚠️ `level`, NOT `level x Σgains` — AND THIS FILE SHIPPED WITH THE WRONG ONE.
 *
 * `noteOn` normalises the partials (`const share = part.gain / partialSum`) and then says
 * `const peak = sh.level` in as many words, so a partial's `gain` is its share of the TIMBRE
 * and has nothing to do with loudness: adding a fifth partial changes what a patch sounds like,
 * not how loud it is. `scripts/synth-levels.py` had been multiplying by that sum since before
 * the normalisation was added to stop pads clipping, and I copied the formula out of it without
 * reading the code it claimed to describe.
 */
const peakOf = (sh: Shape) => sh.level
const heldOf = (sh: Shape) => sh.level * sh.s
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

describe('how loud a preset asks to be', () => {
  /**
   * ⚠️ THIS BLOCK SHIPPED ONCE WITH THE WRONG FORMULA AND THE WRONG MORAL, both corrected here.
   *
   * It computed peak as `level × Σgains`, copied out of `scripts/synth-levels.py` without
   * reading the code the script claims to describe. `noteOn` NORMALISES the partials —
   * `const share = part.gain / partialSum` — and then says `const peak = sh.level` in as many
   * words. So a partial's gain is its share of the TIMBRE: adding a fifth partial changes what
   * a patch sounds like, not how loud it is. The script had been multiplying by a number the
   * audio code divides out, ever since the normalisation was added to stop pads clipping.
   *
   * The first version of this file concluded from that bad formula that no band could be
   * asserted at all, and offered the accordion as proof — "modelled 1.074, the loudest row in
   * the table, yet correct by ear". With the real formula the accordion is 0.44 and sits
   * unremarkably among the others. The evidence for the conclusion was an artefact of the
   * mistake.
   *
   * ⚠️ WHAT REMAINS TRUE is that `level` is not loudness either. Measured the same day through
   * an analyser on the synth's own tap, one note held three seconds:
   *
   *       preset     level   measured   ratio
   *       reed        0.42      0.349    0.83
   *       keys        0.50      0.297    0.59
   *       organ       0.30      0.144    0.48
   *       strings     0.26      0.079    0.30
   *       drone       0.20      0.026    0.13
   *
   * `level` is where the envelope PEAKS, which a slow-attack patch behind a lowpass never
   * reaches in the shape an ear integrates. So the band below is a sanity check on what a
   * preset ASKS for — enough to catch a voice added at double everybody else's — and is not a
   * promise about what you hear. Re-levelling the table against measurement would change every
   * saved song and loop, which is Evan's call and is written down rather than guessed.
   */

  it('asks for a level in the range the others occupy', () => {
    /* measured across the table when this was written: 0.20 to 0.62. A little wider, so tuning
       an existing voice is free and adding an outlier is not. */
    for (const [id, sh] of named) {
      expect(sh.level, `${id} level`).toBeGreaterThanOrEqual(0.15)
      expect(sh.level, `${id} level`).toBeLessThanOrEqual(0.75)
    }
  })

  it('keeps the quietest and loudest request within 4x', () => {
    /* stated as a ratio so it still means something if the whole table is raised or lowered
       together — which an absolute band alone would quietly allow to drift */
    const peaks = named.map(([, sh]) => peakOf(sh))
    expect(Math.max(...peaks) / Math.min(...peaks)).toBeLessThanOrEqual(4)
  })

  it('never sustains louder than it peaks', () => {
    for (const [id, sh] of named) expect(heldOf(sh), id).toBeLessThanOrEqual(peakOf(sh) + 1e-9)
  })

  it('gives every voice a level that could make a sound at all', () => {
    for (const [id, sh] of named) {
      expect(sh.level, `${id} is silent`).toBeGreaterThan(0)
      expect(
        sh.partials.reduce((t, x) => t + x.gain, 0),
        `${id} has no gain`,
      ).toBeGreaterThan(0)
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

/**
 * Evan, 10 Nov 2026: "several distinct bass voices (e.g. sub, finger, slap, synth, 808) plus a few
 * genuinely different new instruments, usable from the keyboard, backing and jam".
 *
 * ⚠️ "DISTINCT" IS ASKED OF WHAT SHAPES A SOUND, NOT OF THE NUMBERS BEING DIFFERENT. Two presets
 * whose every field differs by 1% are two copies of one sound. So each pair of basses must part
 * on something a listener hears: the waveform, how much of the note is held, how fast it dies,
 * how dark the filter closes, or a pitch that falls into place. Whether they sound like their
 * NAMES is a listening question and is Evan's; the room measurement is in the PR.
 */
const shape = (id: InstrumentId) => (SHAPES as Record<string, Shape>)[id]
const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(1e-6, Math.min(a, b))
/** what a listener could hear differ between two voices — see the note on 'the basses' */
const parts = (a: Shape, b: Shape) => {
  const why: string[] = []
  if (a.wave !== b.wave) why.push('wave')
  if (Math.abs(a.s - b.s) >= 0.15) why.push('held')
  if (ratio(a.d, b.d) >= 1.5) why.push('decay')
  if (ratio(a.filter?.to ?? 20000, b.filter?.to ?? 20000) >= 1.5) why.push('filter')
  if (!!a.pitch !== !!b.pitch) why.push('pitch')
  if (a.partials.length !== b.partials.length) why.push('partials')
  /* clean against driven is the first thing anybody hears about a guitar or a bass */
  if (!!a.drive !== !!b.drive) why.push('drive')
  return why
}

describe('the basses', () => {
  it('offers at least six, every one on the picker with a preset', () => {
    expect(BASS_VOICES.length).toBeGreaterThanOrEqual(6)
    const offered = new Set(INSTRUMENTS.map(([id]) => id))
    for (const id of BASS_VOICES) {
      expect(offered.has(id), id).toBe(true)
      expect(shape(id), id).toBeDefined()
    }
    for (const want of ['finger', 'slap', 'synthbass', '808', 'sub'] as const)
      expect(BASS_VOICES).toContain(want)
  })

  it('no two of them are built the same way', () => {
    const alike: string[] = []
    for (let i = 0; i < BASS_VOICES.length; i++)
      for (let j = i + 1; j < BASS_VOICES.length; j++) {
        const a = BASS_VOICES[i]
        const b = BASS_VOICES[j]
        /* two or more audible differences, so one tweak cannot make a copy pass */
        if (parts(shape(a), shape(b)).length < 2) alike.push(`${a} ~ ${b}`)
      }
    expect(alike).toEqual([])
  })

  it('and every one is a bass: its fundamental leads, and nothing sits far above it', () => {
    for (const id of BASS_VOICES) {
      const sh = shape(id)
      const loudest = Math.max(...sh.partials.map((p) => p.gain))
      const fundamental = sh.partials.filter((p) => p.ratio <= 1).map((p) => p.gain)
      expect(Math.max(...fundamental), `${id} is led by an overtone`).toBe(loudest)
      expect(Math.max(...sh.partials.map((p) => p.ratio)), id).toBeLessThanOrEqual(5)
    }
  })

  /**
   * ⚠️ A PHONE SPEAKER CANNOT PLAY 41HZ. A bass made of the fundamental alone is silence on the
   * device most people will hear it on — which is why the 808 carries a whisper of second and
   * third. Every bass must have SOME energy at the octave or above.
   */
  it('and every one can be heard on a phone, with something above the fundamental', () => {
    for (const id of BASS_VOICES) {
      const sh = shape(id)
      const rich = sh.wave !== 'sine' || sh.partials.some((p) => p.ratio >= 2)
      expect(rich, `${id} is a bare sine — inaudible on a phone speaker`).toBe(true)
    }
  })
})

describe('the new voices travel', () => {
  const added: InstrumentId[] = [
    'finger',
    'slap',
    'upright',
    'synthbass',
    '808',
    'pick',
    'fretless',
    'acid',
    'supersaw',
    'chip',
    'harpsichord',
    'sitar',
  ]

  /* a song, and the jam (which sends a layer as a packed song), read an instrument they do not
     know as Keys — so a voice that is not on that list arrives as the wrong instrument */
  it('through a song file and the jam, as themselves', () => {
    for (const instrument of added) {
      const back = readSong(
        packSong({
          v: 1,
          name: 'x',
          bpm: 96,
          bars: 2,
          layers: [
            {
              instrument,
              muted: false,
              len: 5,
              events: [
                { t: 0, midi: 40, on: true },
                { t: 1, midi: 40, on: false },
              ],
              fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
            },
          ],
        }),
      )
      expect(back?.layers[0].instrument, instrument).toBe(instrument)
    }
  })
})

/**
 * ⚠️ A FILTER SWEEP IS THE SOUND OF SEVERAL OF THESE VOICES, and from 8 Sep to 10 Nov 2026 it was
 * switched off wherever the note's highest partial RATIO sat under the filter — which a saw's own
 * harmonics make untrue. Each case below is something a listener can name, at a pitch it is
 * actually played at.
 */
describe('a filter moves where the wave can hear it', () => {
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

  it('Slap snaps on the E a bass line plays, not only from A2 up', () => {
    expect(filterSweeps(SHAPES.slap, hz(40))).toBe(true)
    expect(filterSweeps(SHAPES.slap, hz(36))).toBe(true)
  })

  /* a filter that moves less than an octave is not a sweep anybody hears — Fuzz's barely moves,
     on purpose, and sitting still above its own buzz is the rule working, not failing */
  it('every saw or square bass whose filter falls an octave sweeps across a bass line', () => {
    const flat: string[] = []
    for (const id of BASS_VOICES) {
      const sh = SHAPES[id as Exclude<InstrumentId, 'drums'>]
      if (!sh.filter || (sh.wave !== 'sawtooth' && sh.wave !== 'square')) continue
      if (sh.filter.from / sh.filter.to < 2) continue
      for (let m = 36; m <= 59; m++) if (!filterSweeps(sh, hz(m))) flat.push(`${id}@${m}`)
    }
    expect(flat).toEqual([])
  })

  it('Brass swells into middle C and the C above, which is the brass', () => {
    expect(filterSweeps(SHAPES.brass, hz(60))).toBe(true)
    expect(filterSweeps(SHAPES.brass, hz(72))).toBe(true)
  })

  it('near-sines keep the crackle fix as it was measured: whistle at C5, Keys at middle C', () => {
    expect(filterSweeps(SHAPES.whistle, hz(72))).toBe(false)
    expect(filterSweeps(SHAPES.keys, hz(60))).toBe(false)
  })
})

/**
 * Evan, 10 Nov 2026, from the loop: "more bass voices". Spot checks on what makes each of the three
 * added that day itself, so a later tidy-up cannot flatten one into a neighbour — the pairwise
 * "no two built the same way" test above is what keeps them apart from each other.
 */
describe('Pick, Fretless and Acid', () => {
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

  it('Pick is struck harder and brighter than Finger: a saw, not a triangle, opening wider', () => {
    expect(SHAPES.pick.wave).toBe('sawtooth')
    expect(SHAPES.finger.wave).toBe('triangle')
    expect(SHAPES.pick.filter!.from).toBeGreaterThan(SHAPES.finger.filter!.from)
  })

  it('Fretless slides UP into its note, where Slap and the 808 fall into theirs', () => {
    expect(SHAPES.fretless.pitch!.mult).toBeLessThan(1)
    expect(SHAPES.slap.pitch!.mult).toBeGreaterThan(1)
    expect(SHAPES['808'].pitch!.mult).toBeGreaterThan(1)
  })

  it('Acid is one saw through a resonant filter that snaps shut on every note it plays', () => {
    expect(SHAPES.acid.partials).toHaveLength(1)
    expect(SHAPES.acid.filter!.q).toBeGreaterThanOrEqual(10)
    expect(SHAPES.acid.filter!.from / SHAPES.acid.filter!.to).toBeGreaterThan(8)
    for (let m = 36; m <= 59; m++) expect(filterSweeps(SHAPES.acid, hz(m)), `${m}`).toBe(true)
  })
})

/**
 * Evan, 10 Nov 2026: "more instruments". The Strings family had a harp, a koto, a sitar and a
 * banjo and no guitar — the instrument most people would look for there first.
 */
describe('the electric guitar', () => {
  const plucked = ['harp', 'koto', 'banjo', 'pluck'] as const

  it('holds a part of its note, where every other plucked string dies to nothing', () => {
    for (const id of plucked) expect(SHAPES[id].s, id).toBe(0)
    expect(SHAPES.guitar.s).toBeGreaterThanOrEqual(0.15)
  })

  it('is built differently from everything else in the Strings family', () => {
    const family = FAMILIES.find((f) => f.id === 'strings')!.members
    expect(family).toContain('guitar')
    const alike = family
      .filter((id) => id !== 'guitar')
      .filter((id) => parts(shape('guitar'), shape(id as InstrumentId)).length < 2)
    expect(alike).toEqual([])
  })

  it('travels through a song file as itself', () => {
    const back = readSong(
      packSong({
        v: 1,
        name: 'x',
        bpm: 96,
        bars: 2,
        layers: [
          {
            instrument: 'guitar',
            muted: false,
            len: 5,
            events: [
              { t: 0, midi: 52, on: true },
              { t: 1, midi: 52, on: false },
            ],
            fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
          },
        ],
      }),
    )
    expect(back?.layers[0].instrument).toBe('guitar')
  })
})

/**
 * Evan, 10 Nov 2026: "more instruments". A soft clipper per voice is what makes a guitar sound
 * driven and a bass sound fuzzed — the synth had no distortion at all, so neither could exist.
 */
describe('drive', () => {
  /* the way a WaveShaperNode reads its curve: x in -1..1 lands between two points, interpolated */
  const at = (curve: Float32Array, x: number) => {
    const v = ((x + 1) / 2) * (curve.length - 1)
    const i = Math.min(curve.length - 2, Math.floor(v))
    return curve[i] + (curve[i + 1] - curve[i]) * (v - i)
  }

  it('keeps the edges where they are, so the envelope after it still decides the peak', () => {
    for (const d of [0.1, 0.5, 0.9]) {
      const c = driveCurve(d)
      expect(at(c, 1)).toBeCloseTo(1, 5)
      expect(at(c, -1)).toBeCloseTo(-1, 5)
      expect(at(c, 0)).toBeCloseTo(0, 2)
    }
  })

  it('is odd and never folds back: no lopsided wave, no note turned inside out', () => {
    const c = driveCurve(0.7)
    for (let i = 0; i < c.length; i++) expect(c[i]).toBeCloseTo(-c[c.length - 1 - i], 5)
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1])
  })

  it('pushes the quiet half of the wave up harder the more it is driven — that is the grit', () => {
    expect(at(driveCurve(0.2), 0.3)).toBeGreaterThan(0.3)
    expect(at(driveCurve(0.9), 0.3)).toBeGreaterThan(at(driveCurve(0.2), 0.3))
  })

  it('Overdrive and Fuzz are driven; the clean guitar and every other bass are not', () => {
    expect(SHAPES.overdrive.drive).toBeGreaterThan(0)
    expect(SHAPES.fuzz.drive).toBeGreaterThan(0)
    expect(SHAPES.guitar.drive).toBeUndefined()
    for (const id of BASS_VOICES) if (id !== 'fuzz') expect(shape(id).drive, id).toBeUndefined()
  })

  it('and both travel through a song file as themselves', () => {
    for (const instrument of ['overdrive', 'fuzz'] as const) {
      const back = readSong(
        packSong({
          v: 1,
          name: 'x',
          bpm: 96,
          bars: 2,
          layers: [
            {
              instrument,
              muted: false,
              len: 5,
              events: [
                { t: 0, midi: 40, on: true },
                { t: 1, midi: 40, on: false },
              ],
              fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
            },
          ],
        }),
      )
      expect(back?.layers[0].instrument, instrument).toBe(instrument)
    }
  })
})
