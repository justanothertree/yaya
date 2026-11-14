import { describe, expect, it } from 'vitest'
import { splitLyrics } from './lyrics'
import { evenly, feelOf, fitSyllables, makeRoom, melodyOf, snapToGrid, strength } from './pocket'

/**
 * Lyrics in the pocket. Every expectation is about the song's shape — which beat a word lands on,
 * whether a word is broken by a breath, how long the voice sits on one vowel — never about the
 * scorer's weights, which are choices.
 */

const BEAT = 0.5 // 120 bpm
const SIXTEENTHS = evenly(BEAT, 4)
const n = (t: number, dur = 0.2, midi = 60) => ({ t, dur, midi })
/** the beat number a time falls on, or null if it falls between beats */
const onBeat = (t: number) =>
  Math.abs(t / BEAT - Math.round(t / BEAT)) < 1e-6 ? Math.round(t / BEAT) : null
const words = (lyric: string, notes: ReturnType<typeof n>[]) =>
  fitSyllables(notes, splitLyrics(lyric), { beat: BEAT })
/** the longest run of notes that only carry a vowel on */
const longestHold = (sung: { hold: boolean }[]) => {
  let run = 0
  let most = 0
  for (const s of sung) {
    run = s.hold ? run + 1 : 0
    most = Math.max(most, run)
  }
  return most
}

describe('one voice, on the grid', () => {
  it('a chord sings its top note, so its syllables do not all start at once', () => {
    const chords = [0, 1, 2, 3].flatMap((bar) => [60, 64, 67].map((m) => n(bar * 2, 1.8, m + bar)))
    const { sung } = words('one two three four', chords)
    expect(sung.map((s) => s.text)).toEqual(['one', 'two', 'three', 'four'])
    expect(new Set(sung.map((s) => s.t)).size).toBe(4)
    expect(sung.map((s) => s.midi)).toEqual([67, 68, 69, 70])
    /* a slightly spread chord (a strum) is still one chord */
    expect(melodyOf([n(0, 1, 60), n(0.012, 1, 64), n(0.024, 1, 67)])).toHaveLength(1)
  })

  it('a note played a little early or late lands on the sixteenth it was meant for', () => {
    const played = [n(0.02), n(0.47), n(1.03), n(1.26)]
    expect(snapToGrid(played, [SIXTEENTHS]).map((x) => x.t)).toEqual([0, 0.5, 1, 1.25])
  })

  it('two notes that round to the same sixteenth stay two notes', () => {
    const t = snapToGrid([n(0.49, 0.05), n(0.53, 0.2)], [SIXTEENTHS]).map((x) => x.t)
    expect(t).toEqual([0.5, 0.625])
  })

  it('a note never runs over the start of the next one', () => {
    const [a, b] = snapToGrid([n(0, 0.9), n(0.5, 0.4)], [SIXTEENTHS])
    expect(a.t + a.dur).toBeLessThanOrEqual(b.t)
  })

  it('the downbeat is the strongest moment, then the middle of the bar, a beat, an eighth', () => {
    const s = [0, 2, 1, 0.5, 0.25].map((beats) => strength(beats * BEAT, BEAT))
    expect([...s].sort((a, b) => b - a)).toEqual(s)
    expect(new Set(s).size).toBe(5)
    /* the second bar's downbeat is as strong as the first's */
    expect(strength(4 * BEAT, BEAT)).toBe(strength(0, BEAT))
  })
})

