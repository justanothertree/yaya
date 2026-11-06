import { describe, expect, it } from 'vitest'
import code from './seedling.wgsl?raw'
import {
  CELLS,
  GARDEN,
  COLS,
  GLIDER,
  LEVELS,
  MAX_LAMPS,
  ROWS,
  RULES,
  SOLUTIONS,
  at,
  blankLevel,
  paintStone,
  runsOf,
  setPatch,
  stampAt,
  stonesOf,
  tapSeeds,
  toggleLamp,
  gardenFit,
  marksOf,
  packGarden,
  grow,
  inRect,
  parseRule,
  plant,
  readLevel,
  ruleText,
  step,
  turn,
  type Level,
  type Rule,
  type V2,
} from './seedling'
import { wgslLayout } from './wgslLayout'

const board = (cells: V2[]) => {
  const b = new Uint8Array(CELLS)
  for (const [x, y] of cells) b[at(x, y)] = 1
  return b
}
const live = (b: Uint8Array) => {
  const out: V2[] = []
  b.forEach((v, i) => v && out.push([i % COLS, Math.floor(i / COLS)]))
  return out
}
const none = new Uint8Array(CELLS)
const run = (b: Uint8Array, n: number, stones = none, rule: Rule = RULES.life) => {
  for (let k = 0; k < n; k++) b = step(b, stones, rule)
  return b
}

describe('rules', () => {
  it('are written and read in B/S notation', () => {
    expect(ruleText(RULES.life)).toBe('B3/S23')
    expect(ruleText(RULES.seeds)).toBe('B2/S')
    expect(ruleText(RULES.maze)).toBe('B3/S12345')
    for (const r of Object.values(RULES))
      expect(parseRule(ruleText(r))).toEqual({ born: r.born, stays: r.stays })
    expect(parseRule('b36/s23')).toEqual({ born: RULES.highlife.born, stays: RULES.highlife.stays })
    expect(parseRule('B03/S23')).toBeNull()
    expect(parseRule('B9/S23')).toBeNull()
    expect(parseRule('nonsense')).toBeNull()
  })
})

describe('a generation', () => {
  it('keeps Conway’s classics: a block stays, a blinker turns, a glider walks a cell diagonally in four', () => {
    const block = board([
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ])
    expect(run(block, 7)).toEqual(block)
    const blinker = board([
      [10, 10],
      [11, 10],
      [12, 10],
    ])
    expect(live(run(blinker, 1))).toEqual([
      [11, 9],
      [11, 10],
      [11, 11],
    ])
    expect(run(blinker, 2)).toEqual(blinker)
    const g = board(GLIDER.map(([x, y]) => [x + 4, y + 4] as V2))
    expect(run(g, 4)).toEqual(board(GLIDER.map(([x, y]) => [x + 5, y + 5] as V2)))
  })
  it('a turned glider walks the turned way', () => {
    // a quarter clockwise turns down-right into down-left
    const g = board(turn(GLIDER, 1).map(([x, y]) => [x + 10, y + 4] as V2))
    expect(run(g, 4)).toEqual(board(turn(GLIDER, 1).map(([x, y]) => [x + 9, y + 5] as V2)))
  })
  it('treats the edge as dead ground, never wrapping round', () => {
    // a blinker standing on the left edge: a torus would let cells at the far right count it
    const edge = board([
      [0, 4],
      [0, 5],
      [0, 6],
    ])
    expect(live(run(edge, 1))).toEqual([
      [0, 5],
      [1, 5],
    ])
    expect(run(edge, 1)[at(COLS - 1, 5)]).toBe(0)
  })
  it('never brings a stone to life, so a stone cuts a blinker', () => {
    const stones = board([[11, 9]])
    const b = board([
      [10, 10],
      [11, 10],
      [12, 10],
    ])
    expect(live(run(b, 1, stones))).toEqual([
      [11, 10],
      [11, 11],
    ])
  })
  it('runs other rules: in Seeds every live cell dies and two neighbours make one', () => {
    const pair = board([
      [10, 10],
      [11, 10],
    ])
    expect(live(run(pair, 1, none, RULES.seeds))).toEqual([
      [10, 9],
      [11, 9],
      [10, 11],
      [11, 11],
    ])
  })
})

describe('planting', () => {
  const l = LEVELS[0]
  it('takes seeds only in the patch, once each, and only up to the budget', () => {
    const [px, py] = l.patch
    const p = plant(l, [
      [0, 0],
      [px, py],
      [px, py],
      [px + 1, py],
      [px + 2, py],
      [px + 3, py],
      [px + 4, py],
      [px, py + 1],
    ])
    expect(p.used).toBe(l.budget)
    expect(p.cells[at(0, 0)]).toBe(0)
    expect(p.cells[at(px, py + 1)]).toBe(0)
  })
})

