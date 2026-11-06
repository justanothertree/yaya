/**
 * The arithmetic of the Lab's film studio: a small scene of posable actors, props and lights on a
 * studio floor, a camera to frame it, and everything needed to keep a scene — as data, checked
 * on the way back in.
 *
 * ⚠️ THE PICTURE IS PATH TRACED ON THE GPU, AND THIS FILE IS WHAT IT IS GIVEN. A scene here is a
 * handful of objects; `primitives` turns them into the spheres, boxes and capsules the shader
 * intersects (an actor is a dozen capsules posed from its skeleton). The same intersection maths
 * runs here for picking — what is under a finger — and studio.test.ts holds it to the shapes'
 * definitions; the GPU probe asks the shader which object it saw at each pixel and compares.
 */

export type V3 = [number, number, number]
export type RGB = [number, number, number]

export const MATERIALS = ['matte', 'gloss', 'metal', 'glow'] as const
export type Material = (typeof MATERIALS)[number]
export const POSES = ['stand', 'wave', 'cheer', 'walk', 'sit', 'point', 'think'] as const
export type Pose = (typeof POSES)[number]
export type Kind = 'actor' | 'box' | 'ball'

export type Thing = {
  kind: Kind
  /** where it stands on the floor */
  x: number
  z: number
  /** which way it faces, radians */
  turn: number
  /** a box's or a ball's size, an actor's height scale */
  size: number
  colour: RGB
  material: Material
  pose: Pose
}
export type Lamp = { x: number; y: number; z: number; colour: RGB; power: number }
export type Camera = {
  /** orbit round the target: yaw and pitch in radians, distance in metres */
  yaw: number
  pitch: number
  distance: number
  /** focal length, mm on a full-frame sensor */
  lens: number
  /** f-stop: small is a shallow focus */
  fstop: number
  /** metres from the camera that are sharp */
  focus: number
  target: V3
}
export type Scene = {
  things: Thing[]
  lamps: Lamp[]
  camera: Camera
  floor: RGB
  sky: RGB
}

export const MAX_THINGS = 12
export const MAX_LAMPS = 3
export const MAX_PRIMS = 160
/** the back wall's plane, z = WALL */
export const WALL = -6

export const SWATCHES: Record<string, RGB> = {
  chalk: [0.85, 0.85, 0.82],
  coal: [0.08, 0.08, 0.09],
  tomato: [0.85, 0.22, 0.15],
  marigold: [0.95, 0.65, 0.12],
  leaf: [0.25, 0.6, 0.25],
  sky: [0.25, 0.55, 0.9],
  plum: [0.5, 0.2, 0.55],
  blush: [0.95, 0.6, 0.65],
}

export const DEFAULT_SCENE: Scene = {
  things: [
    {
      kind: 'actor',
      x: -0.9,
      z: 0,
      turn: 0.5,
      size: 1,
      colour: SWATCHES.tomato,
      material: 'matte',
      pose: 'wave',
    },
    {
      kind: 'actor',
      x: 0.9,
      z: -0.4,
      turn: -0.6,
      size: 0.9,
      colour: SWATCHES.sky,
      material: 'matte',
      pose: 'think',
    },
    {
      kind: 'ball',
      x: 0.2,
      z: 1,
      turn: 0,
      size: 0.35,
      colour: SWATCHES.marigold,
      material: 'gloss',
      pose: 'stand',
    },
    {
      kind: 'box',
      x: 1.9,
      z: -1.6,
      turn: 0.4,
      size: 0.8,
      colour: SWATCHES.chalk,
      material: 'matte',
      pose: 'stand',
    },
  ],
  lamps: [
    { x: -3, y: 4, z: 3, colour: [1, 0.85, 0.7], power: 30 },
    { x: 4, y: 2.5, z: 1, colour: [0.5, 0.7, 1], power: 10 },
  ],
  camera: {
    yaw: 0.25,
    pitch: 0.18,
    distance: 6.5,
    lens: 40,
    fstop: 4,
    focus: 6.4,
    target: [0, 0.9, 0],
  },
  floor: [0.62, 0.6, 0.58],
  sky: [0.12, 0.13, 0.16],
}

