import { describe, expect, it } from 'vitest'
import { hz, pitchMarks, psola, stretchMap, syllableSpans, trackPitch } from './psola'
import { SR, hiss, vowel } from './voiceFixture'

/*
 * ⚠️ EVERY MEASUREMENT HERE SHARES NO ARITHMETIC WITH THE CODE UNDER TEST. Pitch is read off the
 * spectrum (the frequency whose harmonics carry the most energy), never by asking YIN again; the
 * formant check reads harmonic amplitudes, and is shown to tell PSOLA from plain resampling by
 * running the resampler through the same check and watching it give the opposite answer.
 */

/** |DFT| at one frequency over a Hann-windowed slice */
function mag(y: Float32Array, f: number, from: number, to: number): number {
  let re = 0
  let im = 0
  const w = (2 * Math.PI * f) / SR
  const n = to - from
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    const v = y[from + i] * win
    re += v * Math.cos(w * i)
    im -= v * Math.sin(w * i)
  }
  return Math.hypot(re, im)
}

/** the fundamental by harmonic sum — nothing in common with YIN's lag search */
function fundamental(y: Float32Array, from: number, to: number): number {
  let best = 0
  let bestF = 0
  for (let f = 100; f <= 700; f += 1) {
    let s = 0
    for (let h = 1; h <= 5; h++) s += mag(y, f * h, from, to)
    if (s > best) {
      best = s
      bestF = f
    }
  }
  return bestF
}

const linear = (inLen: number, outLen: number) => (t: number) => (t * inLen) / outLen

describe('trackPitch', () => {
  it('reads a 200Hz vowel as 200Hz', () => {
    const x = vowel(200, 0.4)
    const t = trackPitch(x, SR)
    const voiced = [...t.f0].filter((f) => f > 0).sort((a, b) => a - b)
    expect(voiced.length).toBeGreaterThan(t.f0.length * 0.8)
    expect(voiced[voiced.length >> 1]).toBeCloseTo(200, -0.5)
  })

  it('calls white noise unvoiced', () => {
    const x = hiss(0.3, 0.2, 7)
    const t = trackPitch(x, SR)
    expect([...t.f0].filter((f) => f > 0).length).toBeLessThan(t.f0.length * 0.1)
  })
})