describe('the gardens', () => {
  it('every one fails untouched and is solved by its stored solution, within the budget and the patch', () => {
    expect(SOLUTIONS).toHaveLength(LEVELS.length)
    LEVELS.forEach((l, k) => {
      expect(grow(l, []).solved, l.name).toBe(-1)
      const s = SOLUTIONS[k]
      expect(s.length, l.name).toBeLessThanOrEqual(l.budget)
      expect(
        s.every(([x, y]) => inRect(l.patch, x, y)),
        l.name,
      ).toBe(true)
      const out = grow(l, s)
      expect(out.solved, l.name).toBeGreaterThan(0)
      expect(out.solved, l.name).toBeLessThanOrEqual(l.gens)
      expect(
        out.lit.every((g) => g > 0),
        l.name,
      ).toBe(true)
      // and each garden is a valid garden file
      expect(readLevel(JSON.stringify(l)), l.name).toEqual({
        ...l,
        rule: { born: l.rule.born, stays: l.rule.stays },
      })
    })
  })
  it('the gap is the point: the same glider two cells left is cut by the wall and never lights the lamp', () => {
    const l = LEVELS[2]
    expect(grow(l, SOLUTIONS[2]).solved).toBeGreaterThan(0)
    expect(
      grow(
        l,
        SOLUTIONS[2].map(([x, y]) => [x - 2, y] as V2),
      ).solved,
    ).toBe(-1)
    // without the wall that same glider gets there, so the wall is what decides it
    expect(
      grow(
        { ...l, stones: [] },
        SOLUTIONS[2].map(([x, y]) => [x - 2, y] as V2),
      ).solved,
    ).toBeGreaterThan(0)
  })
  it('one glider does not do two lamps: half of Both ways is not a solution', () => {
    expect(grow(LEVELS[1], SOLUTIONS[1].slice(0, 5)).solved).toBe(-1)
    expect(grow(LEVELS[1], SOLUTIONS[1].slice(5)).solved).toBe(-1)
  })
})

describe('a garden as a file', () => {
  const made: Level = {
    name: 'Mine',
    hint: 'Try it',
    rule: { born: 0b1001000, stays: 0b1100 },
    gens: 77,
    budget: 7,
    patch: [3, 4, 5, 6],
    stones: [
      [20, 1, 2, 3],
      [0, 19, 32, 1],
    ],
    lamps: [
      [30, 2],
      [12, 12],
    ],
  }
  it('comes back field for field', () => {
    expect(readLevel(JSON.stringify(made))).toEqual(made)
  })
  it('refuses what is not a fair garden, saying why', () => {
    const bad = (o: object) => readLevel(JSON.stringify({ ...made, ...o }))
    expect(readLevel('x'.repeat(60_000))).toMatch(/too big/)
    expect(readLevel('{')).toMatch(/not JSON/)
    expect(readLevel('[]')).toMatch(/name/)
    expect(bad({ rule: { born: 0b1001, stays: 4 } })).toMatch(/rule/)
    expect(bad({ rule: { born: 8, stays: 1024 } })).toMatch(/rule/)
    expect(bad({ gens: 0 })).toMatch(/generations/)
    expect(bad({ gens: 2.5 })).toMatch(/generations/)
    expect(bad({ budget: 99 })).toMatch(/seeds/)
    expect(bad({ patch: [30, 0, 5, 1] })).toMatch(/patch/)
    expect(bad({ stones: [[0, 0, 1, 99]] })).toMatch(/stones/)
    expect(bad({ lamps: [] })).toMatch(/lamps/)
    expect(bad({ lamps: Array.from({ length: MAX_LAMPS + 1 }, (_, i) => [i % COLS, 0]) })).toMatch(
      /lamps/,
    )
    expect(bad({ lamps: [[COLS, 0]] })).toMatch(/lamps/)
    expect(bad({ lamps: [[4, 5]] })).toMatch(/patch/)
    expect(bad({ lamps: [[21, 2]] })).toMatch(/stone/)
    expect(bad({ name: { toString: 1 } })).toMatch(/name/)
    expect(ROWS).toBe(20)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Garden')
    const { bytes, ...rest } = GARDEN
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packGarden({
        w: 640,
        h: 400,
        patch: [3, 4, 5, 6],
        rule: RULES.maze,
        time: 2,
        phase: 0.25,
        planting: true,
      }),
    )
    const u = (o: number) => v.getUint32(o, true)
    expect([0, 4, 8, 12].map((k) => u(k))).toEqual([640, 400, COLS, ROWS])
    expect([0, 4, 8, 12].map((k) => u(GARDEN.plot + k))).toEqual([3, 4, 5, 6])
    expect([u(GARDEN.born), u(GARDEN.stays), u(GARDEN.planting)]).toEqual([8, 0b111110, 1])
    expect([v.getFloat32(GARDEN.time, true), v.getFloat32(GARDEN.phase, true)]).toEqual([2, 0.25])
  })
  it('marks stones 1 and lamps 2, the bits the shader reads', () => {
    const m = marksOf(LEVELS[2])
    expect(m[at(17, 0)]).toBe(1)
    expect(m[at(17, 7)]).toBe(0)
    expect(m[at(25, 18)]).toBe(2)
    expect(code).toMatch(/const STONE = 1u;/)
    expect(code).toMatch(/const LAMP = 2u;/)
  })
  it('fits the garden to a wide stage the right way up and stands it up on a tall one, not mirrored', () => {
    // 20 px a cell, a 10 px hedge each side
    expect(gardenFit([660, 420], [330, 210])).toEqual([COLS / 2, ROWS / 2])
    const [x0, y0] = gardenFit([660, 420], [10, 10])
    expect([x0, y0].map((n) => Math.abs(n) < 1e-9)).toEqual([true, true])
    const tall: [number, number] = [420, 660]
    expect(gardenFit(tall, [210, 330])).toEqual([COLS / 2, ROWS / 2])
    expect(gardenFit(tall, [210, 650])[0]).toBeCloseTo(0, 9)
    const right = gardenFit(tall, [300, 330])
    expect(right[0]).toBeCloseTo(COLS / 2, 9)
    expect(right[1]).toBeGreaterThan(ROWS / 2)
  })
})