/* ---------------------------------------------------------------- actors --------------------- */

/**
 * An actor's skeleton, in metres on a figure about 1.85 m tall facing +z, before its turn and size: the joint
 * positions for a pose. Arms and legs are two bones each; the body is a hip, a chest and a head.
 */
type Joints = Record<
  | 'hip'
  | 'chest'
  | 'head'
  | 'lElbow'
  | 'lHand'
  | 'rElbow'
  | 'rHand'
  | 'lKnee'
  | 'lFoot'
  | 'rKnee'
  | 'rFoot'
  | 'lShoulder'
  | 'rShoulder'
  | 'lHip'
  | 'rHip',
  V3
>

/** the length of every bone, which every pose must keep */
export const BONES: [keyof Joints, keyof Joints][] = [
  ['hip', 'chest'],
  ['lShoulder', 'lElbow'],
  ['lElbow', 'lHand'],
  ['rShoulder', 'rElbow'],
  ['rElbow', 'rHand'],
  ['lHip', 'lKnee'],
  ['lKnee', 'lFoot'],
  ['rHip', 'rKnee'],
  ['rKnee', 'rFoot'],
]
const UPPER_ARM = 0.3
const FOREARM = 0.28
const THIGH = 0.44
const SHIN = 0.44
const SPINE = 0.5

/** a joint at `len` from `from`, at angle `a` from straight down in the body's side plane and `b` forward */
function limb(from: V3, len: number, side: number, fwd: number): V3 {
  // side: rotation out to the side (+ is away from the body's middle, signed by the caller)
  // fwd: rotation forward (toward +z)
  return [
    from[0] + len * Math.sin(side) * Math.cos(fwd),
    from[1] - len * Math.cos(side) * Math.cos(fwd),
    from[2] + len * Math.sin(fwd),
  ]
}

/** the joints of a pose */
export function skeleton(pose: Pose): Joints {
  const sit = pose === 'sit'
  /* the feet's own radius above the floor, so a standing actor's soles rest on it */
  const hipY = sit ? 0.5 : THIGH + SHIN + 0.05 + 0.06
  const hip: V3 = [0, hipY, sit ? -0.1 : 0]
  // thinking leans forward a little: the spine turns, it does not stretch
  const lean = pose === 'think' ? 0.16 : 0
  const chest: V3 = [0, hipY + SPINE * Math.cos(lean), hip[2] + SPINE * Math.sin(lean)]
  const head: V3 = [0, chest[1] + 0.24, chest[2] + 0.24 * Math.sin(lean * 0.5)]
  const lShoulder: V3 = [-0.2, chest[1] - 0.02, chest[2]]
  const rShoulder: V3 = [0.2, chest[1] - 0.02, chest[2]]
  const lHip: V3 = [-0.1, hipY - 0.05, hip[2]]
  const rHip: V3 = [0.1, hipY - 0.05, hip[2]]
  // arms: [upper side, upper fwd, fore side, fore fwd] for left (side angles out are negative x)
  const arms: Record<Pose, [number, number, number, number, number, number, number, number]> = {
    stand: [0.12, 0, 0.1, 0.1, 0.12, 0, 0.1, 0.1],
    wave: [0.12, 0, 0.1, 0.15, 2.4, 0.2, 2.9, 0.1],
    cheer: [2.6, 0.2, 2.9, 0.1, 2.6, 0.2, 2.9, 0.1],
    walk: [0.1, -0.4, 0.1, -0.2, 0.1, 0.45, 0.1, 0.8],
    sit: [0.15, 0.5, 0.15, 1.1, 0.15, 0.5, 0.15, 1.1],
    point: [0.12, 0, 0.1, 0.1, 1.45, 1.2, 1.5, 1.25],
    think: [0.15, 0.3, 0.2, 2.4, 0.12, 0, 0.1, 0.1],
  }
  const legs: Record<Pose, [number, number, number, number]> = {
    stand: [0, 0, 0, 0],
    wave: [0, 0, 0, 0],
    cheer: [0, 0, 0, 0],
    walk: [0.45, 0.1, -0.35, -0.6],
    sit: [1.5, 0, 1.5, 0],
    point: [0.15, 0, -0.1, 0],
    think: [0, 0, 0, 0],
  }
  const a = arms[pose]
  const l = legs[pose]
  const lElbow = limb(lShoulder, UPPER_ARM, -a[0], a[1])
  const lHand = limb(lElbow, FOREARM, -a[2], a[3])
  const rElbow = limb(rShoulder, UPPER_ARM, a[4], a[5])
  const rHand = limb(rElbow, FOREARM, a[6], a[7])
  // legs swing forward (+z) by their first angle; the shin by the second, relative to straight down
  const lKnee = limb(lHip, THIGH, 0, l[0])
  const lFoot = limb(lKnee, SHIN, 0, l[1])
  const rKnee = limb(rHip, THIGH, 0, l[2])
  const rFoot = limb(rKnee, SHIN, 0, l[3])
  return {
    hip,
    chest,
    head,
    lShoulder,
    rShoulder,
    lHip,
    rHip,
    lElbow,
    lHand,
    rElbow,
    rHand,
    lKnee,
    lFoot,
    rKnee,
    rFoot,
  }
}