describe('psola', () => {
  const src = vowel(200, 0.4)
  const track = trackPitch(src, SR)
  const marks = pitchMarks(src, SR, track)

  it('puts one mark per period', () => {
    const gaps = [...marks].slice(1).map((m, i) => m - marks[i])
    const median = gaps.sort((a, b) => a - b)[gaps.length >> 1]
    expect(median).toBeGreaterThanOrEqual(119)
    expect(median).toBeLessThanOrEqual(121)
  })

  it('sings the note it is asked for, at the length it is asked for', () => {
    const len = Math.round(SR * 0.8)
    const y = psola(src, SR, track, marks, {
      len,
      timeMap: linear(src.length, len),
      pitch: () => hz(64),
    })
    expect(y.length).toBe(len)
    const f = fundamental(y, Math.round(len * 0.25), Math.round(len * 0.75))
    expect(Math.abs(f - hz(64)) / hz(64)).toBeLessThan(0.01)
  })

  it('keeps the formant where it was — the thing resampling cannot do', () => {
    /* 200Hz → E4 is ×1.648; the 800Hz resonance would land on harmonic 4 (1318Hz) if it moved */
    const len = Math.round(SR * 0.4)
    const y = psola(src, SR, track, marks, {
      len,
      timeMap: linear(src.length, len),
      pitch: () => hz(64),
    })
    const near = (sig: Float32Array) => {
      const a = Math.round(sig.length * 0.2)
      const b = Math.round(sig.length * 0.8)
      const f0 = hz(64)
      return {
        at800: Math.max(mag(sig, f0 * 2, a, b), mag(sig, f0 * 3, a, b)),
        at1318: mag(sig, f0 * 4, a, b),
      }
    }
    const p = near(y)
    expect(p.at800 / p.at1318).toBeGreaterThan(2)

    /* the control: play the same source 1.648× faster, which is what "pitch it up" naively means */
    const k = hz(64) / 200
    const r = new Float32Array(Math.floor(src.length / k))
    for (let i = 0; i < r.length; i++) {
      const s = i * k
      const j = Math.floor(s)
      r[i] = src[j] * (1 - (s - j)) + (src[j + 1] ?? 0) * (s - j)
    }
    const q = near(r)
    expect(q.at1318 / q.at800).toBeGreaterThan(2)
  })

  it('changes note mid-syllable on a hold', () => {
    const len = Math.round(SR * 1.0)
    const y = psola(src, SR, track, marks, {
      len,
      timeMap: linear(src.length, len),
      pitch: (t) => (t < len / 2 ? hz(60) : hz(67)),
    })
    const a = fundamental(y, Math.round(len * 0.1), Math.round(len * 0.4))
    const b = fundamental(y, Math.round(len * 0.6), Math.round(len * 0.9))
    expect(Math.abs(a - hz(60)) / hz(60)).toBeLessThan(0.01)
    expect(Math.abs(b - hz(67)) / hz(67)).toBeLessThan(0.01)
  })

  it('lifts the formant when asked, without moving the note', () => {
    const len = Math.round(SR * 0.4)
    const base = { len, timeMap: linear(src.length, len), pitch: () => hz(64) }
    const plain = psola(src, SR, track, marks, base)
    const lifted = psola(src, SR, track, marks, { ...base, formant: 1.648 })
    const a = Math.round(len * 0.2)
    const b = Math.round(len * 0.8)
    expect(Math.abs(fundamental(lifted, a, b) - hz(64)) / hz(64)).toBeLessThan(0.01)
    const ratio = (s: Float32Array) => mag(s, hz(64) * 4, a, b) / mag(s, hz(64) * 2, a, b)
    expect(ratio(lifted)).toBeGreaterThan(ratio(plain) * 3)
  })

  it('passes a hiss through unchanged', () => {
    const x = hiss(0.3, 0.2, 11)
    const t = trackPitch(x, SR)
    t.f0.fill(0)
    const y = psola(x, SR, t, new Int32Array(0), {
      len: x.length,
      timeMap: (i) => i,
      pitch: () => 300,
    })
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 500; i < x.length - 500; i++) {
      num += x[i] * y[i]
      dx += x[i] ** 2
      dy += y[i] ** 2
    }
    expect(num / Math.sqrt(dx * dy)).toBeGreaterThan(0.99)
    expect(Math.sqrt(dy / dx)).toBeCloseTo(1, 1)
  })
})

