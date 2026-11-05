/**
 * The arithmetic of the Lab's galaxy. Most of it lives in the shader — a star is worked out from
 * its own index — so this is the uniform, the counts on offer, and how a drag turns the view.
 */

/** Hand-packed to match `struct Galaxy` — galaxy.test.ts lays the struct out from the shader. */
export const GALAXY = {
  aspect: 0,
  time: 4,
  twist: 8,
  tilt: 12,
  turn: 16,
  size: 20,
  glow: 24,
  pulse: 28,
  kick: 32,
  count: 36,
  bytes: 40,
} as const

export type GalaxyParams = {
  aspect: number
  time: number
  twist: number
  tilt: number
  turn: number
  size: number
  glow: number
  pulse: number
  kick: number
  count: number
}

export function packGalaxy(p: GalaxyParams, into = new ArrayBuffer(GALAXY.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  for (const k of [
    'aspect',
    'time',
    'twist',
    'tilt',
    'turn',
    'size',
    'glow',
    'pulse',
    'kick',
  ] as const)
    f[GALAXY[k] / 4] = p[k]
  u[GALAXY.count / 4] = p.count
  return into
}

/** stars on offer; a touch-only device stops at the middle one, as the swarm's do */
export const STAR_COUNTS = [1 << 16, 1 << 17, 1 << 18] as const
export const STAR_TOUCH_CEILING = 1 << 17

/** the view can tilt from face on to nearly edge on, never past: edge on is a line */
export const MAX_TILT = 1.35

/**
 * A drag, as a change of view: across turns the galaxy about its axis, down tilts it away. A drag
 * the canvas's full width turns it once round; its full height tilts it from face on to MAX_TILT.
 */
export function dragView(
  view: { turn: number; tilt: number },
  dxCss: number,
  dyCss: number,
  width: number,
  height: number,
): { turn: number; tilt: number } {
  return {
    turn: view.turn + (dxCss / width) * Math.PI * 2,
    tilt: Math.min(MAX_TILT, Math.max(0, view.tilt + (dyCss / height) * MAX_TILT)),
  }
}