describe("the room's Snap, in the line's own feel", () => {
  /** where each note of a line lands, in beats, on the room's Snap, in a loop of whole bars */
  const lands = (beats: number[], snap?: number, late = 0) => {
    const line = beats.map((b) => n(b * BEAT + late, 0.1))
    const f = feelOf(line, BEAT, snap)
    const bars = Math.ceil((Math.max(...beats) + 0.01) / 4)
    return snapToGrid(line, f.levels, f.lean, bars * 4 * BEAT).map((x) => x.t / BEAT)
  }
  /** a fixed wobble of up to ±10ms, the same every run: somebody playing, not a sequencer */
  const loose = (beats: number[]) => beats.map((b, i) => b + ((((i * 7) % 5) - 2) * 0.005) / BEAT)
  /** a swung line: every beat, and the off-beat after it `by` of an eighth late */
  const swingEighths = (by: number) =>
    Array.from({ length: 8 }, (_, b) => [b, b + 0.5 + by / 2]).flat()
  const near = (got: number[], want: number[], within: number) =>
    got.every((g, i) => Math.abs(g - want[i]) <= within)

  it('Snap 1/8 puts a sixteenth on the eighth; 1/16 and Off keep it on its sixteenth', () => {
    const line = [0, 0.27, 1, 2, 3]
    expect(lands(line, 8)).toEqual([0, 0.5, 1, 2, 3])
    expect(lands(line, 16)).toEqual([0, 0.25, 1, 2, 3])
    expect(lands(line, 0)).toEqual([0, 0.25, 1, 2, 3])
    /* and it reaches the singer */
    const sung = (snap?: number) =>
      fitSyllables(
        line.map((b) => n(b * BEAT, 0.1)),
        splitLyrics('one two three four five'),
        { beat: BEAT, snap },
      ).sung.map((s) => s.t / BEAT)
    expect(sung(8)[1]).toBe(0.5)
    expect(sung()[1]).toBe(0.25)
  })

  it('on Snap 1/4 a line of eighths keeps its eighths instead of marching later', () => {
    const eighths = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    /* it used to give 0, 1, 2, … 7: every note a beat later than the last, off the end of the bar */
    expect(lands(eighths, 4)).toEqual(eighths)
    /* while an off-beat with its beat free does move onto it, and a loose beat lands on the beat */
    expect(lands([0, 1.5, 3], 4)).toEqual([0, 2, 3])
    expect(lands(loose([0, 1, 2, 3]), 4)).toEqual([0, 1, 2, 3])
  })

  it("nothing lands on the loop's end, which is the next pass's downbeat", () => {
    /* the last eighth rounded onto beat 4 on Snap 1/4, and a late last note did on any Snap */
    expect(lands([0, 1, 2, 3, 3.5], 4)).toEqual([0, 1, 2, 3, 3.5])
    expect(lands([0, 1, 2, 3.95], 0)).toEqual([0, 1, 2, 3.75])
    /* two notes crowded into the very end: the one with no point left is not sung */
    expect(lands([0, 1, 2, 3.7, 3.9], 0)).toEqual([0, 1, 2, 3.75])
  })

  it("a swung line keeps its swing: the arpeggio's full swing, a lighter one and a heavier", () => {
    for (const by of [1 / 3, 0.2, 0.4])
      for (const snap of [0, 8, 4]) {
        const meant = swingEighths(by)
        /* played by a person, and placed exactly, as the arpeggio records it */
        for (const played of [loose(meant), meant]) {
          const got = lands(played, snap)
          expect(near(got, meant, 0.025)).toBe(true)
          /* not straightened: the off-beats are nowhere near the straight eighth */
          for (let i = 1; i < got.length; i += 2) expect(got[i] % 1).toBeGreaterThan(0.55)
        }
      }
  })

  it('triplets stay triplets, even on Snap 1/4 when their beats are taken', () => {
    const meant = Array.from({ length: 8 }, (_, b) => [b, b + 1 / 3, b + 2 / 3]).flat()
    for (const snap of [0, 8, 4]) expect(near(lands(loose(meant), snap), meant, 1e-9)).toBe(true)
  })

  it('a loose straight line stays straight, and a steady lean is taken out', () => {
    const eighths = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    const line = loose(eighths).map((b) => n(b * BEAT + 0.015, 0.1))
    expect(feelOf(line, BEAT).kind).toBe('straight')
    /* fifteen milliseconds behind throughout, and every note still lands exactly on its eighth */
    expect(lands(loose(eighths), 0, 0.015)).toEqual(eighths)
    /* a swing played late is still read as a swing: the lean used to hide it */
    expect(near(lands(swingEighths(0.4), 0, 0.015), swingEighths(0.4), 0.02)).toBe(true)
  })

  it('a long note on a swung off-beat is shared on the beat, not a half-beat after its start', () => {
    const line = [
      n(0, 0.6 * BEAT),
      n((2 / 3) * BEAT, (4 / 3) * BEAT),
      n(2 * BEAT, 0.6 * BEAT),
      n((8 / 3) * BEAT, 0.3 * BEAT),
    ]
    const { sung, spare } = fitSyllables(line, splitLyrics('glit-ter in the dark'), { beat: BEAT })
    expect(spare).toBe(0)
    /* "in" takes the second half of the long note, from beat 1 — it was cut at 1⅙ */
    expect(sung.map((s) => s.text)).toEqual(['glit', 'ter', 'in', 'the', 'dark'])
    expect(onBeat(sung[2].t)).toBe(1)
  })

  it('swept over tempo, looseness and lean: straight lines stay put, and feels are kept', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const straight = [
      [0, 0.75, 1.5, 2, 2.5, 2.75, 3.5, 4, 4.75, 5.5, 6, 6.5, 6.75, 7.5],
      [0, 0.5, 1, 1.25, 1.5, 2, 3, 3.5, 3.75, 4, 5, 5.5, 6, 6.25, 7],
      [0, 1, 2, 3, 4, 5, 6, 7],
    ]
    const feels = [
      Array.from({ length: 8 }, (_, b) => [b, b + 1 / 3, b + 2 / 3]).flat(),
      ...[0.2, 0.25, 1 / 3, 0.4].map(swingEighths),
      ...[0.25, 1 / 3, 0.4].map((by) =>
        Array.from({ length: 8 }, (_, b) => [
          b,
          b + 0.25 + by / 4,
          b + 0.5,
          b + 0.75 + by / 4,
        ]).flat(),
      ),
    ]
    const missed = (meant: number[], jitter: number, late: number, bpm: number, fixed?: true) => {
      const beat = 60 / bpm
      const line = meant.map((b) => n(b * beat + late + (rnd() * 2 - 1) * jitter, 0.1))
      const f = feelOf(line, beat)
      const got = fixed ? snapToGrid(line, [evenly(beat, 4)]) : snapToGrid(line, f.levels, f.lean)
      return got.filter((x, i) => Math.abs(x.t / beat - meant[i]) > 0.03).length
    }
    let straightMissed = 0
    let feelMissed = 0
    let feelBefore = 0
    let feelNotes = 0
    for (const bpm of [70, 100, 130, 160])
      for (const late of [0, 0.015]) {
        for (const jitter of [0, 0.01, 0.02])
          for (const m of straight) straightMissed += missed(m, jitter, late, bpm)
        for (const jitter of [0, 0.01])
          for (const m of feels) {
            feelMissed += missed(m, jitter, late, bpm)
            feelBefore += missed(m, jitter, late, bpm, true)
            feelNotes += m.length
          }
      }
    /* up to ±20ms loose and 15ms late, no straight note leaves its sixteenth */
    expect(straightMissed).toBe(0)
    /* the old sixteenths moved a third of these notes or more; that is what makes this a test */
    expect(feelBefore / feelNotes).toBeGreaterThan(0.3)
    expect(feelMissed / feelNotes).toBeLessThan(0.02)
  })
})

