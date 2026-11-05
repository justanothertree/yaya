import { describe, expect, it } from 'vitest'
import types from './slime-types.wgsl?raw'
import step from './slime-step.wgsl?raw'
import {
  FOOD,
  FOOD_SMELL,
  FOOD_SOURCE,
  HABITS,
  NOTHING,
  SLIME,
  WALL,
  foodFor,
  packSlime,
  seedAgents,
  stepTrail,
  turnFor,
} from './slime'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one mould', () => {
  const wgsl = wgslLayout(types, 'Slime')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, senseAngle, senseDist, ...rest } = SLIME
    expect(wgsl.offsets).toEqual({ ...rest, sense_angle: senseAngle, sense_dist: senseDist })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packSlime({
        w: 300,
        h: 200,
        agents: 1234,
        step: 77,
        habit: 'coral',
        palette: 'moss',
        dabs: 3,
        time: 2.5,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    const c = HABITS.coral
    expect([u('size'), u('size', 1), u('agents'), u('step'), u('palette'), u('dabs')]).toEqual([
      300, 200, 1234, 77, 2, 3,
    ])
    expect([
      f('sense_angle'),
      f('sense_dist'),
      f('turn'),
      f('speed'),
      f('decay'),
      f('deposit'),
      f('diffuse'),
      f('time'),
    ]).toEqual(
      [c.senseAngle, c.senseDist, c.turn, c.speed, c.decay, c.deposit, c.diffuse, 2.5].map(
        Math.fround,
      ),
    )
  })

  it('smells food as strongly, and feeds it into the trail as fast, as the shader does', () => {
    expect(step).toContain(`const FOOD_SMELL = ${FOOD_SMELL.toFixed(1)};`)
    expect(step).toContain(`const FOOD_SOURCE = ${FOOD_SOURCE.toFixed(1)};`)
    // and deposits with atomics: a plain write loses agents (the probe measured 21 of 60,000)
    expect(step).toContain('atomicAdd(&deposits[cell(p)], 1u);')
  })
})

describe('turning', () => {
  it('goes straight when ahead smells strongest, swings either way when ahead is weakest', () => {
    expect(turnFor(5, 1, 2, 0.3, 0.4)).toBe(0)
    expect(turnFor(1, 5, 5, 0.3, 0.4)).toBe(-0.4)
    expect(turnFor(1, 5, 5, 0.7, 0.4)).toBe(0.4)
  })

  it('turns towards whichever side smells stronger', () => {
    expect(turnFor(3, 4, 1, 0.5, 0.4)).toBe(0.4)
    expect(turnFor(3, 1, 4, 0.5, 0.4)).toBe(-0.4)
  })
})

describe('the trail', () => {
  const w = 30
  const h = 20
  const empty = () => new Uint32Array(w * h)
  const blob = () => {
    const t = new Float32Array(w * h)
    t[10 * w + 15] = 900
    return t
  }
  const sum = (t: Float32Array) => t.reduce((a, b) => a + b, 0)

  it('spreads without losing any, away from the edges, when nothing decays', () => {
    let t: Float32Array = blob()
    for (let s = 0; s < 5; s++) t = stepTrail(t, empty(), empty(), w, h, 0, 5, 0.35)
    expect(sum(t)).toBeCloseTo(900, 2)
    expect(t[10 * w + 15]).toBeLessThan(900)
    expect(t[10 * w + 16]).toBeGreaterThan(0)
  })

  it('moves each cell only part of the way to its neighbours, which is what keeps veins fine', () => {
    const t = stepTrail(blob(), empty(), empty(), w, h, 0, 5, 0.35)
    // the blob keeps (1 − diffuse) of itself, plus its own ninth of the mean
    expect(t[10 * w + 15]).toBeCloseTo(900 * (1 - 0.35 + 0.35 / 9), 2)
    expect(t[10 * w + 16]).toBeCloseTo((900 / 9) * 0.35, 2)
  })

  it('loses exactly its decay each step, and gains exactly what was laid', () => {
    const dep = empty()
    dep[3] = 2
    const t = stepTrail(blob(), dep, empty(), w, h, 0.1, 5, 0.35)
    expect(sum(t)).toBeCloseTo(900 * 0.9 + 2 * 5, 2)
  })

  it('is fed by food every step, and is nothing inside a wall', () => {
    const k = empty()
    k[5] = FOOD
    k[10 * w + 15] = WALL
    const t = stepTrail(blob(), empty(), k, w, h, 0, 5, 0.35)
    expect(t[5]).toBeCloseTo(FOOD_SOURCE, 6)
    expect(t[10 * w + 15]).toBe(0)
  })
})

describe('starting', () => {
  it('scatters agents across the whole grid, facing every way', () => {
    let s = 1
    const rand = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296
    const a = seedAgents(4000, 100, 60, rand)
    const quarters = [0, 0, 0, 0]
    for (let i = 0; i < 4000; i++) {
      expect(a[i * 4]).toBeGreaterThanOrEqual(0)
      expect(a[i * 4]).toBeLessThan(100)
      quarters[(a[i * 4] < 50 ? 0 : 1) + (a[i * 4 + 1] < 30 ? 0 : 2)]++
    }
    for (const q of quarters) expect(q).toBeGreaterThan(800)
  })

  it('lays a maze that has a way through from one food to the other, and makes it wind', () => {
    const w = 120
    const h = 70
    const k = foodFor('maze', w, h)
    const foods = [...k.keys()].filter((i) => k[i] === FOOD)
    const start = foods[0]
    const goal = foods[foods.length - 1]
    const dist = new Int32Array(w * h).fill(-1)
    const queue = [start]
    dist[start] = 0
    while (queue.length) {
      const i = queue.shift()!
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || dist[j] >= 0 || k[j] === WALL) continue
        if (Math.abs((j % w) - (i % w)) > 1) continue
        dist[j] = dist[i] + 1
        queue.push(j)
      }
    }
    expect(dist[goal]).toBeGreaterThan(0)
    // the gaps alternate top and bottom, so the way through doubles back: far longer than across
    const across =
      Math.abs((goal % w) - (start % w)) + Math.abs(Math.floor(goal / w) - Math.floor(start / w))
    expect(dist[goal]).toBeGreaterThan(1.8 * across)
    expect([...k].some((v) => v === WALL)).toBe(true)
    expect(foodFor('wild', w, h).every((v) => v === NOTHING)).toBe(true)
  })
})
