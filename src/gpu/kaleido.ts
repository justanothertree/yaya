/**
 * The arithmetic of the Lab's kaleidoscope. See kaleido.wgsl for the centred coordinates every
 * point here is in.
 */

/** Hand-packed to match `struct Kaleido` — kaleido.test.ts lays the struct out from the shader. */
export const KALEIDO = {
  a: 0,
  b: 8,
  color: 16,
  aspect: 32,
  radius: 36,
  fade: 40,
  n: 44,
  mirror: 48,
  drawing: 52,
  bytes: 64,
} as const

export type KaleidoParams = {
  a: readonly [number, number]
  b: readonly [number, number]
  color: readonly [number, number, number]
  aspect: number
  radius: number
  fade: number
  n: number
  mirror: boolean
  drawing: boolean
}

export function packKaleido(p: KaleidoParams, into = new ArrayBuffer(KALEIDO.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.set(p.a, KALEIDO.a / 4)
  f.set(p.b, KALEIDO.b / 4)
  f.set([...p.color, 1], KALEIDO.color / 4)
  f[KALEIDO.aspect / 4] = p.aspect
  f[KALEIDO.radius / 4] = p.radius
  f[KALEIDO.fade / 4] = p.fade
  u[KALEIDO.n / 4] = p.n
  u[KALEIDO.mirror / 4] = p.mirror ? 1 : 0
  u[KALEIDO.drawing / 4] = p.drawing ? 1 : 0
  return into
}

/** the symmetries on offer: a square, a snowflake, a compass rose, a clock */
export const SYMMETRIES = [4, 6, 8, 12] as const

/** A point on the canvas in centred units: (0, 0) the middle, y from -0.5 at the top to 0.5. */
export function toCentred(
  px: number,
  py: number,
  width: number,
  height: number,
): readonly [number, number] {
  return [(px / width - 0.5) * (width / height), py / height - 0.5]
}

/**
 * How much of the painting survives a frame `dt` seconds long, if `keep` of it survives a whole
 * second. Per second rather than per frame, so a phone at 30 fps and a desktop at 120 fade alike.
 */
export const fadeFor = (keep: number, dt: number) => (keep >= 1 ? 1 : keep ** dt)

/**
 * The doodle that draws itself: a rose curve wandering out from the middle, at `t` seconds into a
 * doodle that lasts `DOODLE_SECONDS`. Every doodle is a little different (`seed`), and every one
 * stays well inside the screen's height so no wedge loses its end off an edge.
 */
export const DOODLE_SECONDS = 2.4
export function doodle(t: number, seed: number): readonly [number, number] {
  const k = 2 + (seed % 5) // petals
  const turn = (seed * 0.618) % 1
  const a = (t / DOODLE_SECONDS) * Math.PI * 2 + turn * Math.PI * 2
  const r = 0.36 * Math.abs(Math.cos(k * a * 0.5)) * Math.min(1, t / 0.4 + 0.15)
  return [r * Math.cos(a), r * Math.sin(a)]
}
