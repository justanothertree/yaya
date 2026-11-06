import { describe, expect, it } from 'vitest'
import draw from './waterworks-draw.wgsl?raw'
import sim from './waterworks.wgsl?raw'
import {
  BOIL,
  CONDENSE,
  FILL,
  FREEZE,
  LEVELS,
  MAX_DROPS,
  MELT,
  NX,
  NY,
  ROOM,
  SOLID,
  STATE,
  TANK,
  inCup,
  packTank,
  paint,
  phase,
  plateField,
  pour,
  readSolved,
  rockMask,
  startingIce,
  warm,
  heatStep,
  type Rect,
} from './waterworks'
import { wgslLayout } from './wgslLayout'

describe('the shaders and this file describe one tank', () => {
  it('agree about where every field of the uniform lives, in both shaders', () => {
    const { bytes, ...rest } = TANK
    for (const code of [sim, draw]) {
      const wgsl = wgslLayout(code, 'Tank')
      expect(wgsl.offsets).toEqual(rest)
      expect(wgsl.bytes).toBe(bytes)
    }
  })
  it('write every field where the shader will look for it', () => {
    const wgsl = wgslLayout(sim, 'Tank')
    const v = new DataView(
      packTank({
        w: 800,
        h: 500,
        count: 4321,
        dt: 1 / 120,
        tool: 2,
        toolAt: [33, 44],
        toolR: 9,
        flip: 0.95,
        time: 7,
        cup: [1, 2, 3, 4],
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('grid'), u('grid', 1), u('count'), u('tool')]).toEqual([
      800,
      500,
      NX,
      NY,
      4321,
      2,
    ])
    expect([f('dt'), f('toolR'), f('toolAt'), f('toolAt', 1), f('flip'), f('time')]).toEqual(
      [1 / 120, 9, 33, 44, 0.95, 7].map(Math.fround),
    )
    expect([0, 1, 2, 3].map((i) => f('cup', i))).toEqual([1, 2, 3, 4])
  })
  it('share the thresholds that decide water, ice and steam', () => {
    for (const [name, n] of Object.entries({ FREEZE, MELT, BOIL, CONDENSE, ROOM }))
      expect(sim).toContain(`const ${name} = ${n.toFixed(1)};`)
    expect(sim).toContain(`const WATER = ${STATE.water.toFixed(1)};`)
    expect(sim).toContain(`const ICE = ${STATE.ice.toFixed(1)};`)
    expect(sim).toContain(`const STEAM = ${STATE.steam.toFixed(1)};`)
    expect(draw).toContain(`const FILL = ${FILL.toFixed(1)};`)
  })
})

describe('heat', () => {
  it('pulls a drop toward what heats it, exponentially, and the room pulls gently everywhere', () => {
    // with no source, a hot drop cools toward the room, slowly
    expect(warm(90, 0, 0, 1)).toBeLessThan(90)
    expect(warm(90, 0, 0, 1)).toBeGreaterThan(85)
    expect(warm(90, 0, 0, 1000)).toBeCloseTo(ROOM, 6)
    // under a lamp at 160 a cool drop passes boiling within a second
    let t = ROOM
    for (let k = 0; k < 120; k++) t = warm(t, 160, 4, 1 / 120)
    expect(t).toBeGreaterThan(BOIL)
    // and it settles a little short of the lamp, where the room's pull balances it
    expect(warm(ROOM, 160, 4, 100)).toBeCloseTo((160 * 4 + ROOM * 0.05) / 4.05, 6)
  })
  it('is exact in time: two half steps are one whole step', () => {
    const a = warm(warm(30, -40, 3, 0.25), -40, 3, 0.25)
    expect(a).toBeCloseTo(warm(30, -40, 3, 0.5), 12)
  })
})

describe('water, ice and steam', () => {
  it('keep their heat as steam unless something cold is near — and only steam does', () => {
    expect(heatStep(STATE.steam, 130, 0, 0, 10)).toBe(130)
    expect(heatStep(STATE.steam, 130, -40, 3, 1)).toBeLessThan(CONDENSE)
    expect(heatStep(STATE.water, 90, 0, 0, 10)).toBe(warm(90, 0, 0, 10))
    expect(heatStep(STATE.ice, -10, 0, 0, 10)).toBe(warm(-10, 0, 0, 10))
  })
  it('freeze below FREEZE, melt above MELT, boil above BOIL and condense below CONDENSE', () => {
    expect(phase(STATE.water, FREEZE - 0.1)).toBe(STATE.ice)
    expect(phase(STATE.ice, MELT + 0.1)).toBe(STATE.water)
    expect(phase(STATE.water, BOIL + 0.1)).toBe(STATE.steam)
    expect(phase(STATE.steam, CONDENSE - 0.1)).toBe(STATE.water)
  })
  it('hold their state in the gaps between, so a drop at the line does not flicker', () => {
    for (const t of [FREEZE + 0.1, 0, MELT - 0.1]) {
      expect(phase(STATE.water, t)).toBe(STATE.water)
      expect(phase(STATE.ice, t)).toBe(STATE.ice)
    }
    for (const t of [CONDENSE + 0.1, 96, BOIL - 0.1]) {
      expect(phase(STATE.water, t)).toBe(STATE.water)
      expect(phase(STATE.steam, t)).toBe(STATE.steam)
    }
    expect(phase(STATE.none, 500)).toBe(STATE.none)
    expect(FREEZE).toBeLessThan(MELT)
    expect(CONDENSE).toBeLessThan(BOIL)
  })
})

const cells = ([x, y, w, h]: Rect) => {
  const out: [number, number][] = []
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push([i, j])
  return out
}

describe('the levels', () => {
  it('each make sense: a tap and a cup in open water, inside the tank, with room for their drops', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length)
    for (const l of LEVELS) {
      const m = rockMask(l)
      const open = ([i, j]: [number, number]) =>
        i >= 0 && j >= 0 && i < NX && j < NY && m[j * NX + i] === 0
      const [sx, sy] = l.source.at
      expect(open([Math.floor(sx), Math.floor(sy)])).toBe(true)
      expect(cells(l.cup).every(open)).toBe(true)
      for (const r of l.ice ?? []) expect(cells(r).every(open)).toBe(true)
      expect(l.source.drops + startingIce(l).length / 8).toBeLessThanOrEqual(MAX_DROPS)
      expect(l.tools.length).toBeGreaterThan(0)
      // a cup has walls: the cells either side of its inside and under it are rock
      const [cx, cy, cw, ch] = l.cup
      expect(m[(cy + ch) * NX + cx]).toBe(SOLID.rock)
      expect(m[(cy + 2) * NX + cx - 1]).toBe(SOLID.rock)
      expect(m[(cy + 2) * NX + cx + cw]).toBe(SOLID.rock)
      // enough water to fill it, counting what starts as ice
      expect(l.source.drops + startingIce(l).length / 8).toBeGreaterThan(400)
    }
  })
  it('pour the same drops every time, from the tap, at room temperature, falling', () => {
    const l = LEVELS[0]
    expect(pour(l, 100, 20)).toEqual(pour(l, 100, 20))
    const d = pour(l, 0, 50)
    for (let i = 0; i < d.length; i += 8) {
      expect(Math.abs(d[i] - l.source.at[0])).toBeLessThanOrEqual(2)
      expect(d[i + 3]).toBeGreaterThan(0)
      expect([d[i + 4], d[i + 5]]).toEqual([ROOM, STATE.water])
    }
  })
  it('lay starting ice four drops to a cell, frozen', () => {
    const l = LEVELS.find((x) => x.ice)!
    const ice = startingIce(l)
    const area = (l.ice ?? []).reduce((s, [, , w, h]) => s + w * h, 0)
    expect(ice.length / 8).toBe(area * 4)
    for (let i = 0; i < ice.length; i += 8) expect(ice[i + 5]).toBe(STATE.ice)
  })
  it('put a plate’s cold where the plate is and a few cells under it, and nowhere else', () => {
    const l = LEVELS.find((x) => x.plates?.length)!
    const f = plateField(l)
    const [[x, y, w, h]] = l.plates!.map((p) => p.rect)
    expect(f[((y + h + 2) * NX + x + 1) * 2]).toBe(l.plates![0].target)
    expect(f[((y + h + 2) * NX + x + 1) * 2 + 1]).toBeGreaterThan(0)
    expect(f[((y + h + 20) * NX + x + 1) * 2 + 1]).toBe(0)
    expect(f[((y + 1) * NX + x + w + 3) * 2 + 1]).toBe(0)
  })
})