describe('syllableSpans', () => {
  /* "a-ta": a vowel, a quiet click, a vowel */
  const word = (() => {
    const a = vowel(210, 0.15, [800, 1200])
    const b = vowel(190, 0.2, [300, 2300])
    const x = new Float32Array(Math.round(SR * 0.45))
    x.set(a, Math.round(SR * 0.02))
    x.set(b, Math.round(SR * 0.22))
    return x
  })()
  const t = trackPitch(word, SR)

  it('cuts between the two vowels', () => {
    const [one, two] = syllableSpans(t, 2, SR)
    expect(one.to / SR).toBeGreaterThan(0.15)
    expect(one.to / SR).toBeLessThan(0.23)
    expect(two.from).toBe(one.to)
    expect(one.onset / SR).toBeLessThan(0.05)
    expect(two.onset / SR).toBeGreaterThan(0.2)
    expect(two.onset / SR).toBeLessThan(0.25)
  })

  it('does not count the wobble in a held vowel as a syllable', () => {
    /* "aaa-ta": a long vowel swelling ±15% at 4Hz, then a quieter one after a real dip — the
       swells are louder than the second syllable, so only the dip rule can tell them apart */
    const long = vowel(200, 0.5, [800, 1200])
    for (let i = 0; i < long.length; i++) long[i] *= 1 + 0.15 * Math.sin((2 * Math.PI * 4 * i) / SR)
    const short = vowel(190, 0.18, [300, 2300]).map((v) => v * 0.6)
    const x = new Float32Array(Math.round(SR * 0.8))
    x.set(long, Math.round(SR * 0.02))
    x.set(short, Math.round(SR * 0.58))
    const [one, two] = syllableSpans(trackPitch(x, SR), 2, SR)
    expect(one.to / SR).toBeGreaterThan(0.5)
    expect(two.onset / SR).toBeGreaterThan(0.56)
  })

  /** a hand-made track: [from, to, f0, rms] runs over a quiet floor, 5ms frames */
  const track = (n: number, runs: [number, number, number, number][]) => {
    const f0 = new Float32Array(n)
    const rms = new Float32Array(n).fill(0.01)
    for (const [a, b, f, r] of runs) {
      f0.fill(f, a, b)
      rms.fill(r, a, b)
    }
    return { hop: 120, f0, rms }
  }

  it('holds the run with the most vowel in it, not the loudest moment', () => {
    /* a short loud voiced run (25ms — a voiced consonant, a creak) beside a longer, quieter vowel */
    const [s] = syllableSpans(
      track(60, [
        [10, 15, 190, 0.2],
        [17, 41, 160, 0.15],
      ]),
      1,
      SR,
    )
    expect(s.nucleus[0]).toBeGreaterThanOrEqual(17 * 120)
    expect(s.nucleus[1]).toBeLessThanOrEqual(41 * 120)
    expect(s.nucleus[1] - s.nucleus[0]).toBeGreaterThanOrEqual(8 * 120)
  })

  it('does not count a blip of voicing at a plosive as a syllable', () => {
    /* the shape measured on "static": a 10ms voiced burst louder than both vowels even after the
       loudness curve's 25ms smoothing has spread it out, a silence before the first vowel, and a
       shallower unvoiced join between the two (the "t-i") — so if the burst counts as a syllable,
       the quietest cut is the one in front of the first vowel, and the word splits there */
    const [one, two] = syllableSpans(
      track(90, [
        [8, 10, 195, 0.6],
        [14, 38, 160, 0.15],
        [38, 50, 0, 0.06],
        [50, 75, 180, 0.15],
      ]),
      2,
      SR,
    )
    expect(one.to).toBeGreaterThan(38 * 120)
    expect(one.to).toBeLessThanOrEqual(50 * 120)
    expect(two.nucleus[0]).toBeGreaterThanOrEqual(50 * 120)
  })

  it('finds more syllables than humps by halving, in order, with nothing lost', () => {
    const s = syllableSpans(t, 3, SR)
    expect(s).toHaveLength(3)
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBe(s[i - 1].to)
    for (const x of s) {
      expect(x.nucleus[0]).toBeGreaterThanOrEqual(x.from)
      expect(x.nucleus[1]).toBeLessThanOrEqual(x.to)
    }
  })
})

describe('stretchMap', () => {
  const span = { from: 1000, to: 5000, onset: 1500, nucleus: [2000, 3000] as [number, number] }

  it('plays the start and the coda at their own speed and holds the vowel between', () => {
    const len = 24000
    const m = stretchMap(span, len)
    expect(m(0)).toBe(1000)
    expect(m(999)).toBe(1999)
    expect(m(len - 1)).toBeCloseTo(4999, 0)
    for (let t = 1000; t < len - 2000; t += 97) {
      expect(m(t)).toBeGreaterThanOrEqual(2000)
      expect(m(t)).toBeLessThanOrEqual(3000)
    }
  })

  it('squeezes the whole syllable evenly when the note is too short for it', () => {
    const m = stretchMap(span, 2000)
    expect(m(0)).toBe(1000)
    expect(m(1000)).toBe(3000)
  })
})
