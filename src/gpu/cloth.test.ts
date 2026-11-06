import { describe, expect, it } from 'vitest'
import types from './cloth-types.wgsl?raw'
import sim from './cloth-sim.wgsl?raw'
import {
  CLOTH,
  DAMP,
  DIAGONAL_STIFF,
  FLOOR,
  GRAB_RADIUS,
  GRAVITY,
  KINDS,
  PEG_GAP,
  PHASES,
  TEAR,
  edgeCounts,
  edgeEnds,
  gridFor,
  packCloth,
  relaxPhase,
  seedCloth,
  segmentsCross,
  stepCloth,
  toWorld,
  type ClothState,
  type Grid,
} from './cloth'
import { wgslLayout } from './wgslLayout'

const constant = (name: string) => {
  const m = sim.match(new RegExp(`const ${name} = (-?[0-9.]+);`))
  if (!m) throw new Error(`no ${name} in cloth-sim.wgsl`)
  return Number(m[1])
}

describe('the shader and this file describe one cloth', () => {
  const wgsl = wgslLayout(types, 'Cloth')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = CLOTH
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('agrees about gravity, damping, tearing, reach, the floor and the diagonals', () => {
    expect([GRAVITY, DAMP, TEAR, GRAB_RADIUS, FLOOR, DIAGONAL_STIFF]).toEqual(
      ['GRAVITY', 'DAMP', 'TEAR', 'GRAB_RADIUS', 'FLOOR', 'DIAGONAL_STIFF'].map(constant),
    )
  })

  it('writes every field where the shader will look for it', () => {
    const g: Grid = { cols: 30, rows: 20, spacing: 0.0625, left: -1, top: 0.85 }
    const b = packCloth({
      g,
      fingers: [
        { at: [0.25, 0.5], was: [0.125, 0.375], down: true, pressed: false },
        { at: [-0.5, -0.25], was: [-0.5, -0.25], down: true, pressed: true },
      ],
      phase: 5,
      tool: 'cut',
      time: 3.5,
      wind: 0.75,
      aspect: 1.5,
      fabric: 'denim',
      step: 2,
      steps: 3,
    })
    const v = new DataView(b)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect([0, 1, 2, 3].map((i) => f('f0', i))).toEqual([0.25, 0.5, 0.125, 0.375])
    expect([0, 1].map((i) => f('f1', i))).toEqual([-0.5, -0.25])
    expect([
      u('cols'),
      u('rows'),
      u('phase'),
      u('tool'),
      u('fabric'),
      u('step'),
      u('steps'),
    ]).toEqual([30, 20, 5, 1, 3, 2, 3])
    expect([f('spacing'), f('time'), f('wind'), f('aspect')]).toEqual([0.0625, 3.5, 0.75, 1.5])
    // fingers 0 and 1 are down; only 1 went down this frame
    expect([u('down'), u('pressed')]).toEqual([0b11, 0b10])
  })
})