describe('planting by hand', () => {
  const l = LEVELS[0]
  it('a tap plants a cell and a second tap takes it back up', () => {
    const a = tapSeeds(l, [], stampAt('cell', 0, 3, 3))
    expect(a.seeds).toEqual([[3, 3]])
    expect(tapSeeds(l, a.seeds, stampAt('cell', 0, 3, 3)).seeds).toEqual([])
  })
  it('a glider stamp centred on the tap is the glider, and stamps nothing outside the patch', () => {
    const g = tapSeeds(l, [], stampAt('glider', 0, 3, 3))
    expect(g.seeds).toEqual(GLIDER.map(([x, y]) => [x + 2, y + 2]))
    expect(grow(l, g.seeds).solved).toBeGreaterThan(0)
    // at the patch's corner most of it would fall outside: nothing is half-planted
    const edge = tapSeeds(l, [], stampAt('glider', 0, 2, 2))
    expect(edge.seeds).toEqual([])
    expect(edge.why).toMatch(/does not fit/)
  })
  it('refuses a stamp that would pass the budget, keeping what was planted and saying why', () => {
    const one = tapSeeds(l, [], [[2, 6]]).seeds
    const over = tapSeeds(l, one, stampAt('glider', 0, 4, 4))
    expect(over.seeds).toEqual(one)
    expect(over.why).toMatch(/gives 5 seeds/)
  })
})

describe('making a garden', () => {
  it('keeps stones as runs along each row, round trip through the mask', () => {
    let l = blankLevel()
    for (const x of [20, 21, 22, 25]) l = paintStone(l, x, 3, true)
    expect(l.stones).toEqual([
      [20, 3, 3, 1],
      [25, 3, 1, 1],
    ])
    expect(runsOf(stonesOf(l))).toEqual(l.stones)
    l = paintStone(l, 21, 3, false)
    expect(l.stones).toEqual([
      [20, 3, 1, 1],
      [22, 3, 1, 1],
      [25, 3, 1, 1],
    ])
  })
  it('a stone laid on a lamp puts the lamp out; none goes in the patch', () => {
    let l = blankLevel()
    l = paintStone(l, 27, 10, true)
    expect(l.lamps).toEqual([])
    expect(paintStone(l, 3, 8, true)).toBe(l)
  })
  it('lamps toggle, never in the patch or on a stone', () => {
    let l = blankLevel()
    l = toggleLamp(l, 10, 2)
    expect(l.lamps).toContainEqual([10, 2])
    expect(toggleLamp(l, 10, 2).lamps).not.toContainEqual([10, 2])
    expect(toggleLamp(l, 3, 8)).toBe(l)
    l = paintStone(l, 12, 2, true)
    expect(toggleLamp(l, 12, 2)).toBe(l)
  })
  it('a dragged patch is the rectangle between the corners, whichever way, clearing what was under it', () => {
    let l = paintStone(blankLevel(), 15, 15, true)
    l = toggleLamp(l, 14, 14)
    l = setPatch(l, [16, 16], [13, 13])
    expect(l.patch).toEqual([13, 13, 4, 4])
    expect(l.stones).toEqual([])
    expect(l.lamps).toEqual([[27, 10]])
    // a drag off the board stops at its edge
    expect(setPatch(l, [-5, -5], [2, 1]).patch).toEqual([0, 0, 3, 2])
  })
  it('a fresh garden is a valid garden file that is not already solved', () => {
    const b = blankLevel()
    expect(readLevel(JSON.stringify(b))).toEqual(b)
    expect(grow(b, []).solved).toBe(-1)
  })
})