/* ---------------------------------------------------------------- primitives ----------------- */

export type Prim =
  | { kind: 'sphere'; c: V3; r: number }
  | { kind: 'box'; c: V3; half: V3; yaw: number }
  | { kind: 'capsule'; a: V3; b: V3; r: number }
export type Placed = Prim & { id: number; colour: RGB; material: Material }

const placeJoint = (t: Thing, p: V3): V3 => {
  const s = t.size
  const c = Math.cos(t.turn)
  const sn = Math.sin(t.turn)
  return [t.x + (p[0] * c + p[2] * sn) * s, p[1] * s, t.z + (-p[0] * sn + p[2] * c) * s]
}

/** what the shader draws for one thing */
export function shapes(t: Thing): Prim[] {
  if (t.kind === 'ball') return [{ kind: 'sphere', c: [t.x, t.size, t.z], r: t.size }]
  if (t.kind === 'box')
    return [
      {
        kind: 'box',
        c: [t.x, t.size / 2, t.z],
        half: [t.size / 2, t.size / 2, t.size / 2],
        yaw: t.turn,
      },
    ]
  const j = skeleton(t.pose)
  const P = (k: keyof Joints) => placeJoint(t, j[k])
  const r = (x: number) => x * t.size
  return [
    { kind: 'sphere', c: P('head'), r: r(0.12) },
    { kind: 'capsule', a: P('hip'), b: P('chest'), r: r(0.15) },
    { kind: 'capsule', a: P('lShoulder'), b: P('rShoulder'), r: r(0.09) },
    { kind: 'capsule', a: P('lShoulder'), b: P('lElbow'), r: r(0.055) },
    { kind: 'capsule', a: P('lElbow'), b: P('lHand'), r: r(0.05) },
    { kind: 'capsule', a: P('rShoulder'), b: P('rElbow'), r: r(0.055) },
    { kind: 'capsule', a: P('rElbow'), b: P('rHand'), r: r(0.05) },
    { kind: 'capsule', a: P('lHip'), b: P('lKnee'), r: r(0.07) },
    { kind: 'capsule', a: P('lKnee'), b: P('lFoot'), r: r(0.06) },
    { kind: 'capsule', a: P('rHip'), b: P('rKnee'), r: r(0.07) },
    { kind: 'capsule', a: P('rKnee'), b: P('rFoot'), r: r(0.06) },
  ]
}

