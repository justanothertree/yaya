/**
 * Speech into singing: put each syllable of a spoken word on a note's pitch and stretch it to the
 * note's length, keeping the voice's own timbre.
 *
 * ⚠️ THROWAWAY DEMO (docs/2026-11-13-singer-voice-research.md) — nothing in the app imports this.
 *
 * ⚠️ WHY PSOLA AND NOT RESAMPLING. Playing a recording faster raises its pitch AND its formants,
 * and the formants are what make a voice sound like a person rather than a chipmunk. TD-PSOLA cuts
 * the voiced sound into one grain per glottal pulse and lays the grains out again at the new pitch's
 * spacing, so the pulse rate changes and the shape of each pulse — the formants — does not.
 * psola.test.ts checks exactly that difference against plain resampling.
 *
 * ⚠️ PURE. Every function here takes samples and returns samples, so the tests can ask "is this
 * 330Hz" and "did the 800Hz resonance stay put" with no browser.
 */

/** A pitch track: one frame every `hop` samples. `f0` is 0 where the frame is not voiced. */
export type Track = { hop: number; f0: Float32Array; rms: Float32Array }

const MIN_F0 = 90
const MAX_F0 = 900

/**
 * Pitch per frame, by YIN (de Cheveigné & Kawahara 2002): the lag at which the signal best matches
 * itself, normalised so the zero lag never wins. A frame is voiced when that match is good
 * (`threshold`) and the frame is not near silence.
 */
export function trackPitch(x: Float32Array, sr: number, hopSec = 0.005, threshold = 0.15): Track {
  const hop = Math.max(1, Math.round(sr * hopSec))
  const maxLag = Math.ceil(sr / MIN_F0)
  const minLag = Math.max(2, Math.floor(sr / MAX_F0))
  const W = maxLag
  const frames = Math.max(1, Math.ceil(x.length / hop))
  const f0 = new Float32Array(frames)
  const rms = new Float32Array(frames)
  const d = new Float32Array(maxLag + 1)
  const at = (i: number) => (i >= 0 && i < x.length ? x[i] : 0)
  let peak = 0
  for (let f = 0; f < frames; f++) {
    const s = f * hop - (W >> 1)
    let e = 0
    for (let j = 0; j < W; j++) e += at(s + j) ** 2
    rms[f] = Math.sqrt(e / W)
    if (rms[f] > peak) peak = rms[f]
  }
  for (let f = 0; f < frames; f++) {
    if (rms[f] < peak * 0.02) continue
    const s = f * hop - (W >> 1)
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0
      for (let j = 0; j < W; j++) {
        const v = at(s + j) - at(s + j + tau)
        sum += v * v
      }
      d[tau] = sum
    }
    /* cumulative mean normalised difference, then the first dip under the threshold */
    let run = 0
    let best = -1
    for (let tau = 1; tau <= maxLag; tau++) {
      run += d[tau]
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1
    }
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++
        best = tau
        break
      }
    }
    if (best < 0) continue
    /* parabolic interpolation between the lags either side */
    const a = d[best - 1] ?? d[best]
    const b = d[best]
    const c = d[best + 1] ?? d[best]
    const den = a - 2 * b + c
    const lag = den !== 0 ? best + (0.5 * (a - c)) / den : best
    f0[f] = sr / lag
  }
  tidyVoicing(f0)
  return { hop, f0, rms }
}

/** a lone voiced frame is a blip and a lone unvoiced one inside a vowel is a dropout; octave
 *  jumps against both neighbours are folded back */
function tidyVoicing(f0: Float32Array) {
  const n = f0.length
  for (let i = 1; i < n - 1; i++) {
    if (f0[i] > 0 && f0[i - 1] === 0 && f0[i + 1] === 0) f0[i] = 0
    else if (f0[i] === 0 && f0[i - 1] > 0 && f0[i + 1] > 0) f0[i] = (f0[i - 1] + f0[i + 1]) / 2
  }
  for (let i = 1; i < n - 1; i++) {
    const p = f0[i - 1]
    const q = f0[i + 1]
    if (!(f0[i] > 0 && p > 0 && q > 0)) continue
    const mid = (p + q) / 2
    if (f0[i] > mid * 1.7) f0[i] /= 2
    else if (f0[i] < mid / 1.7) f0[i] *= 2
  }
}

