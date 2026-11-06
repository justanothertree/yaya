/**
 * The arithmetic of the Lab's clay: the volume it lives in, the brushes, the camera, and the
 * signed-distance sums the shaders do — so the tests can hold them to the geometry.
 *
 * ⚠️ THE CLAY IS A DISTANCE FIELD IN A 3D TEXTURE. Every voxel of a 64³ grid holds how far it is
 * from the clay's surface (negative inside). Drawing is ray-marching through it; sculpting is
 * folding a sphere into it with a SMOOTH union (add) or subtraction (carve), which blends the edge
 * rather than leaving a seam; smoothing is pulling each voxel towards its neighbours' mean.
 *
 * ⚠️ AND WHERE THE FINGER TOUCHES IS FOUND ON THE GPU. The CPU never holds the clay, so it cannot
 * say where a ray meets it. Instead a one-thread pass marches the finger's ray through the volume
 * and writes the hit into a small buffer, and the edit that follows in the same submission reads
 * it from there — no round trip back to the CPU, so sculpting never waits a frame to know where.
 */

/** Hand-packed to match `struct Clay` — clay.test.ts lays the struct out from the shader. */
export const CLAY = {
  eye: 0,
  fwd: 16,
  right: 32,
  up: 48,
  rayO: 64,
  rayD: 80,
  n: 96,
  tool: 100,
  mirror: 104,
  glaze: 108,
  bytes: 112,
} as const

/** voxels each way across the volume, which spans -1..1 */
export const N = 64
export const VOXEL = 2 / N
/** how far apart two shapes' surfaces blend when one is folded into the other */
export const BLEND = 0.08

export const TOOLS = { add: 'Add', carve: 'Carve', smooth: 'Smooth', turn: 'Turn' } as const
export type Tool = keyof typeof TOOLS
export const TOOL_ID: Record<Tool, number> = { add: 0, carve: 1, smooth: 2, turn: 3 }
export const GLAZES = { terracotta: 'Terracotta', porcelain: 'Porcelain', jade: 'Jade' } as const
export type Glaze = keyof typeof GLAZES
export const GLAZE_IDS = Object.keys(GLAZES) as Glaze[]

/** Inigo Quilez's polynomial smooth minimum: min(a, b) with the corner rounded over k */
export function smin(a: number, b: number, k = BLEND): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
/** and the matching smooth subtraction: a with b cut out */
export const ssub = (a: number, b: number, k = BLEND) => -smin(-a, b, k)

/** the starting lump: a sphere, a little squashed, so it reads as clay on a wheel */
export function lump(x: number, y: number, z: number): number {
  return Math.hypot(x, y * 1.15, z) - 0.55
}

/** a voxel's centre in the volume's -1..1 space */
export const voxelCentre = (i: number) => -1 + (i + 0.5) * VOXEL

type V3 = readonly [number, number, number]
export type Camera = { eye: V3; fwd: V3; right: V3; up: V3 }

/** a camera on a sphere round the clay, `yaw` round and `pitch` up, `dist` away, looking at it */
export function orbit(yaw: number, pitch: number, dist: number): Camera {
  const eye: V3 = [
    dist * Math.cos(pitch) * Math.sin(yaw),
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw),
  ]
  const l = Math.hypot(...eye)
  const fwd: V3 = [-eye[0] / l, -eye[1] / l, -eye[2] / l]
  const r = [fwd[2], 0, -fwd[0]]
  const rl = Math.hypot(r[0], r[2]) || 1
  const right: V3 = [-r[0] / rl, 0, -r[2] / rl]
  const up: V3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ]
  return { eye, fwd, right, up }
}

/** the focal length the shaders use: how wide the view is */
export const FOCAL = 1.8

/** the ray through a point of the canvas (-1..1 each way, y up), from the camera */
export function rayThrough(c: Camera, sx: number, sy: number, aspect: number): V3 {
  const d = [0, 1, 2].map((k) => c.fwd[k] * FOCAL + c.right[k] * sx * aspect + c.up[k] * sy)
  const l = Math.hypot(d[0], d[1], d[2])
  return [d[0] / l, d[1] / l, d[2] / l]
}

export type ClayFrame = {
  cam: Camera
  aspect: number
  ray: { o: V3; d: V3; radius: number } | null
  tool: Tool
  mirror: boolean
  glaze: Glaze
}

export function packClay(p: ClayFrame, into = new ArrayBuffer(CLAY.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.set([...p.cam.eye, p.aspect], CLAY.eye / 4)
  f.set([...p.cam.fwd, FOCAL], CLAY.fwd / 4)
  f.set([...p.cam.right, 0], CLAY.right / 4)
  f.set([...p.cam.up, 0], CLAY.up / 4)
  f.set([...(p.ray?.o ?? [0, 0, 0]), p.ray?.radius ?? 0], CLAY.rayO / 4)
  f.set([...(p.ray?.d ?? [0, 0, 1]), p.ray ? 1 : 0], CLAY.rayD / 4)
  u[CLAY.n / 4] = N
  u[CLAY.tool / 4] = TOOL_ID[p.tool]
  u[CLAY.mirror / 4] = p.mirror ? 1 : 0
  u[CLAY.glaze / 4] = GLAZE_IDS.indexOf(p.glaze)
  return into
}
