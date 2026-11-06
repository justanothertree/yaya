import { describe, expect, it } from 'vitest'
import code from './studio.wgsl?raw'
import {
  BONES,
  DEFAULT_SCENE,
  LAMP_R,
  MATERIALS,
  MATERIAL_CODE,
  MAX_LAMPS,
  MAX_THINGS,
  POSES,
  SHOT,
  WALL,
  hit,
  onFloor,
  onPlane,
  packPrims,
  packShot,
  pick,
  primitives,
  rayAt,
  readScene,
  shapes,
  skeleton,
  view,
  type Prim,
  type Scene,
  type Thing,
  type V3,
} from './studio'
import { wgslLayout } from './wgslLayout'

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** the shapes' signed distances, written from their definitions — sharing nothing with `hit` */
function sdf(p: Prim, q: V3): number {
  if (p.kind === 'sphere') return dist(q, p.c) - p.r
  if (p.kind === 'box') {
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const l: V3 = [q[0] - p.c[0], q[1] - p.c[1], q[2] - p.c[2]]
    const r: V3 = [l[0] * c - l[2] * s, l[1], l[0] * s + l[2] * c]
    const d = r.map((x, k) => Math.abs(x) - p.half[k])
    return Math.hypot(...d.map((x) => Math.max(x, 0))) + Math.min(Math.max(...d), 0)
  }
  const ab: V3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]]
  const aq: V3 = [q[0] - p.a[0], q[1] - p.a[1], q[2] - p.a[2]]
  const t = Math.max(
    0,
    Math.min(
      1,
      (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2),
    ),
  )
  return dist(q, [p.a[0] + ab[0] * t, p.a[1] + ab[1] * t, p.a[2] + ab[2] * t]) - p.r
}
/** sphere tracing: step along the ray by the distance to the surface */
function march(p: Prim, o: V3, d: V3): number {
  let t = 0
  // grazing rays take tiny steps along a surface, so plenty of them before giving up
  for (let k = 0; k < 20000; k++) {
    const s = sdf(p, [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t])
    if (s < 1e-7) return t
    t += s
    if (t > 100) return Infinity
  }
  return Infinity
}

