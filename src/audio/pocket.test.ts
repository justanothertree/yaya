import { describe, expect, it } from 'vitest'
import { splitLyrics } from './lyrics'
import { fitSyllables, makeRoom, melodyOf, snapToGrid, strength } from './pocket'

/**
 * Lyrics in the pocket. Every expectation is about the song's shape — which beat a word lands on,
 * whether a word is broken by a breath, how long the voice sits on one vowel — never about the
 * scorer's weights, which are choices.
 */

const BEAT = 0.5 // 120 bpm
const SIXTEENTH = BEAT / 4
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
    expect(snapToGrid(played, SIXTEENTH).map((x) => x.t)).toEqual([0, 0.5, 1, 1.25])
  })

  it('two notes that round to the same sixteenth stay two notes', () => {
    const t = snapToGrid([n(0.49, 0.05), n(0.53, 0.2)], SIXTEENTH).map((x) => x.t)
    expect(t).toEqual([0.5, 0.625])
  })

  it('a note never runs over the start of the next one', () => {
    const [a, b] = snapToGrid([n(0, 0.9), n(0.5, 0.4)], SIXTEENTH)
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
