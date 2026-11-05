/**
 * The arithmetic of the Lab's music visual: turning an analyser's linear spectrum into bands a
 * person hears as evenly spaced, easing them so they move like music rather than flicker, and the
 * uniform the shader reads.
 */

/** Hand-packed to match `struct Music` — music.test.ts lays the struct out from the shader. */
export const MUSIC = {
  aspect: 0,
  spin: 4,
  zoom: 8,
  decay: 12,
  time: 16,
  level: 20,
  mode: 24,
  bands: 28,
  wave: 32,
  bytes: 36,
} as const

export type MusicParams = {
  aspect: number
  spin: number
  zoom: number
  decay: number
  time: number
  level: number
  mode: 0 | 1
  bands: number
  wave: number
}

export function packMusic(p: MusicParams, into = new ArrayBuffer(MUSIC.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f[MUSIC.aspect / 4] = p.aspect
  f[MUSIC.spin / 4] = p.spin
  f[MUSIC.zoom / 4] = p.zoom
  f[MUSIC.decay / 4] = p.decay
  f[MUSIC.time / 4] = p.time
  f[MUSIC.level / 4] = p.level
  u[MUSIC.mode / 4] = p.mode
  u[MUSIC.bands / 4] = p.bands
  u[MUSIC.wave / 4] = p.wave
  return into
}

export const BANDS = 96
export const WAVE = 256
/** the lowest and highest frequencies drawn, in Hz — below 30 is felt, above 16k barely heard */
export const LOW_HZ = 30
export const HIGH_HZ = 16000

/**
 * The edges of `n` bands spaced evenly in pitch from LOW_HZ to HIGH_HZ, in Hz (n + 1 of them).
 *
 * ⚠️ LOGARITHMIC, because hearing is. An analyser's bins are evenly spaced in Hz, so drawn as they
 * come the bottom octave — most of what a bass line and a kick drum are — gets two or three bars
 * at the left and the top three octaves take most of the screen.
 */
export function bandEdges(n: number, low = LOW_HZ, high = HIGH_HZ): number[] {
  const r = high / low
  return Array.from({ length: n + 1 }, (_, i) => low * r ** (i / n))
}

/**
 * Fold a byte spectrum (an analyser's `getByteFrequencyData`) into `edges.length - 1` bands, 0..1
 * each: the loudest bin inside each band, or — where a band is narrower than one bin, as the low
 * ones are — the bin its middle falls in.
 */
export function foldBands(
  spectrum: Uint8Array,
  sampleRate: number,
  fftSize: number,
  edges: readonly number[],
  into: Float32Array = new Float32Array(edges.length - 1),
): Float32Array {
  const hzPerBin = sampleRate / fftSize
  const last = spectrum.length - 1
  for (let b = 0; b < edges.length - 1; b++) {
    const lo = Math.max(0, Math.ceil(edges[b] / hzPerBin))
    const hi = Math.min(last, Math.floor(edges[b + 1] / hzPerBin))
    let peak = 0
    if (hi >= lo) for (let i = lo; i <= hi; i++) peak = Math.max(peak, spectrum[i])
    else peak = spectrum[Math.min(last, Math.round(Math.sqrt(edges[b] * edges[b + 1]) / hzPerBin))]
    into[b] = peak / 255
  }
  return into
}

/**
 * Ease `current` toward `target`: quickly up and slowly down, per second, so a hit lands on the
 * beat and then falls away rather than vanishing the next frame.
 */
export function ease(current: number, target: number, dt: number, rise = 30, fall = 5): number {
  const rate = target > current ? rise : fall
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/** A byte waveform (128 is silence) resampled to `n` points in -1..1. */
export function foldWave(
  waveform: Uint8Array,
  n: number,
  into: Float32Array = new Float32Array(n),
): Float32Array {
  const step = waveform.length / n
  for (let i = 0; i < n; i++) into[i] = (waveform[Math.floor(i * step)] - 128) / 128
  return into
}