/** the pitch at a sample position, from the frame nearest it (0 = unvoiced) */
export function f0At(track: Track, sample: number): number {
  const i = Math.round(sample / track.hop)
  return track.f0[Math.min(track.f0.length - 1, Math.max(0, i))]
}

/**
 * One mark per glottal pulse across every voiced stretch: the strongest peak of a smoothed copy,
 * searched for a quarter period either side of where the last mark plus one period says it should
 * be. The smoothing keeps the mark on the pulse rather than on whichever formant ripple is tallest.
 */
export function pitchMarks(x: Float32Array, sr: number, track: Track): Int32Array {
  const lp = smooth(x, sr, 900)
  const marks: number[] = []
  let i = 0
  const n = track.f0.length
  while (i < n) {
    if (track.f0[i] === 0) {
      i++
      continue
    }
    let j = i
    while (j < n && track.f0[j] > 0) j++
    const a = Math.max(0, i * track.hop - (track.hop >> 1))
    const b = Math.min(x.length - 1, j * track.hop + (track.hop >> 1))
    let P = sr / track.f0[i]
    let m = argMax(lp, a, Math.min(b, a + Math.round(P)))
    while (m <= b) {
      marks.push(m)
      P = sr / (f0At(track, m) || track.f0[i])
      const want = m + P
      if (want > b) break
      const lo = Math.max(m + 1, Math.round(want - P / 4))
      const hi = Math.min(b, Math.round(want + P / 4))
      if (hi <= lo) break
      m = argMax(lp, lo, hi)
    }
    i = j
  }
  return Int32Array.from(marks)
}

/** a zero-phase one-pole low-pass: forward then backward */
function smooth(x: Float32Array, sr: number, hz: number): Float32Array {
  const k = Math.exp((-2 * Math.PI * hz) / sr)
  const y = new Float32Array(x.length)
  let s = 0
  for (let i = 0; i < x.length; i++) y[i] = s = (1 - k) * x[i] + k * s
  s = 0
  for (let i = x.length - 1; i >= 0; i--) y[i] = s = (1 - k) * y[i] + k * s
  return y
}

function argMax(x: Float32Array, a: number, b: number): number {
  let best = a
  for (let i = a + 1; i <= b; i++) if (x[i] > x[best]) best = i
  return best
}

/** the index of the mark nearest `t` */
function nearestMark(marks: Int32Array, t: number): number {
  let lo = 0
  let hi = marks.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (marks[mid] < t) lo = mid
    else hi = mid
  }
  return Math.abs(marks[lo] - t) <= Math.abs(marks[hi] - t) ? lo : hi
}

/**
 * What to make: `len` samples, where output sample t reads the source near `timeMap(t)` and sings
 * at `pitch(t)` Hz. `formant` scales the voice's resonances without moving the note — above 1 is
 * smaller and brighter, the pitched-up pop sound; 1 leaves the voice as it was.
 */
export type Render = {
  len: number
  timeMap: (t: number) => number
  pitch: (t: number) => number
  formant?: number
}

/**
 * TD-PSOLA. Voiced: the grain is two source periods around the nearest pulse mark, Hann-windowed,
 * laid down every target period. Unvoiced (a hiss, a click): fixed 4ms grains at half overlap,
 * which sum back to the source unchanged, so consonants keep their own sound.
 */
export function psola(x: Float32Array, sr: number, track: Track, marks: Int32Array, r: Render) {
  const y = new Float32Array(r.len)
  const alpha = r.formant ?? 1
  const hiss = Math.round(sr * 0.004)
  let t = 0
  while (t < r.len) {
    const tin = r.timeMap(t)
    const f = f0At(track, tin)
    if (f > 0 && marks.length) {
      const m = marks[nearestMark(marks, tin)]
      const Pa = sr / (f0At(track, m) || f)
      grain(y, x, m, Pa, t, alpha)
      t += sr / r.pitch(t)
    } else {
      grain(y, x, tin, hiss, t, 1)
      t += hiss
    }
  }
  return y
}

