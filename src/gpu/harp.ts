/**
 * The arithmetic of the Lab's harp: which notes the strings are tuned to, where they stand, which
 * strings a moving finger crossed and where, and how a plucked string moves.
 *
 * ⚠️ THE STRINGS HAVE NO SIMULATION. A plucked string's motion has an exact answer — the sum of
 * its standing waves (modes), each with an amplitude fixed by where it was plucked, swinging at a
 * whole multiple of the string's lowest frequency and dying away faster the higher it is — so the
 * vertex shader works out every point of every string from the time since its last pluck and
 * nothing else. There is no state to step, nothing to go unstable, and a paused string is just a
 * frozen time.
 */

import { degreesOf } from '../audio/scales'

/** Hand-packed to match `struct Harp` — harp.test.ts lays the struct out from the shader. */
export const HARP = {
  size: 0,
  time: 8,
  count: 12,
  width: 16,
  modes: 20,
  bytes: 24,
} as const

/** each string in the strings buffer: x, top, bottom, hue · pluck time, where, how hard, - */
export const STRING_FLOATS = 8
export const MAX_STRINGS = 24
/** modes summed per point: enough that a pluck's corner is sharp at the moment of plucking */
export const MODES = 16

export type HarpString = { x: number; top: number; bottom: number; midi: number }
export type Pluck = { at: number; where: number; amp: number }

/** the notes of `count` strings up a scale from `root`, wrapping into the next octave */
export function tune(scale: string, root: number, count: number): number[] {
  const deg = degreesOf(scale)
  return Array.from(
    { length: count },
    (_, i) => root + 12 * Math.floor(i / deg.length) + deg[i % deg.length],
  )
}

/**
 * Where the strings stand, in canvas pixels: across the canvas, low notes on the left, each a
 * little shorter than the last — a harp's slanted neck — so pitch can be seen as well as heard.
 */
export function layout(midis: readonly number[], w: number, h: number): HarpString[] {
  const n = midis.length
  const margin = Math.min(w, h) * 0.08
  const gap = (w - 2 * margin) / Math.max(1, n - 1)
  const bottom = h - margin
  return midis.map((midi, i) => ({
    x: margin + i * gap,
    top: margin + (h - 2 * margin) * 0.35 * (i / Math.max(1, n - 1)),
    bottom,
    midi,
  }))
}

/**
 * The strings a finger crossed going from a to b, in the order it crossed them, each with where
 * along it (0 at the top, 1 at the bottom) and how far through the move (0..1) — so a fast
 * stroke across six strings sounds them one after another, as a hand does, rather than at once.
 */
export function crossings(
  strings: readonly HarpString[],
  a: readonly [number, number],
  b: readonly [number, number],
): { i: number; where: number; t: number }[] {
  const out: { i: number; where: number; t: number }[] = []
  const dx = b[0] - a[0]
  if (dx === 0) return out
  strings.forEach((s, i) => {
    // crossed: one end strictly before the string, the other on or past it
    if ((a[0] < s.x && b[0] >= s.x) || (a[0] > s.x && b[0] <= s.x)) {
      const t = (s.x - a[0]) / dx
      const y = a[1] + (b[1] - a[1]) * t
      if (y >= s.top && y <= s.bottom) out.push({ i, where: (y - s.top) / (s.bottom - s.top), t })
    }
  })
  return out.sort((p, q) => p.t - q.t)
}

/** the string nearest a tap, if it is within `reach` pixels, and where along it */
export function nearest(strings: readonly HarpString[], x: number, y: number, reach: number) {
  let best = -1
  let gap = reach
  strings.forEach((s, i) => {
    const d = Math.abs(s.x - x)
    if (d <= gap && y >= s.top && y <= s.bottom) {
      gap = d
      best = i
    }
  })
  return best < 0
    ? null
    : { i: best, where: (y - strings[best].top) / (strings[best].bottom - strings[best].top) }
}

