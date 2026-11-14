/**
 * Test sounds for the singer demo: a vowel built the way a voice builds one, and a hiss.
 * Shared by psola.test.ts and sing.test.ts so both ask their questions of the same voice.
 */

export const SR = 24000

/**
 * A vowel the way a voice makes one: a pulse train whose harmonics fall 6dB an octave (the glottis
 * less the lips' lift), through a cascade of two-pole resonances at `formants` Hz — Klatt's model,
 * and the reason the fundamental is still there under the formants. Faded in and out over 30ms, as
 * a syllable is.
 */
export function vowel(f0: number, secs: number, formants = [800, 2000]): Float32Array {
  const n = Math.round(secs * SR)
  const x = new Float32Array(n)
  const tract = (f: number) =>
    formants.reduce((g, F) => (g * (F * F)) / Math.hypot(F * F - f * f, 90 * f), 1)
  for (let h = 1; h * f0 < 5000; h++) {
    const a = tract(h * f0) / h
    const w = (2 * Math.PI * h * f0) / SR
    for (let i = 0; i < n; i++) x[i] += a * Math.cos(w * i)
  }
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const ramp = Math.round(SR * 0.03)
  for (let i = 0; i < n; i++) x[i] = (x[i] / peak) * 0.5 * Math.min(1, i / ramp, (n - 1 - i) / ramp)
  return x
}

/** white noise at `level` peak, seeded so a test reads the same every run */
export function hiss(secs: number, level: number, seed = 1): Float32Array {
  const x = new Float32Array(Math.round(secs * SR))
  let s = seed
  for (let i = 0; i < x.length; i++) {
    s = (s * 16807) % 2147483647
    x[i] = (s / 2147483647 - 0.5) * 2 * level
  }
  return x
}