function lcg(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

describe('the shader and this file describe one shot', () => {
  const wgsl = wgslLayout(code, 'Shot')
  it('agree about where every field of the uniform lives', () => {
    const { bytes, ...rest } = SHOT
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('write the camera, the lens, the room and every lamp where the shader looks', () => {
    const v = new DataView(packShot(DEFAULT_SCENE, { w: 640, h: 360, frame: 9, spp: 2, prims: 33 }))
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('frame'), u('spp')]).toEqual([640, 360, 9, 2])
    const cam = view(DEFAULT_SCENE.camera)
    expect([0, 1, 2].map((i) => f('eye', i))).toEqual(cam.eye.map(Math.fround))
    expect(f('eye', 3)).toBeCloseTo(cam.tanHalf, 6)
    // a 40 mm lens at f/4 is a 5 mm aperture radius
    expect(f('fwd', 3)).toBeCloseTo(0.005, 7)
    expect(f('right', 3)).toBeCloseTo(DEFAULT_SCENE.camera.focus, 5)
    expect([f('up', 3), f('sky', 3), f('floor', 3)]).toEqual([33, DEFAULT_SCENE.lamps.length, WALL])
    const l = DEFAULT_SCENE.lamps[1]
    expect([0, 1, 2, 3].map((i) => f('lamp1', i))).toEqual([l.x, l.y, l.z, LAMP_R].map(Math.fround))
    expect(f('glow1', 2)).toBeCloseTo(l.colour[2] * l.power, 5)
    // a missing third lamp is out of sight and dark
    expect([f('lamp2', 1), f('glow2', 0)]).toEqual([-100, 0])
  })
  it('pack every primitive in the shader’s four vec4fs', () => {
    const prims = primitives(DEFAULT_SCENE)
    const f = packPrims(prims)
    const box = prims.findIndex((p) => p.kind === 'box')
    const p = prims[box]
    expect(f[box * 16 + 3]).toBe(1)
    expect(f[box * 16 + 11]).toBe(MATERIAL_CODE[p.material])
    expect(f[box * 16 + 12]).toBeCloseTo(p.kind === 'box' ? p.yaw : 0, 6)
    expect(f[box * 16 + 13]).toBe(p.id)
    expect(code).toContain('const ID_LAMP = 1000;')
  })
})

describe('an actor', () => {
  it('keeps every bone its length in every pose', () => {
    const stand = skeleton('stand')
    for (const pose of POSES) {
      const j = skeleton(pose)
      for (const [a, b] of BONES) expect(dist(j[a], j[b])).toBeCloseTo(dist(stand[a], stand[b]), 9)
    }
  })
  it('stands on the floor, sits on a seat, and raises its hands where the pose says', () => {
    for (const pose of ['stand', 'wave', 'cheer', 'point', 'think'] as const) {
      const j = skeleton(pose)
      // the foot's centre one foot-radius up: the sole on the floor
      expect(Math.min(j.lFoot[1], j.rFoot[1])).toBeCloseTo(0.06, 2)
    }
    const sit = skeleton('sit')
    expect(sit.hip[1]).toBeLessThan(0.6)
    expect(sit.lKnee[2]).toBeGreaterThan(sit.hip[2] + 0.3)
    const cheer = skeleton('cheer')
    expect(Math.min(cheer.lHand[1], cheer.rHand[1])).toBeGreaterThan(cheer.head[1])
    const wave = skeleton('wave')
    expect(wave.rHand[1]).toBeGreaterThan(wave.head[1])
    expect(wave.lHand[1]).toBeLessThan(wave.hip[1])
    const walk = skeleton('walk')
    expect(walk.lFoot[2] - walk.rFoot[2]).toBeGreaterThan(0.3)
  })
  it('is about 1.85 m tall at size 1 and scales with its size, turned to face its way', () => {
    const t: Thing = { ...DEFAULT_SCENE.things[0], x: 0, z: 0, turn: 0, size: 1, pose: 'stand' }
    const top = (th: Thing) =>
      Math.max(...shapes(th).map((p) => (p.kind === 'sphere' ? p.c[1] + p.r : 0)))
    expect(top(t)).toBeCloseTo(1.85, 1)
    expect(top({ ...t, size: 0.5 })).toBeCloseTo(top(t) / 2, 6)
    // pointing: the right hand goes forward (+z) unturned, and along +x turned a quarter
    const hand = (th: Thing) => (shapes(th)[6] as { b: V3 }).b
    expect(hand({ ...t, pose: 'point' })[2]).toBeGreaterThan(0.4)
    expect(hand({ ...t, pose: 'point', turn: Math.PI / 2 })[0]).toBeGreaterThan(0.4)
  })
})

describe('rays', () => {
  const rand = lcg(3)
  const shapesToTry: Prim[] = [
    { kind: 'sphere', c: [0.3, 1, -0.2], r: 0.6 },
    { kind: 'box', c: [-0.2, 0.5, 0.1], half: [0.4, 0.5, 0.25], yaw: 0.7 },
    { kind: 'capsule', a: [-0.5, 0.2, 0], b: [0.4, 1.3, 0.3], r: 0.2 },
  ]
  it('meet each shape where sphere tracing its distance field does, from 600 random rays', () => {
    for (const p of shapesToTry) {
      let hits = 0
      for (let k = 0; k < 200; k++) {
        const o: V3 = [(rand() - 0.5) * 8, rand() * 4, 3 + rand() * 3]
        const aim: V3 = [(rand() - 0.5) * 1.6, rand() * 1.6, (rand() - 0.5) * 1.2]
        const d = norm([aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]])
        const a = hit(p, o, d)
        const m = march(p, o, d)
        if (m === Infinity) expect(a, `${p.kind} ${o} ${d}`).toBe(Infinity)
        else {
          // on the surface (a grazing ray makes t itself touchy, so the surface is the claim), and
          // the first time the ray meets it, not a later one
          const at: V3 = [o[0] + d[0] * a, o[1] + d[1] * a, o[2] + d[2] * a]
          expect(Math.abs(sdf(p, at)), `${p.kind} ${o} ${d}`).toBeLessThan(1e-9)
          expect(a).toBeLessThan(m + 1e-3)
          hits++
        }
      }
      expect(hits).toBeGreaterThan(30)
    }
  })
  it('go through the middle of the picture straight at the target, and wider for a short lens', () => {
    const c = DEFAULT_SCENE.camera
    const r = rayAt(c, 0, 0, 16 / 9)
    const v = view(c)
    expect(r.d.map((x, k) => x - v.fwd[k]).every((x) => Math.abs(x) < 1e-12)).toBe(true)
    const edge = (lens: number) => {
      const e = rayAt({ ...c, lens }, 1, 0, 1)
      return Math.acos(e.d[0] * v.fwd[0] + e.d[1] * v.fwd[1] + e.d[2] * v.fwd[2])
    }
    expect(edge(24)).toBeGreaterThan(edge(85))
    // a 24 mm sensor height at 40 mm is a 33.4° vertical view
    expect(2 * Math.atan(view({ ...c, lens: 40 }).tanHalf) * (180 / Math.PI)).toBeCloseTo(33.4, 1)
  })
  it('pick the nearest thing or lamp, and find the floor', () => {
    const s = DEFAULT_SCENE
    const ball = s.things.findIndex((t) => t.kind === 'ball')
    const b = s.things[ball]
    const o: V3 = [b.x, b.size, b.z + 5]
    expect(pick(s, o, [0, 0, -1])).toMatchObject({ what: 'thing', index: ball })
    const l = s.lamps[0]
    expect(pick(s, [l.x, l.y, l.z + 3], [0, 0, -1])).toMatchObject({ what: 'lamp', index: 0 })
    expect(pick(s, [0, 9, 0], [0, 1, 0]).what).toBe('none')
    expect(onFloor([0, 2, 0], norm([1, -1, 0]))).toEqual([
      expect.closeTo(2, 9),
      expect.closeTo(0, 9),
    ])
    expect(onFloor([0, 2, 0], [0, 1, 0])).toBe(null)
    // a level plane at a height: the drag plane, where the finger met the thing
    expect(onPlane([0, 2, 5], norm([0, -1, -1]), 1)).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(4, 9),
    ])
    expect(onPlane([0, 2, 5], norm([0, -1, -1]), 3)).toBe(null)
  })
})