/** every primitive in the scene, tagged with the thing it belongs to */
export function primitives(scene: Scene): Placed[] {
  const out: Placed[] = []
  scene.things.slice(0, MAX_THINGS).forEach((t, id) => {
    for (const p of shapes(t)) out.push({ ...p, id, colour: t.colour, material: t.material })
  })
  return out.slice(0, MAX_PRIMS)
}

/* ---------------------------------------------------------------- rays ----------------------- */

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** the nearest positive distance along a ray (unit d) to a primitive, or Infinity — as the shader */
export function hit(p: Prim, o: V3, d: V3): number {
  if (p.kind === 'sphere') {
    const oc = sub(o, p.c)
    const b = dot(oc, d)
    const c = dot(oc, oc) - p.r * p.r
    const h = b * b - c
    if (h < 0) return Infinity
    const s = Math.sqrt(h)
    const t = -b - s > 1e-4 ? -b - s : -b + s
    return t > 1e-4 ? t : Infinity
  }
  if (p.kind === 'box') {
    // into the box's frame: turned by -yaw about y
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const lo = sub(o, p.c)
    const ro: V3 = [lo[0] * c - lo[2] * s, lo[1], lo[0] * s + lo[2] * c]
    const rd: V3 = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c]
    let near = -Infinity
    let far = Infinity
    for (let k = 0; k < 3; k++) {
      if (Math.abs(rd[k]) < 1e-12) {
        if (Math.abs(ro[k]) > p.half[k]) return Infinity
        continue
      }
      const t1 = (-p.half[k] - ro[k]) / rd[k]
      const t2 = (p.half[k] - ro[k]) / rd[k]
      near = Math.max(near, Math.min(t1, t2))
      far = Math.min(far, Math.max(t1, t2))
    }
    if (near > far || far < 1e-4) return Infinity
    return near > 1e-4 ? near : far
  }
  // capsule: Inigo Quilez's closed form
  const ba = sub(p.b, p.a)
  const oa = sub(o, p.a)
  const baba = dot(ba, ba)
  const bard = dot(ba, d)
  const baoa = dot(ba, oa)
  const rdoa = dot(d, oa)
  const oaoa = dot(oa, oa)
  const a = baba - bard * bard
  let b = baba * rdoa - baoa * bard
  let c = baba * oaoa - baoa * baoa - p.r * p.r * baba
  let h = b * b - a * c
  if (h >= 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a
    const y = baoa + t * bard
    if (y > 0 && y < baba && t > 1e-4) return t
    // the caps
    const oc = y <= 0 ? oa : sub(o, p.b)
    b = dot(d, oc)
    c = dot(oc, oc) - p.r * p.r
    h = b * b - c
    if (h > 0) {
      const t2 = -b - Math.sqrt(h)
      if (t2 > 1e-4) return t2
    }
  } else {
    for (const e of [p.a, p.b]) {
      const t = hit({ kind: 'sphere', c: e, r: p.r }, o, d)
      if (t < Infinity) return t
    }
  }
  return Infinity
}