describe('the colouring', () => {
  const g = gridFor(1.5, true)

  it('never puts two edges that share a particle in the same phase', () => {
    for (let p = 0; p < PHASES; p++) {
      const kind = p >> 1
      const seen = new Set<number>()
      for (let e = 0; e < edgeCounts(g)[kind]; e++) {
        const [a, b, colour] = edgeEnds(g, kind, e)
        if ((colour & 1) !== (p & 1)) continue
        expect(seen.has(a) || seen.has(b)).toBe(false)
        seen.add(a)
        seen.add(b)
      }
    }
  })

  it('joins every neighbour to every neighbour exactly once, across, down and both diagonals', () => {
    const pairs = new Set<string>()
    for (let k = 0; k < KINDS; k++)
      for (let e = 0; e < edgeCounts(g)[k]; e++) {
        const [a, b] = edgeEnds(g, k, e)
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`
        expect(pairs.has(key)).toBe(false)
        pairs.add(key)
        const [ax, ay, bx, by] = [
          a % g.cols,
          Math.floor(a / g.cols),
          b % g.cols,
          Math.floor(b / g.cols),
        ]
        expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1)
      }
    // every pair of grid neighbours, the eight ways round, counted once
    const c = g.cols
    const r = g.rows
    expect(pairs.size).toBe((c - 1) * r + c * (r - 1) + 2 * (c - 1) * (r - 1))
  })
})

const fresh = (g: Grid, pins: 'curtain' | 'pegs'): ClothState => ({
  ...seedCloth(g, pins),
  broken: new Uint32Array(edgeCounts(g).reduce((a, b) => a + b, 0)),
})

const stretchOf = (g: Grid, s: ClothState) => {
  let most = 0
  for (let k = 0; k < 2; k++)
    for (let e = 0; e < edgeCounts(g)[k]; e++) {
      const [a, b] = edgeEnds(g, k, e)
      const p = s.pos
      const l = Math.hypot(
        p[b * 4] - p[a * 4],
        p[b * 4 + 1] - p[a * 4 + 1],
        p[b * 4 + 2] - p[a * 4 + 2],
      )
      most = Math.max(most, l / g.spacing)
    }
  return most
}

describe('hanging', () => {
  const g = gridFor(1.5, true)

  it('pins a curtain all along its top, and a line only at its pegs', () => {
    const pinned = (pins: 'curtain' | 'pegs') => {
      const { pos } = seedCloth(g, pins)
      return Array.from({ length: g.cols * g.rows }, (_, i) => pos[i * 4 + 3] === 0).filter(Boolean)
        .length
    }
    expect(pinned('curtain')).toBe(g.cols)
    expect(pinned('pegs')).toBe(
      Math.floor((g.cols - 1) / PEG_GAP) + 1 + ((g.cols - 1) % PEG_GAP ? 1 : 0),
    )
  })

  for (const pins of ['curtain', 'pegs'] as const)
    it(`hangs, ${pins}, in a strong breeze for ten seconds without tearing or stretching out`, () => {
      const s = fresh(g, pins)
      for (let t = 0; t < 600; t++) stepCloth(g, s, t / 60, 1.5, 1.5)
      expect(s.broken.reduce((a, b) => a + b, 0)).toBe(0)
      expect(stretchOf(g, s)).toBeLessThan(1.5)
    })

  it('settles on the floor when nothing holds it, and stays there', () => {
    const s = fresh(g, 'pegs')
    for (let i = 3; i < s.pos.length; i += 4) s.pos[i] = 1 // let go of every peg
    for (let t = 0; t < 300; t++) stepCloth(g, s, 0, 0, 1.5)
    for (let i = 1; i < s.pos.length; i += 4) expect(s.pos[i]).toBeGreaterThanOrEqual(FLOOR - 1e-6)
    expect(s.broken.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('tearing and cutting', () => {
  it('tears the edges holding a particle that is pulled away, and no others', () => {
    const g: Grid = { cols: 4, rows: 3, spacing: 0.1, left: 0, top: 0 }
    const s = fresh(g, 'curtain')
    const dragged = 2 * 4 + 1
    s.pos[dragged * 4 + 1] -= 0.1 * TEAR * 1.5
    for (let p = 0; p < PHASES; p++) relaxPhase(g, s, p)
    const counts = edgeCounts(g)
    let id = 0
    let torn = 0
    for (let k = 0; k < KINDS; k++)
      for (let e = 0; e < counts[k]; e++, id++)
        if (s.broken[id]) {
          torn++
          expect(edgeEnds(g, k, e).slice(0, 2)).toContain(dragged)
        }
    // across both ways, up, and both diagonals up: all five that held it
    expect(torn).toBe(5)
  })

  it('cuts where the stroke crosses, not where it nearly does', () => {
    expect(segmentsCross([0, 0], [1, 0], [0.5, -1], [0.5, 1])).toBe(true)
    expect(segmentsCross([0, 0], [1, 0], [1.5, -1], [1.5, 1])).toBe(false)
    expect(segmentsCross([0, 0], [1, 0], [0.5, 0.1], [0.5, 1])).toBe(false)
  })

  it('puts the corners of the canvas at the corners of the world', () => {
    expect(toWorld(0, 0, 600, 400)).toEqual([-1.5, 1])
    expect(toWorld(600, 400, 600, 400)).toEqual([1.5, -1])
  })
})
