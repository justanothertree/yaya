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
  kick: 36,
  bytes: 40,
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
  kick: number
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
  f[MUSIC.kick / 4] = p.kick
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

/** the bands that make up the kick: everything below about 110 Hz */
export const BASS_BANDS = bandEdges(BANDS).findIndex((hz) => hz > 110)

export type BeatState = { last: number; floor: number; peak: number; armed: boolean; since: number }
export const QUIET: BeatState = { last: 0, floor: 0, peak: 0, armed: true, since: 1 }

/**
 * Has a beat just landed? A beat is the bass RISING sharply from where it has lately been — not a
 * loud bass, which a held organ note also is.
 *
 * ⚠️ MEASURED AGAINST A FLOOR, BECAUSE THE BANDS ARE DECIBELS. An analyser's byte spectrum is a log
 * scale, smoothed, so a real kick drum never goes quiet between hits: off the site's own music
 * analyser a 120 BPM kick swung the bass between 0.72 and 0.99 and never lower. Two earlier rules
 * failed on that shape. "A third above the average" asked for 1.15 of a 0..1 band and found one
 * beat in three seconds of six; "0.1 above the average" missed too, because any average lags
 * ABOVE a falling signal, and the bass sags for the whole gap between two kicks. So `floor`
 * follows the bass straight down and eases back up towards it, a hit is a rise of 0.15
 * (about 10 dB) over it, and the 180 ms wait is faster than any kick drum (333 BPM).
 *
 * ⚠️ AND IT RE-ARMS ONLY ONCE THE BASS HAS FALLEN 0.1 FROM ITS PEAK. Without that a held bass note
 * fired over and over for as long as the floor took to climb up to it; now its onset is one beat
 * and holding it is none, because a held note never falls. Re-arming on "back near the floor"
 * was tried first and lost the second kick of every song: coming out of silence the floor is still
 * climbing towards the trough when that kick lands. A kick's own decay is the reliable signal.
 */
export function beat(
  state: BeatState,
  bass: number,
  dt: number,
): { state: BeatState; hit: boolean } {
  const since = state.since + dt
  /* straight down with the bass, and back up towards it over about half a second — so a held note
     is caught up with, and the floor sits in the trough between kicks rather than far below it */
  const floor =
    bass < state.floor ? bass : state.floor + (bass - state.floor) * (1 - Math.exp(-dt / 0.5))
  const rise = bass - floor
  /* and only while the bass is CLIMBING: a kick's decay can sit well above a floor that is still
     catching up out of silence, and a beat is never on the way down */
  const hit = state.armed && bass > state.last && rise > 0.15 && bass > 0.3 && since > 0.18
  const peak = hit ? bass : Math.max(state.peak, bass)
  const armed = hit ? false : state.armed || bass < peak - 0.1
  return { state: { last: bass, floor, peak, armed, since: hit ? 0 : since }, hit }
}