describe('keeping a scene', () => {
  /** every field something other than its default, so a round trip that drops one shows it */
  const odd: Scene = {
    things: [
      {
        kind: 'actor',
        x: 1.25,
        z: -2.5,
        turn: 2.1,
        size: 1.3,
        colour: [0.1, 0.2, 0.3],
        material: 'metal',
        pose: 'cheer',
      },
      {
        kind: 'ball',
        x: -3.5,
        z: 4.25,
        turn: -1,
        size: 0.45,
        colour: [0.9, 0.05, 0.6],
        material: 'glow',
        pose: 'sit',
      },
    ],
    lamps: [{ x: 3.5, y: 6.5, z: -4, colour: [0.2, 0.9, 0.4], power: 77 }],
    camera: {
      yaw: -1.25,
      pitch: 0.9,
      distance: 11.5,
      lens: 85,
      fstop: 1.8,
      focus: 9.75,
      target: [1.5, 2.25, -0.5],
    },
    floor: [0.3, 0.31, 0.32],
    sky: [0.7, 0.6, 0.5],
  }
  it('comes back exactly as it went', () => {
    expect(readScene(JSON.stringify(odd))).toEqual(odd)
    expect(readScene(JSON.stringify(DEFAULT_SCENE))).toEqual(DEFAULT_SCENE)
  })
  it('takes nothing on trust: clamps numbers, knows only its own names, cuts lists to size', () => {
    const bad = {
      things: [
        {
          kind: 'dragon',
          x: 1e9,
          z: -1e9,
          turn: 'left',
          size: -5,
          colour: [2, -1, 'x'],
          material: 'lava',
          pose: '<script>',
        },
        ...Array.from({ length: 40 }, () => ({ kind: 'ball' })),
      ],
      // more lamps than a scene may hold, and things that are not lamps among them
      lamps: [{ x: NaN, y: 99, power: 1e9 }, 7, null, {}, {}, {}, {}, {}],
      camera: { lens: 1, fstop: 0, distance: -3, target: ['a', 1, 2] },
      floor: 'red',
      __proto__: { polluted: true },
    }
    const s = readScene(JSON.stringify(bad))!
    expect(s.things).toHaveLength(MAX_THINGS)
    expect(s.things[0]).toMatchObject({
      kind: 'box',
      x: 8,
      size: 0.2,
      material: 'matte',
      pose: 'stand',
      turn: 0,
    })
    expect(s.things[0].z).toBeGreaterThan(WALL)
    expect(s.things[0].colour).toEqual([1, 0, expect.any(Number)])
    expect(s.lamps).toHaveLength(MAX_LAMPS)
    expect(s.lamps[0]).toMatchObject({ x: 0, y: 8, power: 100 })
    expect(s.camera).toMatchObject({ lens: 14, fstop: 1.2, distance: 1.5 })
    expect(s.camera.target[0]).toBe(0)
    expect(s.floor).toEqual(DEFAULT_SCENE.floor)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(MATERIALS).toContain(s.things[1].material)
  })
  it('refuses what is not a scene at all', () => {
    for (const t of [null, '', 'nope', '42', '[]', '{"a":1}', '"scene"', 'x'.repeat(300_000)])
      expect(readScene(t)).toBe(null)
  })
})
