import { describe, expect, it } from 'vitest'
import code from './critters.wgsl?raw'
import {
  BRAIN_FLOATS,
  DT,
  FRICTION,
  G,
  GENERATION,
  ITERATIONS,
  MAX_BONES,
  MAX_DEGREE,
  MAX_JOINTS,
  PRESETS,
  RACE,
  REACH,
  DRAG,
  MAX_BEAT,
  boneAt,
  breed,
  fresh,
  jointAt,
  lcg,
  middle,
  muscleLength,
  muscles,
  mutate,
  packBody,
  packBrains,
  packRace,
  problem,
  randomBrain,
  readCritter,
  removeJoint,
  simulate,
  snap,
  standUp,
  stuck,
  type Body,
  type Brain,
} from './critters'
import { wgslLayout } from './wgslLayout'

const hopper = PRESETS.hopper.body
const still = (b: Body): Brain => ({
  phase: Array(muscles(b)).fill(0),
  strength: Array(muscles(b)).fill(0),
  beat: 1,
})
const boneLengths = (b: Body, s: { x: Float64Array; y: Float64Array }) =>
  b.bones.map((x) => Math.hypot(s.x[x.b] - s.x[x.a], s.y[x.b] - s.y[x.a]))
const run = (b: Body, brain: Brain, seconds: number) => {
  const s = fresh(b)
  const start = middle(s)
  simulate(b, brain, s, 0, Math.round(seconds / DT))
  return { s, walked: middle(s) - start }
}

