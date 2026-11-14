import { describe, expect, it } from 'vitest'
import { VOWELS, assignSyllables, splitLyrics } from './lyrics'
import {
  PRESETS,
  chopGates,
  consonantLength,
  crushCurve,
  doublePhrase,
  hz,
  planLine,
  planPhrases,
  type Phrase,
  type SingOpts,
  type Step,
  type Voice,
} from './singer'

/**
 * The voice, asked without a browser. The timeline is read through `valueAt`, a model of how Web
 * Audio plays automation (set, linear ramp, exponential ramp, ease toward a target) written here
 * and nowhere else — so a test asks "what pitch is the voice at 0.47s", not "did the planner push
 * the step it pushes". Whether it sounds like singing is for ears.
 */

const opts = (over: Partial<SingOpts> = {}): SingOpts => ({
  preset: 'clean',
  double: false,
  harmony: null,
  beat: 0.5,
  ...over,
})
const notes = [0, 0.5, 1, 1.5].map((t, i) => ({ t, dur: 0.45, midi: 72 + i }))
const sung = (lyric: string, ns = notes) => assignSyllables(ns, splitLyrics(lyric)).sung

/** a preset with the humanising off, so a test can ask for exact times and pitches */
const exact = (v: Voice): Voice => ({ ...v, humanize: { cents: 0, ms: 0, db: 0, drift: 0 } })

/** the value an AudioParam holds at time t after these events — Web Audio's rules, restated */
type Ease = { to: number; tc: number; t0: number; v0: number }
function valueAt(steps: readonly Step[], t: number): number {
  let v = 0
  let vt = -Infinity
  let ease: Ease | null = null
  const curve = (g: Ease, time: number) => g.to + (g.v0 - g.to) * Math.exp(-(time - g.t0) / g.tc)
  for (const s of steps) {
    if (s.t > t) {
      if (s.how === 'ramp') return v + ((s.v - v) * (t - vt)) / (s.t - vt)
      if (s.how === 'exp') return v * (s.v / v) ** ((t - vt) / (s.t - vt))
      break
    }
    if (s.how === 'target') {
      const base: number = ease ? curve(ease, s.t) : v
      ease = { to: s.v, tc: s.tc, t0: s.t, v0: base }
      v = base
    } else {
      v = s.v
      ease = null
    }
    vt = s.t
  }
  return ease ? curve(ease, t) : v
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)
const plan = (lyric: string, ns: typeof notes, v: Voice, seed = 1, over: Partial<SingOpts> = {}) =>
  planPhrases(planLine(sung(lyric, ns), 0, opts(over)), v, 0.5, seed)

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

  it('with time in hand before the line, its first consonant comes before the downbeat', () => {
    const ev = planLine(sung('sky one two three'), 10, opts({ lead: 0.5 }))
    expect(ev[0].vowelAt).toBe(10)
    expect(ev[0].from).toBeCloseTo(10 - consonantLength(ev[0].phones.onset), 9)
    /* and only as far as the time there is */
    expect(planLine(sung('sky'), 10, opts({ lead: 0.02 }))[0].from).toBeCloseTo(9.98, 9)
  })

  it('on fast notes the consonant leaves the vowel before it more than half its note', () => {
    /* sixteenths at 140 bpm: 107ms apart, against an 85ms s */
    const step = 60 / 140 / 4
    const fast = [0, 1, 2, 3].map((i) => ({ t: i * step, dur: step * 0.9, midi: 72 }))
    const ev = planLine(sung('so so so so', fast), 0, opts())
    for (let i = 1; i < ev.length; i++) {
      const gap = ev[i].vowelAt - ev[i - 1].vowelAt
      expect(ev[i].vowelAt).toBeCloseTo(i * step, 9)
      expect(ev[i].from).toBeLessThan(ev[i].vowelAt)
      expect(ev[i].from - ev[i - 1].vowelAt).toBeGreaterThan(gap / 2)
    }
  })

  it('a hold carries the syllable across: one event, its pitches, its end', () => {
    const ev = planLine(sung('glow _ _ on'), 0, opts())
    expect(ev).toHaveLength(2)
    expect(ev[0].pitches.map((p) => p.midi)).toEqual([72, 73, 74])
    expect(ev[0].end).toBeCloseTo(1 + 0.45)
  })
})