describe('more syllables than notes: a long note is shared', () => {
  it('"glit-ter" on one half note sings two quarter notes, the second on the beat', () => {
    const { sung, spare } = words('glit-ter', [n(0, 2 * BEAT, 64)])
    expect(spare).toBe(0)
    expect(sung.map((s) => s.text)).toEqual(['glit', 'ter'])
    expect(sung.map((s) => onBeat(s.t))).toEqual([0, 1])
    expect(sung.every((s) => s.midi === 64)).toBe(true)
    expect(sung[0].dur + sung[1].dur).toBeCloseTo(2 * BEAT, 9)
  })

  it('a note shorter than a beat is never cut, so what is left over is counted', () => {
    expect(makeRoom([n(0, BEAT / 2), n(BEAT / 2, BEAT / 2)], 3, BEAT)).toHaveLength(2)
    const { sung, spare } = words('one two three', [n(0, BEAT / 2), n(BEAT / 2, BEAT / 2)])
    expect(sung).toHaveLength(2)
    expect(spare).toBe(1)
  })
})

describe('more notes than syllables: the words are spread', () => {
  /* two bars of eighths, 16 notes, against seven syllables — the shape of the sample line on a
     busy bass part, where every syllable used to take the next note and nine holds trailed it */
  const eighths = Array.from({ length: 16 }, (_, i) =>
    n((i * BEAT) / 2, BEAT / 2 - 0.02, 48 + (i % 5)),
  )
  const { sung } = words('glit-ter in the dark to-night', eighths)
  const start = (text: string) => sung.find((s) => s.text === text && !s.hold)!

  it('every syllable is sung, in order, each on a note of its own', () => {
    expect(sung.filter((s) => !s.hold).map((s) => s.text)).toEqual([
      'glit',
      'ter',
      'in',
      'the',
      'dark',
      'to',
      'night',
    ])
    expect(sung).toHaveLength(16)
  })

  it('the stressed syllables land on beats', () => {
    for (const w of ['glit', 'dark', 'night']) expect(onBeat(start(w).t)).not.toBeNull()
  })

  it('a light word is never on a downbeat', () => {
    for (const w of ['in', 'the', 'to']) expect(strength(start(w).t, BEAT)).toBeLessThan(1)
  })

  it('the line reaches the second bar instead of holding one vowel for half the loop', () => {
    expect(start('night').t).toBeGreaterThanOrEqual(4 * BEAT)
    expect(longestHold(sung)).toBeLessThanOrEqual(3)
  })

  it('two words share sixteen notes instead of one of them taking fourteen', () => {
    const { sung: two } = words('hold on', eighths)
    expect(longestHold(two)).toBeLessThanOrEqual(8)
  })

  it('a light word between two strong ones sits off the downbeat: the NIGHT is YOUNG', () => {
    const quarters = Array.from({ length: 8 }, (_, i) => n(i * BEAT, BEAT * 0.8))
    const { sung: line } = words('the night is young', quarters)
    const is = line.find((s) => s.text === 'is' && !s.hold)!
    expect(strength(is.t, BEAT)).toBeLessThan(0.8)
  })
})

