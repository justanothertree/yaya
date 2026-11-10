import { describe, expect, it } from 'vitest'
import { assignSyllables, splitLyrics } from './lyrics'
import { chopGates, consonantLength, crushCurve, planLine, type SingOpts } from './singer'

/**
 * The voice's timing, asked without a browser. What is checked is where things land in seconds —
 * the vowel on the beat, the consonant before it, a hold carrying the vowel — which is the part
 * of singing a test can be right about. Whether it sounds like singing is for ears.
 */
const opts = (over: Partial<SingOpts> = {}): SingOpts => ({
  lead: 'bright',
  harmony: null,
  glitch: { stutter: false, crush: false, chop: false, formant: 1 },
  beat: 0.5,
  ...over,
})
const notes = [0, 0.5, 1, 1.5].map((t, i) => ({ t, dur: 0.45, midi: 72 + i }))
const sung = (lyric: string) => assignSyllables(notes, splitLyrics(lyric)).sung

describe('words land on the beat', () => {
  it('the vowel starts on its note, and the consonant just before it', () => {
    const ev = planLine(sung('one sky two three'), 10, opts())
    const sky = ev[1]
    expect(sky.vowelAt).toBeCloseTo(10.5)
    expect(sky.from).toBeCloseTo(10.5 - consonantLength(sky.phones.onset))
    expect(sky.from).toBeLessThan(sky.vowelAt)
  })

  it('the first word of a line does not reach back before the line starts', () => {
    const ev = planLine(sung('sky one two three'), 10, opts())
    expect(ev[0].from).toBe(10)
  })

  it('a hold carries the syllable across: one event, its pitches, its end', () => {
    const ev = planLine(sung('glow _ _ on'), 0, opts())
    expect(ev).toHaveLength(2)
    expect(ev[0].pitches.map((p) => p.midi)).toEqual([72, 73, 74])
    expect(ev[0].end).toBeCloseTo(1 + 0.45)
  })
})

describe('two voices, in harmony', () => {
  it('the harmony is the other voice, singing its own notes at the same times', () => {
    const ev = planLine(sung('one two three four'), 0, opts({ harmony: (m) => m + 4 }))
    const lead = ev.filter((e) => e.voice === 'bright')
    const harm = ev.filter((e) => e.voice === 'airy')
    expect(lead).toHaveLength(4)
    expect(harm).toHaveLength(4)
    expect(harm.map((e) => e.pitches[0].midi)).toEqual(lead.map((e) => e.pitches[0].midi + 4))
    expect(harm.map((e) => e.vowelAt)).toEqual(lead.map((e) => e.vowelAt))
  })
})

describe('the glitches', () => {
  it('a syllable on the top of a bar stutters three times on 32nds; one off the bar does not', () => {
    const ev = planLine(
      sung('one two three four'),
      0,
      opts({ glitch: { stutter: true, crush: false, chop: false, formant: 1 } }),
    )
    expect(ev[0].stutter).toEqual([0, 0.0625, 0.125])
    expect(ev[1].stutter).toEqual([])
  })

  it('the chop gates every sixteenth, on for 60% of it', () => {
    const g = chopGates(0, 1, 0.5)
    expect(g).toHaveLength(8)
    expect(g[1][0]).toBeCloseTo(0.125)
    expect(g[1][1] - g[1][0]).toBeCloseTo(0.075)
  })

  it('the crush has exactly the levels it is asked for', () => {
    const levels = new Set(Array.from(crushCurve(4)).map((x) => x.toFixed(3)))
    /* -1, -0.75 … 0.75, 1: nine levels for four steps each side */
    expect(levels.size).toBe(9)
  })
})