describe('two voices, in harmony', () => {
  it('the harmony is its own part, singing its own notes at the same times', () => {
    const ev = planLine(sung('one two three four'), 0, opts({ harmony: (m) => m + 4 }))
    const lead = ev.filter((e) => e.part === 'lead')
    const harm = ev.filter((e) => e.part === 'harmony')
    expect(lead).toHaveLength(4)
    expect(harm).toHaveLength(4)
    expect(harm.map((e) => e.pitches[0].midi)).toEqual(lead.map((e) => e.pitches[0].midi + 4))
    expect(harm.map((e) => e.vowelAt)).toEqual(lead.map((e) => e.vowelAt))
  })

  it('the harmony sings vowels only — its consonant noise would smear the lead’s', () => {
    const ps = plan('see sky too far', notes, PRESETS.clean, 1, { harmony: (m) => m + 4 })
    expect(ps.find((p) => p.part === 'lead')!.bursts.length).toBeGreaterThan(0)
    expect(ps.find((p) => p.part === 'harmony')!.bursts).toEqual([])
  })
})

describe('the glitches', () => {
  it('a syllable on the top of a bar stutters three times on 32nds; one off the bar does not', () => {
    const ev = planLine(sung('one two three four'), 0, opts({ preset: 'glitchy' }))
    expect(ev[0].stutter).toEqual([0, 0.0625, 0.125])
    expect(ev[1].stutter).toEqual([])
  })

  it('the stutter repeats the start quietly, silent between, each sliver louder, then the voice', () => {
    const [p] = plan('o two three four', notes, PRESETS.glitchy, 1, { preset: 'glitchy' })
    const first = valueAt(p.voicing, 0.015)
    const third = valueAt(p.voicing, 0.14)
    expect(first).toBeGreaterThan(0.3)
    expect(first).toBeLessThan(0.7)
    expect(valueAt(p.voicing, 0.045)).toBe(0)
    expect(third).toBeGreaterThan(first)
    expect(valueAt(p.voicing, 0.2)).toBeGreaterThan(0.85)
  })

  it('the stutter fades its slivers in and out instead of switching them — no clicks', () => {
    const [p] = plan('o two three four', notes, PRESETS.glitchy, 1, { preset: 'glitchy' })
    let last = valueAt(p.voicing, 0)
    for (let t = 0.0005; t < 0.21; t += 0.0005) {
      const v = valueAt(p.voicing, t)
      /* half a millisecond may move it by a little, never by a step */
      expect(Math.abs(v - last)).toBeLessThan(0.1)
      last = v
    }
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

describe('phrases', () => {
  it('one voice sings through a phrase; a real rest starts another', () => {
    const ns = [
      { t: 0, dur: 0.45, midi: 72 },
      { t: 0.5, dur: 0.45, midi: 74 },
      { t: 2, dur: 0.45, midi: 76 },
    ]
    const ps = plan('o o o', ns, exact(PRESETS.clean))
    expect(ps).toHaveLength(2)
    expect(ps[0].to).toBeGreaterThanOrEqual(0.95)
    expect(ps[1].from).toBeGreaterThan(1)
  })

  it('a small gap is sung straight through, a vowel stretching to the next syllable', () => {
    const [p] = plan('o o', notes.slice(0, 2), exact(PRESETS.clean))
    /* the notes end at 0.45 and the next starts at 0.5: the voice does not let go in between */
    expect(valueAt(p.voicing, 0.47)).toBeGreaterThan(0.4)
  })

  it('a vowel fills its whole note and lets go at the end', () => {
    const [p] = plan('o', [{ t: 0, dur: 1.5, midi: 72 }], exact(PRESETS.clean))
    expect(valueAt(p.voicing, 1.4)).toBeCloseTo(1, 5)
    expect(valueAt(p.voicing, 1.52)).toBe(0)
  })
})

describe('pitch', () => {
  const two = [
    { t: 0, dur: 0.48, midi: 72 },
    { t: 0.5, dur: 0.48, midi: 76 },
  ]

  it('glides between notes, leaving after the last one and arriving just after the beat', () => {
    const v = exact(PRESETS.clean)
    const [p] = plan('o o', two, v)
    const before = valueAt(p.pitch, 0.5 - v.glide)
    const after = valueAt(p.pitch, 0.5 + v.glide * 0.35 + 0.005)
    expect(Math.abs(cents(before, hz(72)))).toBeLessThan(1)
    expect(Math.abs(cents(after, hz(76)))).toBeLessThan(1)
    /* in between it is somewhere in between, and only ever climbing */
    let last = 0
    for (let t = 0.5 - v.glide * 0.65; t <= 0.5 + v.glide * 0.35; t += 0.002) {
      const f = valueAt(p.pitch, t)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
    const mid = valueAt(p.pitch, 0.5 - v.glide * 0.15)
    expect(mid).toBeGreaterThan(hz(72) * 1.01)
    expect(mid).toBeLessThan(hz(76) * 0.99)
  })

  it('hard tune snaps: no pitch between the two notes, ever', () => {
    const [p] = plan('o o', two, PRESETS.glitchy)
    for (let t = 0.3; t < 0.7; t += 0.001) {
      const f = valueAt(p.pitch, t)
      const near = Math.min(Math.abs(cents(f, hz(72))), Math.abs(cents(f, hz(76))))
      expect(near).toBeLessThan(0.5)
    }
    expect(Math.abs(cents(valueAt(p.pitch, 0.5), hz(76)))).toBeLessThan(0.5)
  })

  it('a phrase scoops up into its first note', () => {
    const v = exact(PRESETS.breathy)
    const [p] = plan('o', [{ t: 0.2, dur: 0.6, midi: 72 }], v)
    expect(cents(valueAt(p.pitch, 0.19), hz(72))).toBeCloseTo(-v.scoop * 100, 0)
    expect(Math.abs(cents(valueAt(p.pitch, 0.3), hz(72)))).toBeLessThan(1)
  })
})

describe('vibrato', () => {
  it('waits, then grows — only on a note held long enough to settle', () => {
    const v = exact(PRESETS.clean)
    const [p] = plan('o', [{ t: 0, dur: 1.2, midi: 72 }], v)
    expect(valueAt(p.vibrato, 0.2)).toBe(0)
    expect(valueAt(p.vibrato, v.vibrato.delay - 0.01)).toBe(0)
    expect(valueAt(p.vibrato, v.vibrato.delay + v.vibrato.rise + 0.05)).toBeCloseTo(
      v.vibrato.cents,
      5,
    )
    expect(valueAt(p.vibrato, 1.21)).toBe(0)
  })

  it('a short note has none', () => {
    const [p] = plan('o', [{ t: 0, dur: 0.3, midi: 72 }], exact(PRESETS.clean))
    for (let t = 0; t < 0.35; t += 0.01) expect(valueAt(p.vibrato, t)).toBe(0)
  })

  it('the glitchy voice has none at all', () => {
    const [p] = plan('o', [{ t: 0, dur: 2, midi: 72 }], PRESETS.glitchy)
    for (let t = 0; t < 2; t += 0.05) expect(valueAt(p.vibrato, t)).toBe(0)
  })
})

describe('the mouth', () => {
  it('reaches the vowel’s own resonances, from the measured table', () => {
    const [p] = plan('see', [{ t: 0.5, dur: 0.6, midi: 64 }], exact(PRESETS.clean))
    const at = (k: number) => valueAt(p.formants[k], 0.75)
    /* F2 and F3 straight from Peterson & Barney; F1 is lifted above the pitch (next test) */
    expect(at(1) / VOWELS.ee[1]).toBeCloseTo(1, 1)
    expect(at(2) / VOWELS.ee[2]).toBeCloseTo(1, 1)
  })

  it('a high note lifts F1 above its own pitch, as a soprano opens her jaw', () => {
    const [p] = plan('see', [{ t: 0.5, dur: 0.6, midi: 76 }], exact(PRESETS.clean))
    const f1 = valueAt(p.formants[0], 0.75)
    expect(f1).toBeGreaterThan(hz(76) * 1.1)
    expect(VOWELS.ee[0]).toBeLessThan(hz(76))
  })

  it('a diphthong moves from its first vowel to its second across the note', () => {
    const [p] = plan('night', [{ t: 0.5, dur: 1, midi: 60 }], exact(PRESETS.clean))
    expect(valueAt(p.formants[1], 0.6) / VOWELS.ah[1]).toBeCloseTo(1, 1)
    expect(valueAt(p.formants[1], 1.35) / VOWELS.ee[1]).toBeCloseTo(1, 1)
  })

  it('moves smoothly: no formant jumps once the phrase has started', () => {
    const [p] = plan(
      'glit-ter in the dark',
      notes.concat({ t: 2, dur: 0.45, midi: 70 }),
      exact(PRESETS.clean),
    )
    for (const f of p.formants) expect(f.slice(1).every((s) => s.how === 'target')).toBe(true)
  })
})

describe('consonants', () => {
  const one = (lyric: string) =>
    plan(lyric, [{ t: 1, dur: 0.8, midi: 69 }], exact(PRESETS.clean))[0] as Phrase

  it('s: a hiss before the beat with the voice silent, then the vowel on the beat', () => {
    const p = one('see')
    const [h] = p.bursts
    expect(h.through).toBe('band')
    expect(h.at).toBeCloseTo(1 - consonantLength({ kind: 'hiss', hz: 6500 }), 5)
    expect(h.at + h.len).toBeGreaterThanOrEqual(1)
    expect(valueAt(p.voicing, 0.96)).toBe(0)
    expect(valueAt(p.voicing, 1 + PRESETS.clean.attack + 0.01)).toBeCloseTo(1, 5)
  })

  it('z keeps the voice humming under its hiss', () => {
    expect(valueAt(one('zee').voicing, 0.96)).toBeCloseTo(0.3, 5)
  })

  it('t: closure, a short burst, then breath, then the voice', () => {
    const p = one('tee')
    const burst = p.bursts.find((b) => b.through === 'band')!
    const breath = p.bursts.find((b) => b.through === 'vowel')!
    expect(burst.len).toBeLessThanOrEqual(0.015)
    expect(burst.at + burst.len).toBeLessThanOrEqual(1)
    expect(breath.at).toBeGreaterThanOrEqual(burst.at + burst.len - 1e-9)
    expect(valueAt(p.voicing, 0.98)).toBe(0)
  })

  it('a closing k stops the voice before the note ends and bursts at the end', () => {
    const p = one('dark')
    expect(valueAt(p.voicing, 1.5)).toBeCloseTo(1, 5)
    expect(valueAt(p.voicing, 1.77)).toBe(0)
    expect(p.bursts.some((b) => b.at > 1.7 && b.at < 1.8)).toBe(true)
  })

  it('h is breath through the coming vowel, not a hiss of its own', () => {
    expect(one('he').bursts[0].through).toBe('vowel')
  })
})

describe('humanising', () => {
  const ns = [0, 0.5, 1, 1.5, 2, 2.5].map((t, i) => ({ t, dur: 0.3, midi: 64 + i }))

  it('the same seed sings the same line the same way, and another seed does not', () => {
    const a = plan('o o o o o o', ns, PRESETS.clean, 7)
    expect(plan('o o o o o o', ns, PRESETS.clean, 7)).toEqual(a)
    expect(plan('o o o o o o', ns, PRESETS.clean, 8)).not.toEqual(a)
  })

  it('never strays further than it is allowed', () => {
    const v = PRESETS.clean
    for (let seed = 1; seed <= 20; seed++) {
      const [p] = plan('o o o o o o', ns, v, seed)
      ns.forEach((n) => {
        /* the middle of each note, before any vibrato could begin */
        const f = valueAt(p.pitch, n.t + 0.2)
        expect(Math.abs(cents(f, hz(n.midi)))).toBeLessThanOrEqual(v.humanize.cents + 1e-6)
      })
    }
  })
})

describe('doubling', () => {
  it('the second voice is the same phrase a little later, with a slightly different throat', () => {
    const [p] = plan('see you', notes.slice(0, 2), PRESETS.clean)
    const d = doublePhrase(p, 0.016, 1.015)
    expect(valueAt(d.pitch, 0.316)).toBeCloseTo(valueAt(p.pitch, 0.3), 6)
    expect(valueAt(d.formants[1], 0.316)).toBeCloseTo(valueAt(p.formants[1], 0.3) * 1.015, 3)
    expect(d.bursts[0].at).toBeCloseTo(p.bursts[0].at + 0.016, 9)
  })
})

describe('every preset, every kind of consonant: a timeline Web Audio will accept', () => {
  const lyric = 'the quick brown fox jumps o-ver the la-zy dog _ shine night'
  const ns = Array.from({ length: 16 }, (_, i) => ({
    t: i * 0.4,
    dur: i % 5 === 4 ? 0.75 : 0.35,
    midi: 62 + ((i * 5) % 12),
  }))
  for (const id of Object.keys(PRESETS) as (keyof typeof PRESETS)[])
    it(`${PRESETS[id].name}: ordered, finite, in range, inside its phrase`, () => {
      for (const p of plan(lyric, ns, PRESETS[id], 3, { harmony: (m) => m + 3, preset: id })) {
        const lists = [p.pitch, p.vibrato, p.voicing, p.gate, ...p.formants]
        for (const l of lists)
          l.forEach((s, i) => {
            expect(Number.isFinite(s.v)).toBe(true)
            expect(s.t).toBeGreaterThanOrEqual(p.from - 1e-9)
            expect(s.t).toBeLessThanOrEqual(p.to)
            if (i) expect(s.t).toBeGreaterThanOrEqual(l[i - 1].t)
          })
        for (const s of p.pitch) expect(s.v).toBeGreaterThan(20)
        for (const s of p.voicing) expect(s.v).toBeGreaterThanOrEqual(0)
        for (const s of p.voicing) expect(s.v).toBeLessThanOrEqual(1.2)
        for (const f of p.formants) for (const s of f) expect(s.v).toBeGreaterThan(100)
        for (const b of p.bursts) {
          expect(b.len).toBeGreaterThan(0)
          expect(b.at).toBeGreaterThanOrEqual(p.from - 1e-9)
          expect(b.at + b.len).toBeLessThanOrEqual(p.to)
        }
      }
    })
})