describe('the shader and this file describe one race', () => {
  const wgsl = wgslLayout(code, 'Race')
  it('agree about where every field of the uniform lives', () => {
    const { bytes, ...rest } = RACE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('share every constant of the physics', () => {
    expect(code).toContain(`const MAX_JOINTS = ${MAX_JOINTS}u;`)
    expect(code).toContain(`const MAX_BONES = ${MAX_BONES}u;`)
    expect(code).toContain(`const MAX_DEGREE = ${MAX_DEGREE}u;`)
    expect(code).toContain(`const BRAIN_FLOATS = ${BRAIN_FLOATS}u;`)
    expect(code).toContain(`const DT = ${DT};`)
    expect(code).toContain(`const ITERATIONS = ${ITERATIONS};`)
    expect(code).toContain(`const G = ${G};`)
    expect(code).toContain(`const FRICTION = ${FRICTION};`)
    expect(code).toContain(`const REACH = ${REACH};`)
    expect(code).toContain(`const DRAG = ${DRAG};`)
    expect(code).toContain(`var<workgroup> X: array<f32, ${MAX_JOINTS}>;`)
  })
  it('write every field where the shader will look for it', () => {
    const v = new DataView(
      packRace({
        w: 640,
        h: 360,
        joints: 6,
        bones: 9,
        count: 256,
        steps: 20,
        time: 3.5,
        cam: [4, 0.8],
        scale: 120,
        best: 17,
        build: true,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([
      u('size'),
      u('size', 1),
      u('joints'),
      u('bones'),
      u('count'),
      u('steps'),
      u('best'),
      u('build'),
    ]).toEqual([640, 360, 6, 9, 256, 20, 17, 1])
    expect([f('time'), f('scale'), f('cam'), f('cam', 1)]).toEqual(
      [3.5, 120, 4, 0.8].map(Math.fround),
    )
  })
  it('lists every bone at both its ends, and numbers the muscles in order', () => {
    const b = PRESETS.worm.body
    const { bones, adjacency } = packBody(b)
    b.bones.forEach((bone, i) => {
      for (const j of [bone.a, bone.b])
        expect([...adjacency.slice(j * MAX_DEGREE, (j + 1) * MAX_DEGREE)]).toContain(i)
    })
    const marks = b.bones.map((_, i) => bones[i * 4 + 3])
    expect(marks.filter((m) => m >= 0)).toEqual([0, 1, 2, 3])
    expect(bones[2]).toBeCloseTo(Math.hypot(0.4, 0.2), 6)
  })
  it('packs each brain where the shader reads it', () => {
    const brain: Brain = { phase: [0.1, 0.2], strength: [0.3, 0.4], beat: 1.7 }
    const f = packBrains([still(hopper), brain])
    expect([f[BRAIN_FLOATS], f[BRAIN_FLOATS + 1]]).toEqual([0.1, 0.2].map(Math.fround))
    expect([f[BRAIN_FLOATS + MAX_BONES], f[BRAIN_FLOATS + MAX_BONES * 2]]).toEqual(
      [0.3, 1.7].map(Math.fround),
    )
  })
})

describe('a body', () => {
  it('is checked: the presets pass, and each way of being broken has its own sentence', () => {
    for (const p of Object.values(PRESETS)) expect(problem(p.body)).toBe(null)
    const j = hopper.joints
    expect(problem({ joints: [j[0]], bones: [] })).toMatch(/two joints/)
    expect(problem({ joints: j, bones: [{ a: 0, b: 0, muscle: true }] })).toMatch(/different/)
    expect(problem({ joints: j, bones: [{ a: 0, b: 7, muscle: true }] })).toMatch(/different/)
    expect(problem({ joints: j, bones: [...hopper.bones, { a: 1, b: 0, muscle: false }] })).toMatch(
      /same joints/,
    )
    expect(
      problem({ joints: j, bones: hopper.bones.map((b) => ({ ...b, muscle: false })) }),
    ).toMatch(/muscle/)
    expect(problem({ joints: [...j, [2, 1]], bones: hopper.bones })).toMatch(/not joined/)
    expect(
      problem({
        joints: [
          [0, 0],
          [0.01, 0],
        ],
        bones: [{ a: 0, b: 1, muscle: true }],
      }),
    ).toMatch(/short/)
  })
  it('knows the one shape that cannot walk: its own mirror image with a single muscle', () => {
    const triangle: Body = {
      joints: [
        [-0.4, 0.1],
        [0.4, 0.1],
        [0, 0.8],
      ],
      bones: [
        { a: 0, b: 1, muscle: true },
        { a: 1, b: 2, muscle: false },
        { a: 2, b: 0, muscle: false },
      ],
    }
    expect(stuck(triangle)).toBe(true)
    // and the physics agrees: whatever its brain, it goes nowhere
    const rand = lcg(3)
    for (let k = 0; k < 6; k++)
      expect(Math.abs(run(triangle, randomBrain(1, rand), 4).walked)).toBeLessThan(1e-9)
    // a muscle on one side, a second muscle, or a lean, and it is not
    expect(
      stuck({ ...triangle, bones: triangle.bones.map((b, i) => ({ ...b, muscle: i === 1 })) }),
    ).toBe(false)
    expect(
      stuck({ ...triangle, bones: triangle.bones.map((b, i) => ({ ...b, muscle: i !== 2 })) }),
    ).toBe(false)
    // still its own mirror, but with two muscles a brain can pulse them out of step, and it walks
    const twin = { ...triangle, bones: triangle.bones.map((b, i) => ({ ...b, muscle: i !== 0 })) }
    expect(stuck(twin)).toBe(false)
    const far = [1, 2, 3, 4, 5, 6].map((k) => Math.abs(run(twin, randomBrain(2, lcg(k)), 4).walked))
    expect(Math.max(...far)).toBeGreaterThan(0.05)
    expect(
      stuck({
        ...triangle,
        joints: [
          [-0.4, 0.1],
          [0.4, 0.1],
          [0.1, 0.8],
        ],
      }),
    ).toBe(false)
    for (const p of Object.values(PRESETS)) expect(stuck(p.body)).toBe(false)
  })

  it('stands with its lowest joint on the ground, centred', () => {
    const s = standUp({ ...hopper, joints: hopper.joints.map(([x, y]) => [x + 3, y + 1]) })
    expect(Math.min(...s.map((p) => p[1]))).toBeCloseTo(0.02, 12)
    expect(s.reduce((a, p) => a + p[0], 0)).toBeCloseTo(0, 12)
  })
})

describe('the physics', () => {
  it('lets a still body fall, settle on the ground and stay where it is, keeping its shape', () => {
    const b = PRESETS.quad.body
    const s = fresh(b)
    s.y.forEach((_, i) => (s.y[i] += 1))
    const was = boneLengths(b, fresh(b))
    simulate(b, still(b), s, 0, Math.round(3 / DT))
    expect(Math.min(...s.y)).toBeGreaterThanOrEqual(0)
    expect(Math.min(...s.y)).toBeLessThan(0.01)
    expect(Math.abs(middle(s))).toBeLessThan(0.05)
    expect(Math.max(...s.vx.map(Math.abs), ...s.vy.map(Math.abs))).toBeLessThan(0.05)
    boneLengths(b, s).forEach((l, i) => expect(l / was[i]).toBeCloseTo(1, 1))
  })
  it('stops a body sliding along the ground: friction', () => {
    const s = fresh(hopper)
    s.vx.fill(3)
    simulate(hopper, still(hopper), s, 0, Math.round(1.5 / DT))
    expect(Math.max(...s.vx.map(Math.abs))).toBeLessThan(0.05)
    expect(middle(s)).toBeLessThan(0.3)
  })
  it('moves only by its muscles: some brains walk, and the same brain with no strength stays put', () => {
    const rand = lcg(7)
    const brains = Array.from({ length: 64 }, () => randomBrain(muscles(hopper), rand))
    const walked = brains.map((br) => Math.abs(run(hopper, br, GENERATION).walked))
    expect(Math.max(...walked)).toBeGreaterThan(0.5)
    const best = brains[walked.indexOf(Math.max(...walked))]
    expect(
      Math.abs(run(hopper, { ...best, strength: best.strength.map(() => 0) }, GENERATION).walked),
    ).toBeLessThan(0.01)
  })
  it('pulses a muscle about its rest length by REACH × strength, at the beat', () => {
    expect(muscleLength(1, 0.25, 1, 1, 0)).toBeCloseTo(1 + REACH, 12)
    expect(muscleLength(1, 0.25, 0.5, 1, 0.5)).toBeCloseTo(1 - REACH / 2, 12)
    expect(muscleLength(2, 0, 1, 2, 0.25)).toBeCloseTo(2, 12)
  })
  it('keeps its feet: no joint of any of sixteen random Walkers gets far off the ground', () => {
    const rand = lcg(7)
    const body = PRESETS.quad.body
    let worst = 0
    for (let k = 0; k < 16; k++) {
      const br = randomBrain(muscles(body), rand)
      const s = fresh(body)
      for (let t = 0; t < GENERATION / DT; t += 24) {
        simulate(body, br, s, t * DT, 24)
        worst = Math.max(worst, ...s.y)
      }
    }
    // the Walker stands 0.87 m tall; with the first, stronger muscles the winners flew
    expect(worst).toBeLessThan(2)
  })

  it('is the same race every time: nothing random in the physics', () => {
    const br = randomBrain(muscles(hopper), lcg(5))
    const a = run(hopper, br, 2).s
    const b = run(hopper, br, 2).s
    expect([...a.x, ...a.y]).toEqual([...b.x, ...b.y])
  })
})

describe('breeding', () => {
  it('keeps the best as they are, fills the rest with their children, and is the same for the same seed', () => {
    const rand = lcg(2)
    const brains = Array.from({ length: 12 }, () => randomBrain(2, rand))
    const distance = brains.map((_, i) => (i * 7) % 12)
    const next = breed(brains, distance, lcg(9), 4)
    expect(next).toHaveLength(12)
    expect(next[0]).toBe(brains[distance.indexOf(11)])
    expect(next.slice(0, 4)).toEqual([11, 10, 9, 8].map((d) => brains[distance.indexOf(d)]))
    expect(breed(brains, distance, lcg(9), 4)).toEqual(next)
  })
  it('mutates a little, inside the bounds', () => {
    const rand = lcg(4)
    const b: Brain = { phase: [0.99, 0.01], strength: [1, 0], beat: MAX_BEAT }
    for (let k = 0; k < 200; k++) {
      const m = mutate(b, rand, 0.3)
      for (const x of [...m.phase, ...m.strength]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
      }
      expect(m.beat).toBeLessThanOrEqual(MAX_BEAT)
      expect(m.beat).toBeGreaterThanOrEqual(0.3)
    }
  })
  it('never loses ground: with the best kept unchanged and the race the same, the best never walks less', () => {
    const body = hopper
    let brains = Array.from({ length: 20 }, () => randomBrain(muscles(body), lcg(3)))
    brains = brains.map((b, i) => mutate(b, lcg(100 + i), 0.5))
    const rand = lcg(77)
    const bests: number[] = []
    for (let g = 0; g < 4; g++) {
      const d = brains.map((br) => run(body, br, GENERATION / 2).walked)
      bests.push(Math.max(...d))
      brains = breed(brains, d, rand, 5)
    }
    for (let g = 1; g < bests.length; g++) expect(bests[g]).toBeGreaterThanOrEqual(bests[g - 1])
    expect(bests.at(-1)!).toBeGreaterThan(bests[0])
  })
})

describe('building', () => {
  it('finds the joint or bone under a finger, and takes a joint away with its bones', () => {
    expect(jointAt(hopper, [0.38, 0.12], 0.1)).toBe(1)
    expect(jointAt(hopper, [3, 3], 0.1)).toBe(-1)
    expect(boneAt(hopper, [0, 0.12], 0.05)).toBe(0)
    const less = removeJoint(PRESETS.worm.body, 1)
    expect(less.joints).toHaveLength(5)
    expect(less.bones.every((b) => b.a < 5 && b.b < 5)).toBe(true)
    expect(less.bones).toHaveLength(
      PRESETS.worm.body.bones.filter((b) => b.a !== 1 && b.b !== 1).length,
    )
    expect(snap([0.234, -0.4])).toEqual([0.2, 0])
  })
})

describe('keeping a critter', () => {
  it('comes back as it went, brain and all — every field away from its default', () => {
    const body: Body = {
      joints: [
        [-0.3, 0.2],
        [0.5, 0.1],
        [0.1, 0.9],
        [0.7, 0.6],
      ],
      bones: [
        { a: 0, b: 1, muscle: true },
        { a: 1, b: 2, muscle: false },
        { a: 2, b: 0, muscle: true },
        { a: 2, b: 3, muscle: true },
      ],
    }
    const brain: Brain = { phase: [0.15, 0.35, 0.95], strength: [0.25, 0.75, 0.5], beat: 1.25 }
    expect(readCritter(JSON.stringify({ body, brain }))).toEqual({ body, brain })
    expect(readCritter(JSON.stringify({ body }))).toEqual({ body, brain: null })
  })
  it('takes nothing on trust', () => {
    const ok = { body: hopper }
    expect(
      readCritter(JSON.stringify({ body: { ...hopper, bones: [{ a: 0, b: 9, muscle: true }] } })),
    ).toBe(null)
    expect(
      readCritter(
        JSON.stringify({
          body: {
            ...hopper,
            joints: [
              [0, 0],
              ['x', 1],
              [1, 1],
            ],
          },
        }),
      ),
    ).toBe(null)
    expect(
      readCritter(JSON.stringify({ body: { joints: Array(40).fill([0, 0]), bones: [] } })),
    ).toBe(null)
    // a brain with the wrong number of muscles is dropped, not trusted
    expect(
      readCritter(JSON.stringify({ ...ok, brain: { phase: [0.1], strength: [0.1], beat: 1 } }))
        ?.brain,
    ).toBe(null)
    // and its numbers are clamped
    const wild = readCritter(
      JSON.stringify({ ...ok, brain: { phase: [5, -1], strength: [9, 0.5], beat: 99 } }),
    )!
    expect(wild.brain).toEqual({ phase: [1, 0], strength: [1, 0.5], beat: MAX_BEAT })
    // joints far away are brought in range
    const far = readCritter(
      JSON.stringify({
        body: {
          ...hopper,
          joints: [
            [-0.4, 0.1],
            [99, 0.1],
            [0, 0.6],
          ],
        },
      }),
    )!
    expect(far.body.joints[1]).toEqual([3, 0.1])
    for (const t of [null, '', '[]', '{}', 'nope', '{"body":5}', 'x'.repeat(60_000)])
      expect(readCritter(t)).toBe(null)
  })
})