/** add one Hann-windowed grain of the source centred at `src`, half-width `half` source samples,
 *  into `y` centred at `at`; `alpha` > 1 reads the source faster, which lifts the formants */
function grain(
  y: Float32Array,
  x: Float32Array,
  src: number,
  half: number,
  at: number,
  alpha: number,
) {
  const outHalf = half / alpha
  const lo = Math.ceil(at - outHalf)
  const hi = Math.floor(at + outHalf)
  for (let o = lo; o <= hi; o++) {
    if (o < 0 || o >= y.length) continue
    const n = o - at
    const w = 0.5 * (1 + Math.cos((Math.PI * n) / outHalf))
    const s = src + n * alpha
    const i = Math.floor(s)
    if (i < 0 || i + 1 >= x.length) continue
    const fr = s - i
    y[o] += w * (x[i] * (1 - fr) + x[i + 1] * fr)
  }
}

/** One syllable's place in its word's audio, in samples. */
export type SyllableSpan = {
  /** where the syllable's sound begins and ends */
  from: number
  to: number
  /** where it reaches half its loudness: the point a listener hears as "on the beat" */
  onset: number
  /** the steady middle of its vowel — the part that is held when the note is long */
  nucleus: [number, number]
}

/**
 * A spoken word into `k` syllables: the k loudest voiced humps of its loudness curve, cut at the
 * quietest point between each pair. If the voice ran syllables together so there are fewer humps
 * than syllables, the longest stretch is halved until there are enough — a guess, like autoSplit's.
 */