describe('drawing walls', () => {
  it('lays a stroke in open cells, never over rock, and stops when the ink does', () => {
    const l = LEVELS[0]
    const m = rockMask(l)
    const used = paint(m, [10, 50], [60, 50], 1.5, false, 1000)
    expect(used).toBeGreaterThan(100)
    expect(m[50 * NX + 30]).toBe(SOLID.drawn)
    expect(m[0]).toBe(SOLID.rock)
    // across the frame and into it: the frame stays rock
    const m2 = rockMask(l)
    paint(m2, [0, 30], [8, 30], 3, false, 1000)
    expect(m2[30 * NX + 0]).toBe(SOLID.rock)
    // a short ink supply
    const m3 = rockMask(l)
    expect(paint(m3, [10, 50], [100, 50], 2, false, 25)).toBe(25)
    expect(m3.filter((c) => c === SOLID.drawn).length).toBe(25)
  })
  it('erases only what was drawn, and gives the ink back', () => {
    const l = LEVELS[0]
    const m = rockMask(l)
    const used = paint(m, [10, 50], [60, 50], 1.5, false, 1000)
    const back = paint(m, [0, 50], [159, 50], 3, true, 0)
    expect(back).toBe(-used)
    expect(m.filter((c) => c === SOLID.drawn).length).toBe(0)
    expect(m.filter((c) => c === SOLID.rock).length).toBe(
      rockMask(l).filter((c) => c === SOLID.rock).length,
    )
  })
})

describe('the cup', () => {
  it('counts water inside it, and not ice, steam or water outside', () => {
    const cup: Rect = [10, 10, 5, 5]
    const d = new Float32Array(5 * 8)
    const put = (i: number, x: number, y: number, s: number) =>
      d.set([x, y, 0, 0, 20, s, 0, 0], i * 8)
    put(0, 12, 12, STATE.water)
    put(1, 14.9, 14.9, STATE.water)
    put(2, 12, 12, STATE.ice)
    put(3, 12, 12, STATE.steam)
    put(4, 15, 12, STATE.water)
    expect(inCup(d, 5, cup)).toBe(2)
    expect(inCup(d, 1, cup)).toBe(1)
  })
})

describe('progress', () => {
  it('believes only known level ids from storage, once each', () => {
    expect(readSolved(JSON.stringify(['pour', 'steam', 'pour']))).toEqual(['pour', 'steam'])
    for (const bad of [null, '', 'nope', '{"pour":1}', '[1,2]', '["../x"]', '"pour"'])
      expect(readSolved(bad)).toEqual([])
    expect(readSolved('["pour", 7, "nope"]')).toEqual(['pour'])
  })
})
