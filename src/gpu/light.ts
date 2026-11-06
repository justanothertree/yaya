/**
 * The arithmetic of the Lab's light room: the shapes, their distance functions, hit-testing, and
 * the scenes it opens with. light-bake.wgsl writes the same distances into a texture; the probe
 * checks the two agree texel by texel.
 *
 * World: y up, x from -aspect to aspect, y from -1 to 1 — as the cloth.
 */

/** Hand-packed to match `struct Light` — light.test.ts lays the struct out from the shader. */
export const LIGHT = {
  size: 0,
  aspect: 8,
  count: 12,
  frame: 16,
  rays: 20,
  exposure: 24,
  blend: 28,
  bytes: 32,
} as const

export const MAX_SHAPES = 16
/** each shape is three vec4f in the shapes buffer */
export const SHAPE_FLOATS = 12

export type Kind = 'lamp' | 'disc' | 'box'
export type Shape = {
  kind: Kind
  x: number
  y: number
  /** a lamp's or disc's radius; a box's half-width */
  r: number
  /** a box's half-height */
  h: number
  angle: number
  /** a lamp's colour, linear rgb */
  colour: readonly [number, number, number]
  /** a lamp's brightness */
  power: number
}

const KIND_ID: Record<Kind, number> = { lamp: 0, disc: 1, box: 2 }

/** The signed distance from p to one shape: negative inside. Mirrored in light-bake.wgsl. */
export function sdf(s: Shape, px: number, py: number): number {
  const dx = px - s.x
  const dy = py - s.y
  if (s.kind !== 'box') return Math.hypot(dx, dy) - s.r
  // into the box's own frame, then Inigo Quilez's box distance
  const c = Math.cos(s.angle)
  const sn = Math.sin(s.angle)
  const lx = Math.abs(c * dx + sn * dy) - s.r
  const ly = Math.abs(-sn * dx + c * dy) - s.h
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(Math.max(lx, ly), 0)
}

/** the nearest surface to p, and the light it gives if it is a lamp */
export function scene(shapes: readonly Shape[], px: number, py: number) {
  let d = 1e9
  let emit: readonly [number, number, number] = [0, 0, 0]
  for (const s of shapes) {
    const e = sdf(s, px, py)
    if (e < d) {
      d = e
      emit =
        s.kind === 'lamp'
          ? [s.colour[0] * s.power, s.colour[1] * s.power, s.colour[2] * s.power]
          : [0, 0, 0]
    }
  }
  return { d, emit }
}

/** which shape a finger is on — the last drawn wins, as it looks topmost — or -1 */
export function hitTest(shapes: readonly Shape[], px: number, py: number, slack = 0.03): number {
  for (let i = shapes.length - 1; i >= 0; i--) if (sdf(shapes[i], px, py) < slack) return i
  return -1
}

export function packShapes(shapes: readonly Shape[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_SHAPES * SHAPE_FLOATS)
  shapes.slice(0, MAX_SHAPES).forEach((s, i) => {
    f.set(
      [s.x, s.y, s.r, s.h, ...s.colour, s.power, s.angle, KIND_ID[s.kind], 0, 0],
      i * SHAPE_FLOATS,
    )
  })
  return f
}

/** lamp colours, offered in turn */
export const LAMP_COLOURS: readonly (readonly [number, number, number])[] = [
  [1, 0.55, 0.2],
  [0.25, 0.55, 1],
  [1, 0.2, 0.45],
  [0.3, 1, 0.45],
  [1, 0.9, 0.7],
  [0.7, 0.3, 1],
]

export const lamp = (x: number, y: number, i: number, r = 0.07): Shape => ({
  kind: 'lamp',
  x,
  y,
  r,
  h: 0,
  angle: 0,
  colour: LAMP_COLOURS[i % LAMP_COLOURS.length],
  power: 2.2,
})
const disc = (x: number, y: number, r: number): Shape => ({
  kind: 'disc',
  x,
  y,
  r,
  h: 0,
  angle: 0,
  colour: [0, 0, 0],
  power: 0,
})
export const box = (x: number, y: number, r: number, h: number, angle = 0): Shape => ({
  kind: 'box',
  x,
  y,
  r,
  h,
  angle,
  colour: [0, 0, 0],
  power: 0,
})

/** rooms to start from, fitted to the canvas's shape */
export const SCENES = {
  pillars: {
    name: 'Pillars',
    make: (a: number): Shape[] => [
      lamp(-a * 0.55, 0.35, 0),
      lamp(a * 0.55, -0.3, 1),
      disc(-a * 0.12, 0.1, 0.13),
      disc(a * 0.2, -0.25, 0.09),
      box(0.05 * a, 0.55, 0.22, 0.04, 0.4),
    ],
  },
  mixing: {
    name: 'Mixing',
    // red, green and blue round one pillar: where two shadows overlap, the third colour remains
    make: (a: number): Shape[] => [
      lamp(-a * 0.5, 0.5, 2, 0.06),
      lamp(a * 0.5, 0.5, 3, 0.06),
      lamp(0, -0.7, 1, 0.06),
      disc(0, 0.1, 0.16),
    ],
  },
  window: {
    name: 'Window',
    // one lamp behind a wall with slits in it: beams fan out across the room
    make: (a: number): Shape[] => {
      const out: Shape[] = [lamp(-a * 0.75, 0, 4, 0.1)]
      for (let k = -3; k <= 3; k++) out.push(box(-a * 0.4, k * 0.27, 0.025, 0.1))
      out.push(disc(a * 0.35, 0.25, 0.1))
      return out
    },
  },
} as const
export type SceneId = keyof typeof SCENES
export const SCENE_IDS = Object.keys(SCENES) as SceneId[]

/** a lamp drifting: each wanders its own slow loop round where it was put */
export function drifted(s: Shape, i: number, t: number): Shape {
  if (s.kind !== 'lamp') return s
  return {
    ...s,
    x: s.x + 0.12 * Math.sin(t * 0.6 + i * 2.1),
    y: s.y + 0.1 * Math.cos(t * 0.45 + i * 1.3),
  }
}

export const toWorld = (px: number, py: number, w: number, h: number): [number, number] => {
  const aspect = w / h
  return [(px / w) * 2 * aspect - aspect, 1 - (py / h) * 2]
}

export type LightFrame = {
  w: number
  h: number
  count: number
  frame: number
  rays: number
  exposure: number
  /** how much of this frame's sample goes into the picture: 1/(frame + 1) at rest, more when moving */
  blend: number
}

export function packLight(p: LightFrame, into = new ArrayBuffer(LIGHT.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[0] = p.w
  u[1] = p.h
  f[LIGHT.aspect / 4] = p.w / p.h
  u[LIGHT.count / 4] = p.count
  u[LIGHT.frame / 4] = p.frame
  u[LIGHT.rays / 4] = p.rays
  f[LIGHT.exposure / 4] = p.exposure
  f[LIGHT.blend / 4] = p.blend
  return into
}

/**
 * How much of a new frame's light to take. At rest, an exact running average — frame n counts
 * 1/(n+1), so after n frames every frame has counted the same and the noise falls as 1/√n. While
 * anything moves, at least a fifth: an average over all time would smear a moving lamp's light
 * across everywhere it has been.
 */
export const blendFor = (frame: number, moving: boolean) =>
  moving ? Math.max(0.2, 1 / (frame + 1)) : 1 / (frame + 1)
