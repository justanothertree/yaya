/**
 * The arithmetic of the Lab's fluid painting, kept out of the GPU code so it can be checked
 * without one. See fluid.wgsl for the conventions every number here follows.
 */

/** Hand-packed to match `struct Fluid` — fluid.test.ts lays the struct out from the shader. */
export const FLUID = {
  texel: 0,
  dye_texel: 8,
  point: 16,
  force: 24,
  color: 32,
  aspect: 48,
  radius: 52,
  dt: 56,
  swirl: 60,
  vel_decay: 64,
  dye_decay: 68,
  bytes: 80,
} as const

export type FluidParams = {
  texel: readonly [number, number]
  dyeTexel: readonly [number, number]
  point: readonly [number, number]
  force: readonly [number, number]
  color: readonly [number, number, number]
  /** how much of the colour covers what is there, at the splat's centre */
  ink: number
  aspect: number
  radius: number
  dt: number
  swirl: number
  velDecay: number
  dyeDecay: number
}

export function packFluid(p: FluidParams, into = new ArrayBuffer(FLUID.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const put = (at: number, ...v: readonly number[]) => f.set(v, at / 4)
  put(FLUID.texel, ...p.texel)
  put(FLUID.dye_texel, ...p.dyeTexel)
  put(FLUID.point, ...p.point)
  put(FLUID.force, ...p.force)
  put(FLUID.color, ...p.color, p.ink)
  put(FLUID.aspect, p.aspect)
  put(FLUID.radius, p.radius)
  put(FLUID.dt, p.dt)
  put(FLUID.swirl, p.swirl)
  put(FLUID.vel_decay, p.velDecay)
  put(FLUID.dye_decay, p.dyeDecay)
  return into
}

/** texels along the long side of each grid — the velocity is coarse, the dye is what you see */
export const SIM_LONG = 192
export const DYE_LONG = 768

/**
 * A grid of square cells with `long` along the canvas's longer side. Square cells are what lets
 * the shaders treat a step across and a step down as the same distance.
 */
export function gridSize(width: number, height: number, long: number) {
  const aspect = width / height
  return aspect >= 1
    ? { w: long, h: Math.max(1, Math.round(long / aspect)) }
    : { w: Math.max(1, Math.round(long * aspect)), h: long }
}

/**
 * The force a drag adds, in sim texels per second: the pointer's own velocity, carried over from
 * CSS pixels to sim texels, and capped so a flick cannot blow the field up in one frame.
 */
export const MAX_FORCE = 2000
export function dragForce(
  dxCss: number,
  dyCss: number,
  dtSec: number,
  cssWidth: number,
  simWidth: number,
  gain = 6,
): readonly [number, number] {
  if (dtSec <= 0) return [0, 0]
  const k = (simWidth / cssWidth / dtSec) * gain
  let fx = dxCss * k
  let fy = dyCss * k
  const len = Math.hypot(fx, fy)
  if (len > MAX_FORCE) {
    fx *= MAX_FORCE / len
    fy *= MAX_FORCE / len
  }
  return [fx, fy]
}

/** HSV with full saturation and value, to RGB in 0..1: the rainbow a stroke cycles through */
export function hue(h: number): [number, number, number] {
  const k = (n: number) => (n + h * 6) % 6
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)]
}

/** a splat's size: a fraction of the screen's height, squared, as `dab` in the shader wants it */
export const splatRadius = (fractionOfHeight: number) => fractionOfHeight * fractionOfHeight

/**
 * A press that barely moved and was soon let go is a tap, not a drag. 8 CSS px is a finger's own
 * wobble; 300 ms is longer than any tap and shorter than a deliberate hold.
 */
export const isTap = (movedCss: number, heldMs: number) => movedCss < 8 && heldMs < 300

/**
 * A tap's blossom: `n` splats at one point, pushing outward evenly round the circle, so the
 * colour opens like a flower rather than streaking one way. Their pushes cancel — a blossom
 * spreads colour without setting the pool drifting.
 */
export function bloom(
  point: readonly [number, number],
  color: readonly [number, number, number],
  n = 6,
  push = 600,
): {
  point: readonly [number, number]
  force: [number, number]
  color: readonly [number, number, number]
  ink: number
}[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return { point, force: [Math.cos(a) * push, Math.sin(a) * push], color, ink: 0.9 }
  })
}
