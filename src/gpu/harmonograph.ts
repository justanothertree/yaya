/**
 * The arithmetic of the Lab's harmonograph: a Victorian drawing machine, pendulums swinging a pen
 * over paper, the figure fading inwards as they slow.
 *
 * ⚠️ THE GPU DRAWS THE LINE ITSELF, NOT THE RASTERISER. Each frame the pen moves through thousands of
 * short segments, and a compute pass gives every segment a thread that walks its own pixels and ADDS
 * ink into an integer buffer with atomicAdd — splitting each step's ink between the four pixels round
 * it, so the line is smooth. Integers, so the order threads add in cannot change a total: the GPU's
 * paper can be held to this file's exactly. Ink builds up where the pen crosses its own path, and the
 * last pass turns how much ink each pixel holds into colour. `pen` is where the pen is; `inkSegment`
 * is a thread's walk; harmonograph.test.ts checks that no ink is lost or made and no pixel skipped.
 */

/** Hand-packed to match `struct Draw` — harmonograph.test.ts lays the struct out from the shader. */
export const DRAW = {
  size: 0,
  paper: 8,
  first: 16,
  dt: 20,
  segments: 24,
  colour: 28,
  freq: 32,
  phase: 48,
  amp: 64,
  decay: 80,
  bytes: 96,
} as const

/** ink a full step of the pen lays, in the fixed point the buffer counts in */
export const INK = 256
/** the longest a segment may be, pixels: the pen moves far less than this a sample */
export const MAX_STEPS = 64

/**
 * Four pendulums: two swing the pen across (x), two swing it up and down (y). Frequencies in
 * radians a second, phases, amplitudes (fractions of the paper's half-size), decays a second.
 */
export type Pendulums = {
  freq: readonly [number, number, number, number]
  phase: readonly [number, number, number, number]
  amp: readonly [number, number, number, number]
  decay: readonly [number, number, number, number]
}

/** where the pen is at time t, in paper pixels about the middle — mirrored in harmonograph.wgsl */
export function pen(p: Pendulums, t: number, half: number): [number, number] {
  const s = (k: number) =>
    p.amp[k] * Math.sin(p.freq[k] * t + p.phase[k]) * Math.exp(-p.decay[k] * t)
  return [(s(0) + s(1)) * half, (s(2) + s(3)) * half]
}

/**
 * The ink one segment lays, from a to b (paper pixels), as the shader lays it: a step per pixel of
 * its longer side, each step's INK shared between the four pixels round the point by how near each
 * is — and the four shares made to add up to INK exactly, whatever the rounding. Calls `add` for each
 * pixel and amount.
 */
export function inkSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  add: (x: number, y: number, ink: number) => void,
) {
  const steps = Math.min(
    MAX_STEPS,
    Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])))),
  )
  for (let k = 0; k < steps; k++) {
    // the middle of each step, so a segment and the next do not both ink their shared end
    const t = (k + 0.5) / steps
    const x = a[0] + (b[0] - a[0]) * t - 0.5
    const y = a[1] + (b[1] - a[1]) * t - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const w10 = Math.floor(INK * fx * (1 - fy))
    const w01 = Math.floor(INK * (1 - fx) * fy)
    const w11 = Math.floor(INK * fx * fy)
    // the first pixel takes whatever rounding left, so every step lays INK exactly
    const w00 = INK - w10 - w01 - w11
    add(x0, y0, w00)
    add(x0 + 1, y0, w10)
    add(x0, y0 + 1, w01)
    add(x0 + 1, y0 + 1, w11)
  }
  return steps
}

/** the ratios offered: a musical interval each, and the pendulums' frequencies in that ratio */
export const RATIOS = {
  unison: { name: '1:1', ratio: [1, 1] },
  octave: { name: '1:2', ratio: [1, 2] },
  fifth: { name: '2:3', ratio: [2, 3] },
  fourth: { name: '3:4', ratio: [3, 4] },
  sixth: { name: '3:5', ratio: [3, 5] },
} as const
export type RatioId = keyof typeof RATIOS

/** the swing: how fast a pendulum of ratio 1 goes, radians a second */
export const BASE = 2.2

/**
 * Pendulums for a ratio, a detune (fraction), a fade (decays a second) and a flick — the flick's
 * direction sets the phases and its strength the swing.
 */
export function pendulumsFor(
  ratio: RatioId,
  detune: number,
  fade: number,
  flick: readonly [number, number],
): Pendulums {
  const [a, b] = RATIOS[ratio].ratio
  const strength = Math.min(1, Math.hypot(...flick))
  const angle = Math.atan2(flick[1], flick[0])
  /* ⚠️ ONE FREQUENCY ACROSS AND THE OTHER UP AND DOWN, as a lateral harmonograph is built. The first
     version gave each axis a share of both, so x and y moved nearly together and every figure was a
     spiral squashed along a diagonal. Each axis has a second, smaller pendulum a little off its
     main one's speed — the detune — which is what makes the figure turn as it fades. The flick's
     direction is the phase between across and up-and-down, and the phase is the shape. */
  const amp = 0.88 * (0.4 + 0.6 * strength)
  return {
    freq: [BASE * a, BASE * a * (1 + detune), BASE * b, BASE * b * (1 - detune)],
    phase: [0, angle * 0.5, angle, angle * 1.5 + 0.4],
    amp: [amp * 0.78, amp * 0.22, amp * 0.78, amp * 0.22],
    decay: [fade, fade * 1.4, fade, fade * 1.2],
  }
}

/** the musical interval a ratio sounds, in semitones above its lower note */
export const semitones = (ratio: RatioId) => {
  const [a, b] = RATIOS[ratio].ratio
  return Math.round(12 * Math.log2(b / a))
}

export type DrawFrame = {
  w: number
  h: number
  paper: readonly [number, number]
  first: number
  dt: number
  segments: number
  /** the ink's colour, 0xRRGGBB */
  colour: number
  pendulums: Pendulums
}

export function packDraw(p: DrawFrame, into = new ArrayBuffer(DRAW.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[DRAW.paper / 4] = p.paper[0]
  u[DRAW.paper / 4 + 1] = p.paper[1]
  f[DRAW.first / 4] = p.first
  f[DRAW.dt / 4] = p.dt
  u[DRAW.segments / 4] = p.segments
  u[DRAW.colour / 4] = p.colour
  f.set(p.pendulums.freq, DRAW.freq / 4)
  f.set(p.pendulums.phase, DRAW.phase / 4)
  f.set(p.pendulums.amp, DRAW.amp / 4)
  f.set(p.pendulums.decay, DRAW.decay / 4)
  return into
}

/**
 * How a step's ink is split into colour: each of red, green and blue gets ink × byte / 255, in
 * integers, and the fourth channel the ink itself — mirrored in harmonograph.wgsl, so the totals
 * stay exact.
 */
export function inkChannels(ink: number, colour: number): [number, number, number, number] {
  const r = (colour >> 16) & 255
  const g = (colour >> 8) & 255
  const b = colour & 255
  return [
    Math.floor((ink * r) / 255),
    Math.floor((ink * g) / 255),
    Math.floor((ink * b) / 255),
    ink,
  ]
}

/** the inks a drawing comes in, one after another */
export const INKS = [0x1f3a93, 0xb0302a, 0x1d7a4f, 0x6b2d8a, 0xc0781a, 0x0f6f80] as const