/**
 * A plucked string's modes: pulled aside at `where` into a triangle of height 1 and let go, mode n
 * starts with amplitude 2·sin(nπ·where) / (n²π²·where·(1 − where)). Plucked in the middle, the
 * even modes vanish (a round, hollow tone); near the end, the high ones are strong (a bright,
 * thin one) — which is what a harpist does with where they pluck. Mirrored in harp.wgsl.
 */
export function modeAmp(n: number, where: number): number {
  const p = Math.min(0.98, Math.max(0.02, where))
  return (2 * Math.sin(n * Math.PI * p)) / (n * n * Math.PI * Math.PI * p * (1 - p))
}

/** The string's shape at `s` (0..1 along it), `since` seconds after a pluck. Mirrored in harp.wgsl. */
export function displacement(pl: Pluck, s: number, since: number, midi: number): number {
  const w = visualFrequency(midi) * 2 * Math.PI
  let y = 0
  for (let n = 1; n <= MODES; n++)
    y +=
      modeAmp(n, pl.where) *
      Math.sin(n * Math.PI * s) *
      Math.cos(n * w * since) *
      Math.exp(-DECAY * n * since)
  return y * pl.amp
}

/**
 * ⚠️ HOW FAST A STRING IS SEEN TO SWING IS NOT HOW FAST IT SOUNDS. A 220Hz string drawn at 220Hz
 * is a blur on a 60Hz screen. So it swings a few times a second — faster for higher notes, by a
 * gentle octave per two octaves — slow enough to see the shape travel.
 */
export const visualFrequency = (midi: number) => 2.2 * Math.pow(2, (midi - 60) / 24)
/** how fast the lowest mode dies; mode n dies n times faster, so a pluck's sharp corner rounds off first */
export const DECAY = 0.9

export const INSTRUMENT_IDS = ['harp', 'koto', 'pluck', 'kalimba'] as const
export type HarpVoice = (typeof INSTRUMENT_IDS)[number]
export const TUNINGS = { penta: 'Pentatonic', minorPenta: 'Minor', hirajoshi: 'Hirajoshi' } as const
export type Tuning = keyof typeof TUNINGS

export type HarpFrame = { w: number; h: number; time: number; count: number; width: number }

export function packHarp(p: HarpFrame, into = new ArrayBuffer(HARP.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[0] = p.w
  u[1] = p.h
  f[HARP.time / 4] = p.time
  u[HARP.count / 4] = p.count
  f[HARP.width / 4] = p.width
  u[HARP.modes / 4] = MODES
  return into
}

export function packStrings(
  strings: readonly HarpString[],
  plucks: readonly Pluck[],
): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_STRINGS * STRING_FLOATS)
  strings.slice(0, MAX_STRINGS).forEach((s, i) => {
    const pl = plucks[i] ?? { at: -1e3, where: 0.5, amp: 0 }
    f.set([s.x, s.top, s.bottom, s.midi, pl.at, pl.where, pl.amp, 0], i * STRING_FLOATS)
  })
  return f
}

/**
 * What ✨ Play plays by itself: rolled chords up and down the strings, now and then a run — a
 * list of (seconds from now, string) to pluck. Seeded, so the same seed plays the same phrase.
 */
export function phrase(count: number, seed: number): { t: number; i: number }[] {
  let x = seed >>> 0 || 1
  const rand = () =>
    ((x = Math.imul(x ^ (x >>> 15), 2246822519) ^ Math.imul(x ^ (x >>> 13), 3266489917)) >>> 0) /
    4294967296
  const out: { t: number; i: number }[] = []
  let t = 0
  for (let bar = 0; bar < 4; bar++) {
    const low = Math.floor(rand() * Math.max(1, count - 6))
    if (rand() < 0.7) {
      // a rolled chord: every other string, up, then the top back down
      for (const k of [0, 2, 4, 6]) out.push({ t: (t += 0.09), i: Math.min(count - 1, low + k) })
      t += 0.35
      out.push({ t: (t += 0.2), i: Math.min(count - 1, low + 4) })
      t += 0.3
    } else {
      // a run up the strings
      for (let k = 0; k < 6; k++) out.push({ t: (t += 0.12), i: Math.min(count - 1, low + k) })
      t += 0.4
    }
  }
  return out
}
