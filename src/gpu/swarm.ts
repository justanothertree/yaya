/**
 * The arithmetic of the Lab's particle swarm, kept out of the GPU code so it can be asked a
 * question without a GPU — the same reason the park's physics lives in play.ts.
 *
 * Everything here is pure. What talks to a device is swarmEngine.ts; what talks to React is
 * SwarmDemo.tsx.
 */

/** pos.xy + vel.xy as f32, matching `struct Particle` in swarm-types.wgsl */
export const PARTICLE_BYTES = 16

/** must equal `@workgroup_size` on both compute entry points — swarm.test.ts reads it back out */
export const WORKGROUP = 64

/**
 * ⚠️ THE OFFSETS ARE WGSL'S, NOT JAVASCRIPT'S. A uniform struct is laid out by the shader's
 * alignment rules — a vec2f sits on an 8-byte boundary and the struct's size rounds up to its
 * largest member — so this table is hand-written to match `struct Params`, and swarm.test.ts
 * re-derives it from the shader source rather than from this table.
 */
export const PARAMS = {
  pointer: 0,
  aspect: 8,
  dt: 12,
  time: 16,
  flow: 20,
  pull: 24,
  size: 28,
  glow: 32,
  count: 36,
  palette: 40,
  bytes: 48,
} as const

export type Params = {
  pointer: readonly [number, number]
  aspect: number
  dt: number
  time: number
  flow: number
  pull: number
  size: number
  glow: number
  count: number
  palette: number
}

/** Write `p` into `into` (reused each frame, so the loop allocates nothing). */
export function packParams(p: Params, into = new ArrayBuffer(PARAMS.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f[PARAMS.pointer / 4] = p.pointer[0]
  f[PARAMS.pointer / 4 + 1] = p.pointer[1]
  f[PARAMS.aspect / 4] = p.aspect
  f[PARAMS.dt / 4] = p.dt
  f[PARAMS.time / 4] = p.time
  f[PARAMS.flow / 4] = p.flow
  f[PARAMS.pull / 4] = p.pull
  f[PARAMS.size / 4] = p.size
  f[PARAMS.glow / 4] = p.glow
  u[PARAMS.count / 4] = p.count
  u[PARAMS.palette / 4] = p.palette
  return into
}

/** The counts on offer. Powers of two, so each step is the same multiple of the last. */
export const COUNTS = [1 << 15, 1 << 17, 1 << 19, 1 << 21] as const
export const DEFAULT_COUNT = 1 << 17

/** Workgroups needed to give every particle one invocation. */
export const workgroupsFor = (count: number) => Math.ceil(count / WORKGROUP)

type CountLimits = Pick<
  GPUSupportedLimits,
  'maxStorageBufferBindingSize' | 'maxBufferSize' | 'maxComputeWorkgroupsPerDimension'
>

/**
 * The most a touch-only device is offered.
 *
 * ⚠️ A PHONE CAN HOLD 2M AND STILL LOSE THE DEVICE DOING IT. Its limits say the buffer fits and
 * the dispatch launches, and neither says anything about how long a frame takes: a weak mobile GPU
 * that cannot finish a frame in time is reset by the OS, which reaches this room as a lost device.
 * Touch-only is a rough proxy for "may be a weak GPU", and getting it wrong costs one button.
 */
export const TOUCH_CEILING = 1 << 19

/**
 * The counts this device can actually hold, at most `ceiling`.
 *
 * ⚠️ PASS THE DEVICE'S LIMITS, NOT THE ADAPTER'S. The adapter's say what it COULD grant; a device
 * requested without `requiredLimits` gets the spec defaults, and those are what any buffer or
 * dispatch is checked against. Every count fits the defaults today, which is exactly why asking
 * the adapter would go on looking right until somebody added a bigger one.
 *
 * ⚠️ TWO DIFFERENT CEILINGS, and the second is the one that is easy to forget. The buffer has to
 * fit, and so does the DISPATCH: one dimension of workgroups stops at 65,535 by default, which at
 * 64 a group is 4,194,240 particles — so 4M (2²²) would fit in memory and fail to launch.
 */
export function countsFor(limits: CountLimits, ceiling = Infinity): number[] {
  const bytes = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize)
  return COUNTS.filter(
    (n) =>
      n <= ceiling &&
      n * PARTICLE_BYTES <= bytes &&
      workgroupsFor(n) <= limits.maxComputeWorkgroupsPerDimension,
  )
}

/** "128K" for 131,072 — binary thousands, since every count is a power of two */
export function countLabel(n: number): string {
  return n >= 1 << 20 ? `${n / (1 << 20)}M` : `${n / 1024}K`
}

/**
 * Seconds to advance for one frame.
 *
 * ⚠️ CLAMPED, because a frame is not always a sixtieth of a second. Come back to a tab after a
 * minute and the first frame's gap is sixty seconds: integrated in one step, every particle would
 * be carried clean off the field at full speed and the swarm would arrive as noise.
 */
export function stepSeconds(prevMs: number | null, nowMs: number): number {
  if (prevMs === null) return 0
  return Math.min(Math.max((nowMs - prevMs) / 1000, 0), 1 / 30)
}

/**
 * A point on the canvas, in the world the shader simulates: y spans -1 (bottom) to 1 (top), x
 * spans ±aspect, so a unit is the same distance across as it is up.
 */
export function toWorld(
  px: number,
  py: number,
  width: number,
  height: number,
): readonly [number, number] {
  const aspect = width / height
  return [((px / width) * 2 - 1) * aspect, 1 - (py / height) * 2]
}

/**
 * A dot's half-width in clip units, for a dot `devicePx` device pixels across on a canvas
 * `heightPx` device pixels tall. Clip space is 2 units tall, so a pixel is 2/height of it and
 * half of `devicePx` pixels is devicePx/height.
 */
export const dotSize = (devicePx: number, heightPx: number) => devicePx / heightPx

/** How many device pixels across a dot is drawn: two CSS pixels, never under one and a half. */
export const dotPixels = (dpr: number) => Math.max(1.5, 2 * dpr)

/**
 * Per-dot brightness, so the field reads about as bright at two million as at thirty thousand.
 *
 * Dots add together, so the screen's average is roughly count × a dot's lit area × glow ÷ the
 * screen's area. Hold that near `MEAN` and solve for glow — then cap it at 1, because a sparse
 * swarm should look sparse rather than be inflated into blobs, and floor it, because past a point
 * dimmer dots stop reading as anything at all.
 */
export const MEAN = 0.35
export function glowFor(count: number, devicePx: number, screenPx: number): number {
  // a dot's falloff is (1 - r²)², which integrates to a third of its disc
  const litArea = (Math.PI * (devicePx / 2) ** 2) / 3
  const glow = (MEAN * screenPx) / (count * litArea)
  return Math.min(1, Math.max(0.03, glow))
}