/** the camera's eye and its basis */
export function view(c: Camera) {
  const eye: V3 = [
    c.target[0] + c.distance * Math.cos(c.pitch) * Math.sin(c.yaw),
    c.target[1] + c.distance * Math.sin(c.pitch),
    c.target[2] + c.distance * Math.cos(c.pitch) * Math.cos(c.yaw),
  ]
  const fwd = norm(sub(c.target, eye))
  const right = norm(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  /** the half-height of the picture at a metre: a 24 mm tall sensor */
  const tanHalf = 12 / c.lens
  return { eye, fwd, right, up, tanHalf }
}

/** the ray through a point of the picture, u and v from -1 to 1 (v up), for an aspect w/h */
export function rayAt(c: Camera, u: number, v: number, aspect: number): { o: V3; d: V3 } {
  const { eye, fwd, right, up, tanHalf } = view(c)
  const d = norm(add(add(fwd, right, u * tanHalf * aspect), up, v * tanHalf))
  return { o: eye, d }
}

/** what a ray meets first: a thing (its index), a lamp, or nothing */
export function pick(
  scene: Scene,
  o: V3,
  d: V3,
): { what: 'thing' | 'lamp' | 'none'; index: number; t: number } {
  let best = { what: 'none' as 'thing' | 'lamp' | 'none', index: -1, t: Infinity }
  for (const p of primitives(scene)) {
    const t = hit(p, o, d)
    if (t < best.t) best = { what: 'thing', index: p.id, t }
  }
  scene.lamps.forEach((l, i) => {
    const t = hit({ kind: 'sphere', c: [l.x, l.y, l.z], r: LAMP_R }, o, d)
    if (t < best.t) best = { what: 'lamp', index: i, t }
  })
  return best
}

/** where a ray meets the level plane at height `h` (x, z), or null if it never does going forward */
export function onPlane(o: V3, d: V3, h: number): [number, number] | null {
  if (Math.abs(d[1]) < 1e-6) return null
  const t = (h - o[1]) / d[1]
  if (t <= 0) return null
  return [o[0] + d[0] * t, o[2] + d[2] * t]
}

/** where a ray meets the floor (y = 0), or null if it never does */
export const onFloor = (o: V3, d: V3) => onPlane(o, d, 0)

/** a lamp's own size, as it is drawn and as it lights */
export const LAMP_R = 0.25

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Shot` — studio.test.ts lays the struct out from the shader. */
export const SHOT = {
  size: 0,
  frame: 8,
  spp: 12,
  eye: 16,
  fwd: 32,
  right: 48,
  up: 64,
  sky: 80,
  floor: 96,
  lamp0: 112,
  lamp1: 128,
  lamp2: 144,
  glow0: 160,
  glow1: 176,
  glow2: 192,
  bytes: 208,
} as const

const KIND = { sphere: 0, box: 1, capsule: 2 } as const
export const MATERIAL_CODE: Record<Material, number> = { matte: 0, gloss: 1, metal: 2, glow: 3 }

/**
 * The primitives for the shader, four vec4fs each: (a.xyz, kind), (b.xyz, r), (rgb, material),
 * (yaw, id, 0, 0). A sphere's a is its centre; a box's a its centre and b its half-size; a capsule's
 * a and b its ends.
 */
export function packPrims(prims: readonly Placed[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(Math.max(1, prims.length) * 16)
  prims.forEach((p, i) => {
    const o = i * 16
    if (p.kind === 'sphere') f.set([...p.c, KIND.sphere, 0, 0, 0, p.r], o)
    else if (p.kind === 'box') f.set([...p.c, KIND.box, ...p.half, 0], o)
    else f.set([...p.a, KIND.capsule, ...p.b, p.r], o)
    f.set([...p.colour, MATERIAL_CODE[p.material], p.kind === 'box' ? p.yaw : 0, p.id, 0, 0], o + 8)
  })
  return f
}

export function packShot(
  scene: Scene,
  p: { w: number; h: number; frame: number; spp: number; prims: number },
  into = new ArrayBuffer(SHOT.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  const v = view(scene.camera)
  u[0] = p.w
  u[1] = p.h
  u[SHOT.frame / 4] = p.frame
  u[SHOT.spp / 4] = p.spp
  // the lens: an aperture's radius in metres (focal length / f-stop / 2), and the sharp distance
  const aperture = scene.camera.lens / 1000 / scene.camera.fstop / 2
  f.set([...v.eye, v.tanHalf], SHOT.eye / 4)
  f.set([...v.fwd, aperture], SHOT.fwd / 4)
  f.set([...v.right, scene.camera.focus], SHOT.right / 4)
  f.set([...v.up, p.prims], SHOT.up / 4)
  f.set([...scene.sky, Math.min(scene.lamps.length, MAX_LAMPS)], SHOT.sky / 4)
  f.set([...scene.floor, WALL], SHOT.floor / 4)
  for (let k = 0; k < MAX_LAMPS; k++) {
    const l = scene.lamps[k]
    f.set(l ? [l.x, l.y, l.z, LAMP_R] : [0, -100, 0, 0], (SHOT.lamp0 + k * 16) / 4)
    f.set(l ? [...l.colour.map((c) => c * l.power), 0] : [0, 0, 0, 0], (SHOT.glow0 + k * 16) / 4)
  }
  return into
}

/* ---------------------------------------------------------------- keeping a scene ------------ */

export const SCENE_KEY = 'lab_studio_scene_v1'

const num = (x: unknown, lo: number, hi: number, fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback
const rgb = (x: unknown, fallback: RGB): RGB =>
  Array.isArray(x) && x.length === 3
    ? (x.map((c, i) => num(c, 0, 1, fallback[i])) as RGB)
    : fallback
const one = <T extends string>(x: unknown, of: readonly T[], fallback: T): T =>
  typeof x === 'string' && (of as readonly string[]).includes(x) ? (x as T) : fallback

/**
 * A scene from untrusted JSON — a file somebody chose, or storage. ⚠️ IT IS DATA, NEVER CODE, AND
 * NOTHING IN IT IS BELIEVED UNCHECKED: every number is clamped to a range that makes sense, every
 * name must be one this file knows, lists are cut to their limits, and anything missing or wrong
 * takes the default. Returns null only when there is nothing scene-like at all.
 */
export function readScene(text: string | null): Scene | null {
  if (!text || text.length > 200_000) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.things) && !Array.isArray(r.lamps)) return null
  // ⚠️ filtered BEFORE cut to size: junk in the list must not use up the slots real entries need
  const things: Thing[] = (Array.isArray(r.things) ? r.things : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .slice(0, MAX_THINGS)
    .map((t) => ({
      kind: one(t.kind, ['actor', 'box', 'ball'] as const, 'box'),
      x: num(t.x, -8, 8, 0),
      z: num(t.z, WALL + 0.5, 8, 0),
      turn: num(t.turn, -Math.PI * 4, Math.PI * 4, 0),
      size: num(t.size, 0.2, 2, 1),
      colour: rgb(t.colour, SWATCHES.chalk),
      material: one(t.material, MATERIALS, 'matte'),
      pose: one(t.pose, POSES, 'stand'),
    }))
  const lamps: Lamp[] = (Array.isArray(r.lamps) ? r.lamps : [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .slice(0, MAX_LAMPS)
    .map((l) => ({
      x: num(l.x, -10, 10, 0),
      y: num(l.y, 0.3, 8, 3),
      z: num(l.z, WALL + 0.5, 10, 2),
      colour: rgb(l.colour, [1, 1, 1]),
      power: num(l.power, 0, 100, 20),
    }))
  const c = (r.camera && typeof r.camera === 'object' ? r.camera : {}) as Record<string, unknown>
  const d = DEFAULT_SCENE.camera
  const target = Array.isArray(c.target) && c.target.length === 3 ? c.target : d.target
  return {
    things,
    lamps,
    camera: {
      yaw: num(c.yaw, -Math.PI * 4, Math.PI * 4, d.yaw),
      pitch: num(c.pitch, -0.2, 1.4, d.pitch),
      distance: num(c.distance, 1.5, 20, d.distance),
      lens: num(c.lens, 14, 200, d.lens),
      fstop: num(c.fstop, 1.2, 22, d.fstop),
      focus: num(c.focus, 0.5, 40, d.focus),
      target: [num(target[0], -8, 8, 0), num(target[1], 0, 4, 0.9), num(target[2], -8, 8, 0)],
    },
    floor: rgb(r.floor, DEFAULT_SCENE.floor),
    sky: rgb(r.sky, DEFAULT_SCENE.sky),
  }
}
