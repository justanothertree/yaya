import type { Sung } from './line'
import {
  hz,
  pitchMarks,
  psola,
  stretchMap,
  syllableSpans,
  trackPitch,
  type SyllableSpan,
  type Track,
} from './psola'

/**
 * A spoken word, analysed once and sung as many times as the line needs it.
 *
 * ⚠️ THROWAWAY DEMO — see psola.ts.
 */
export type Spoken = {
  x: Float32Array
  sr: number
  track: Track
  marks: Int32Array
  spans: SyllableSpan[]
}

/** the loudest 15ms of every word lands here, so a mumbled word and a shouted one sing level */
const WORD_PEAK = 0.12

export function analyse(raw: Float32Array, sr: number, syllables: number): Spoken {
  const first = trackPitch(raw, sr)
  let peak = 0
  for (const v of first.rms) peak = Math.max(peak, v)
  const g = peak > 0 ? WORD_PEAK / peak : 1
  const x = raw.map((v) => v * g)
  const track = { ...first, rms: first.rms.map((v) => v * g) }
  return {
    x,
    sr,
    track,
    marks: pitchMarks(x, sr, track),
    spans: syllableSpans(track, syllables, sr),
  }
}

export type Style = {
  /** pitch snaps between notes with no glide or scoop — the hard-tuned pop sound */
  hard: boolean
  vibrato: boolean
  /** resonances scaled without moving the note; 1 is the voice as it speaks */
  formant: number
  transpose: number
  /** a fixed detune, for the doubled voice */
  cents: number
  /** a bar's first syllable trips over itself: g-g-glitter */
  stutter: boolean
}

/** the furthest a consonant may start before its beat */
const MAX_LEAD = 0.16

/** where the voice should be, in Hz, at `sec` into the line */
export function pitchCurve(s: Sung, st: Style): (sec: number) => number {
  return (sec) => {
    let i = 0
    while (i + 1 < s.pitches.length && s.pitches[i + 1].at <= sec) i++
    const p = s.pitches[i]
    let m = p.midi + st.transpose
    const since = sec - p.at
    if (!st.hard) {
      if (i > 0 && since < 0.07) {
        const prev = s.pitches[i - 1].midi + st.transpose
        m = prev + (m - prev) * (Math.max(0, since) / 0.07)
      } else if (i === 0 && since < 0.08) m -= 0.8 * (1 - Math.max(0, since) / 0.08)
    }
    if (st.vibrato && since > 0.22) {
      const held = since - 0.22
      m += Math.min(1, held / 0.3) * 0.28 * Math.sin(2 * Math.PI * 5.6 * held)
    }
    return hz(m) * 2 ** (st.cents / 1200)
  }
}

/**
 * The whole line as one buffer at the voice's own sample rate. Times in `sung` are seconds.
 *
 * Each syllable is cut from its word, placed so its onset (the half-loudness point) lands on its
 * note, stretched to the note's end — holds included — and re-pitched to the melody.
 */
export function singLine(
  sung: readonly Sung[],
  spoken: readonly Spoken[],
  st: Style,
  beat: number,
): Float32Array {
  const sr = spoken[0]?.sr ?? 24000
  const end = sung.reduce((m, s) => Math.max(m, s.end), 0)
  const out = new Float32Array(Math.ceil((end + 0.5) * sr))
  const bar = beat * 4
  for (const s of sung) {
    const w = spoken[s.word]
    const span0 = w.spans[s.syl]
    if (!span0) continue
    const lead = Math.min(span0.onset - span0.from, Math.round(MAX_LEAD * sr))
    const span = { ...span0, from: span0.onset - lead }
    const start = Math.round(s.t * sr) - lead
    const len = Math.round(s.end * sr) - start
    if (len <= 0) continue
    const curve = pitchCurve(s, st)
    let y: Float32Array = psola(w.x, sr, w.track, w.marks, {
      len,
      timeMap: stretchMap(span, len),
      pitch: (t) => curve((start + t) / sr),
      formant: st.formant,
    })
    if (st.stutter && Math.abs(s.t / bar - Math.round(s.t / bar)) < 1e-3)
      y = stutter(y, lead, sr, beat)
    fade(y, Math.round(sr * 0.003), Math.round(sr * 0.012))
    for (let i = 0; i < y.length; i++) {
      const o = start + i
      if (o >= 0 && o < out.length) out[o] += y[i]
    }
  }
  return out
}

/** the first thirty-second of the syllable twice, gated, and then the syllable itself */
function stutter(y: Float32Array, on: number, sr: number, beat: number): Float32Array {
  const step = Math.round((beat / 8) * sr)
  const gate = Math.round(step * 0.7)
  const z = new Float32Array(y.length)
  z.set(y.subarray(0, on))
  for (let k = 0; k < 2; k++) {
    const slice = y.slice(on, on + gate)
    fade(slice, Math.round(sr * 0.002), Math.round(sr * 0.006))
    z.set(
      slice.subarray(0, Math.max(0, Math.min(slice.length, z.length - on - k * step))),
      on + k * step,
    )
  }
  const rest = y.subarray(on, Math.max(on, y.length - 2 * step))
  z.set(rest.subarray(0, Math.max(0, z.length - on - 2 * step)), on + 2 * step)
  return z
}

function fade(y: Float32Array, a: number, b: number) {
  for (let i = 0; i < a && i < y.length; i++) y[i] *= i / a
  for (let i = 0; i < b && i < y.length; i++) y[y.length - 1 - i] *= i / b
}