describe('a syncopated, staccato part: the slap bass of the Funk starter', () => {
  /* its note starts in beats and its lengths, read from the room: short notes, mostly off the beat */
  const starts = [0, 0.75, 1.5, 2, 2.5, 2.75, 3.5, 4, 4.75, 5.5, 6, 6.5, 6.75, 7.5]
  const lengths = [
    0.48, 0.24, 0.24, 0.48, 0.24, 0.24, 0.24, 0.48, 0.24, 0.24, 0.48, 0.24, 0.24, 0.24,
  ]
  const slap = starts.map((b, i) => n(b * BEAT, lengths[i] * BEAT, 40))
  const { sung } = words('glit-ter in the dark _ to-night', slap)
  const at = (text: string) => sung.find((s) => s.text === text && !s.hold)!.t

  it('its short gaps are not breaths: the stressed words still find the beats', () => {
    for (const w of ['glit', 'dark', 'night']) expect(onBeat(at(w))).not.toBeNull()
    expect(strength(at('dark'), BEAT)).toBe(1)
  })
})

describe('rests and typed holds', () => {
  const quarters = (beats: number[]) => beats.map((b) => n(b * BEAT, BEAT * 0.8))
  const startOf = (sung: { t: number; text: string; hold: boolean }[], text: string) =>
    onBeat(sung.find((s) => s.text === text && !s.hold)!.t)!

  it('a word is not broken by a breath: "to-night" comes after the rest, both halves', () => {
    /* four notes, a beat of rest, three notes */
    const { sung } = words('glit-ter to-night', quarters([0, 1, 2, 3, 5, 6, 7]))
    expect(startOf(sung, 'ter')).toBeLessThan(4)
    expect(startOf(sung, 'to')).toBeGreaterThan(4)
    expect(startOf(sung, 'night')).toBeGreaterThan(4)
  })

  it('after a rest the voice comes back with a word, not a held vowel', () => {
    /* three notes, then more than a beat of silence, then three notes from the off-beat */
    const { sung } = words('sha-dows fall', quarters([0, 1, 2, 4.5, 5, 6]))
    /* the first note after the rest */
    const back = sung.find((s) => s.t > 2 * BEAT)!
    expect(back.hold).toBe(false)
    expect(back.text).toBe('fall')
  })

  it('typed holds are kept where they were typed when every note is spoken for', () => {
    const { sung } = words(
      'dark _ _ night',
      [0, 1, 2, 3].map((b) => n(b * BEAT)),
    )
    expect(sung.map((s) => `${s.text}${s.hold ? '~' : ''}`)).toEqual([
      'dark',
      'dark~',
      'dark~',
      'night',
    ])
  })
})

describe('what the stress guess says about words', () => {
  it('most words lean on their first syllable, a short prefix moves it to the second', () => {
    const stress = (w: string) => splitLyrics(w).map((s) => s.stress)
    expect(stress('glit-ter')[0]).toBeGreaterThan(stress('glit-ter')[1])
    expect(stress('to-night')[1]).toBeGreaterThan(stress('to-night')[0])
    expect(stress('a-way')[1]).toBeGreaterThan(stress('a-way')[0])
    expect(stress('the')[0]).toBeLessThan(stress('dark')[0])
  })
})