export function syllableSpans(track: Track, k: number, sr: number): SyllableSpan[] {
  const { hop, rms, f0 } = track
  const n = rms.length
  let peak = 0
  for (const v of rms) peak = Math.max(peak, v)
  const on = (i: number) => rms[i] > peak * 0.03
  let first = 0
  while (first < n - 1 && !on(first)) first++
  let last = n - 1
  while (last > first && !on(last)) last--
  const e = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      s += rms[j]
      c++
    }
    e[i] = s / c
  }
  /* ⚠️ A VOWEL IS A VOICED RUN THAT LASTS. A plosive's burst can read as voiced for a frame or two,
     and it is often the loudest moment in its syllable — held, it becomes a long burst of noise
     (measured on "static": the 10ms blip at the t, held for 0.7s, where the 110ms "a" beside it
     should have been). Runs shorter than 20ms are not vowels, unless the word has nothing longer. */
  const minRun = Math.max(2, Math.ceil((0.02 * sr) / hop))
  const steady = new Uint8Array(n)
  for (let i = 0; i < n; ) {
    if (!(f0[i] > 0)) {
      i++
      continue
    }
    let j = i
    while (j < n && f0[j] > 0) j++
    if (j - i >= minRun) steady.fill(1, i, j)
    i = j
  }
  if (!steady.some((v) => v)) for (let i = 0; i < n; i++) steady[i] = f0[i] > 0 ? 1 : 0
  const voicedE = (i: number) => (steady[i] ? e[i] : 0)
  /* local maxima of voiced loudness, at least ~60ms apart */
  const gap = Math.max(1, Math.round((0.06 * sr) / hop))
  const humps: number[] = []
  for (let i = first; i <= last; i++) {
    const v = voicedE(i)
    if (v <= 0) continue
    let top = true
    for (let j = Math.max(first, i - gap); j <= Math.min(last, i + gap); j++)
      if (voicedE(j) > v || (voicedE(j) === v && j < i)) top = false
    if (top) humps.push(i)
  }
  /* ⚠️ A HUMP IS A SYLLABLE ONLY IF THE SOUND DIPS BETWEEN IT AND EVERY LOUDER ONE — loudest first,
     each kept only when the quietest point between it and each kept hump falls under 70% of the
     smaller of the two. A held vowel wobbles, and without this its wobbles count as syllables. */
  const dipsBetween = (a: number, b: number) => {
    let low = Infinity
    for (let j = Math.min(a, b); j <= Math.max(a, b); j++) low = Math.min(low, e[j])
    return low < 0.7 * Math.min(e[a], e[b])
  }
  const kept: number[] = []
  for (const h of humps.sort((a, b) => voicedE(b) - voicedE(a)))
    if (kept.length < k && kept.every((o) => dipsBetween(o, h))) kept.push(h)
  let picked = kept.sort((a, b) => a - b)
  if (!picked.length) picked = [Math.round((first + last) / 2)]
  /* cut points: the quietest frame between neighbouring humps */
  let cuts = [first]
  for (let i = 0; i + 1 < picked.length; i++) {
    let best = picked[i]
    for (let j = picked[i]; j <= picked[i + 1]; j++) if (e[j] < e[best]) best = j
    cuts.push(best)
  }
  cuts.push(last + 1)
  while (cuts.length - 1 < k) {
    let w = 0
    for (let i = 1; i + 1 < cuts.length; i++)
      if (cuts[i + 1] - cuts[i] > cuts[w + 1] - cuts[w]) w = i
    const mid = Math.round((cuts[w] + cuts[w + 1]) / 2)
    cuts = [...cuts.slice(0, w + 1), mid, ...cuts.slice(w + 1)]
  }
  const out: SyllableSpan[] = []
  for (let s = 0; s < k; s++) {
    const a = cuts[s]
    const b = Math.max(a + 1, cuts[s + 1])
    /* the syllable's vowel: its steady voiced run with the most sound in it, and that run's
       loudest frame */
    let v0 = -1
    let v1 = -1
    let most = 0
    for (let i = a; i < b; ) {
      if (!steady[i]) {
        i++
        continue
      }
      let j = i
      let sum = 0
      while (j < b && steady[j]) sum += e[j++]
      if (sum > most) {
        most = sum
        v0 = i
        v1 = j - 1
      }
      i = j
    }
    let top = a
    if (v0 < 0) {
      for (let i = a; i < b; i++) if (e[i] > e[top]) top = i
      v0 = v1 = top
    } else for (let i = v0; i <= v1; i++) if (e[i] > e[top] || top < v0) top = i
    let onset = a
    while (onset < top && e[onset] < e[top] * 0.5) onset++
    const reach = Math.max(1, Math.round((v1 - v0) * 0.25))
    const n0 = Math.max(v0, onset, top - reach)
    const n1 = Math.max(n0 + 2, Math.min(v1, top + reach))
    out.push({
      from: a * hop,
      to: b * hop,
      onset: onset * hop,
      nucleus: [n0 * hop, Math.min(b * hop, n1 * hop)],
    })
  }
  return out
}

/**
 * Where output sample t reads from, for a syllable stretched to `len` samples whose onset lands
 * `lead` samples in. Everything before the nucleus plays at its own speed, the coda plays at its
 * own speed at the very end, and the nucleus fills whatever is left by sweeping back and forth
 * across itself — a held vowel that keeps the small changes a real one has, rather than one grain
 * repeated until it buzzes.
 *
 * If the note is too short for the syllable at its own speed, the whole syllable is squeezed
 * evenly instead.
 */
export function stretchMap(span: SyllableSpan, len: number): (t: number) => number {
  const head = span.nucleus[0] - span.from
  const tail = span.to - span.nucleus[1]
  const body = span.nucleus[1] - span.nucleus[0]
  const mid = len - head - tail
  if (mid < body * 0.5) {
    const k = (span.to - span.from) / Math.max(1, len)
    return (t) => span.from + t * k
  }
  const sweep = 0.6
  return (t) => {
    if (t < head) return span.from + t
    if (t >= head + mid) return span.nucleus[1] + (t - head - mid)
    const u = (t - head) * sweep
    const lap = u % (2 * body)
    return span.nucleus[0] + (lap < body ? lap : 2 * body - lap)
  }
}

/** midi to Hz */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
