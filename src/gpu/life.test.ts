import { describe, expect, it } from 'vitest'
import types from './life-types.wgsl?raw'
import step from './life-step.wgsl?raw'
import {
  ALIVE,
  DECAY,
  LIFE,
  MAX_CELLS,
  TILE,
  TRAIL,
  generationsDue,
  gridFor,
  lifeStep,
  packLife,
  patternCells,
  stampRuns,
  toCell,
  type LifeParams,
  type PatternId,
} from './life'
import { wgslLayout } from './wgslLayout'

/** a board from rows of text, `#` alive */
function board(...lines: string[]) {
  const cols = lines[0].length
  const rows = lines.length
  const cells: Uint32Array = new Uint32Array(cols * rows)
  lines.forEach((l, y) => [...l].forEach((ch, x) => (cells[y * cols + x] = ch === '#' ? ALIVE : 0)))
  return { cells, cols, rows }
}
const aliveAt = (cells: Uint32Array, cols: number) =>
  [...cells].flatMap((v, i) => (v === ALIVE ? [[i % cols, Math.floor(i / cols)]] : []))

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(types, 'Life')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = LIFE
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: LifeParams = {
      cols: 321,
      rows: 123,
      brush: [12.5, 7.25],
      view: [1600, 900],
      radius: 1.75,
      paint: 2,
      seed: 99,
    }
    const v = new DataView(packLife(p))
    const f = (name: string, k = 0) => v.getFloat32(wgsl.offsets[name] + k, true)
    const u = (name: string) => v.getUint32(wgsl.offsets[name], true)
    expect([u('cols'), u('rows'), u('paint'), u('seed')]).toEqual([321, 123, 2, 99])
    expect([f('brush'), f('brush', 4), f('view'), f('view', 4), f('radius')]).toEqual([
      12.5, 7.25, 1600, 900, 1.75,
    ])
  })

  it('shares its constants and its tile with the shader', () => {
    const constant = (name: string) =>
      Number(types.match(new RegExp(`const ${name} = (\\d+)u;`))?.[1])
    expect([constant('ALIVE'), constant('TRAIL'), constant('DECAY')]).toEqual([ALIVE, TRAIL, DECAY])
    const tiles = [...step.matchAll(/@workgroup_size\((\d+), (\d+)\)/g)]
    expect(tiles.length).toBe(3)
    for (const t of tiles) expect([Number(t[1]), Number(t[2])]).toEqual([TILE, TILE])
  })
})

/* the reference rule, checked against Life's own well-known shapes rather than against itself */
describe('the rule', () => {
  it('turns a blinker on its side, and back', () => {
    const b = board('.....', '.....', '.###.', '.....', '.....')
    const once = lifeStep(b.cells, b.cols, b.rows)
    expect(aliveAt(once, b.cols)).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
    ])
    expect(aliveAt(lifeStep(once, b.cols, b.rows), b.cols)).toEqual(aliveAt(b.cells, b.cols))
  })

  it('leaves a block alone', () => {
    const b = board('....', '.##.', '.##.', '....')
    expect(aliveAt(lifeStep(b.cells, b.cols, b.rows), b.cols)).toEqual(aliveAt(b.cells, b.cols))
  })

  it('moves a glider one cell down and right every four generations, across the wrap', () => {
    const b = board('.#......', '..#.....', '###.....', ...Array(5).fill('........'))
    let cells = b.cells
    for (let i = 0; i < 4 * 8; i++) cells = lifeStep(cells, b.cols, b.rows)
    // 32 generations is 8 cells on an 8-wide board: all the way round and home again
    expect(aliveAt(cells, b.cols)).toEqual(aliveAt(b.cells, b.cols))
    cells = b.cells
    for (let i = 0; i < 4; i++) cells = lifeStep(cells, b.cols, b.rows)
    const shifted = aliveAt(b.cells, b.cols).map(([x, y]) => [x + 1, y + 1])
    expect(aliveAt(cells, b.cols)).toEqual(shifted)
  })

  it('leaves a trail that fades to nothing and never counts as a neighbour', () => {
    const b = board('...', '.#.', '...')
    let cells = lifeStep(b.cells, b.cols, b.rows)
    expect(cells[4]).toBe(TRAIL)
    let gens = 1
    while (cells[4] > 0) {
      cells = lifeStep(cells, b.cols, b.rows)
      gens++
    }
    expect(gens).toBe(Math.ceil(TRAIL / DECAY) + 1)
    // a ring of trail around an empty cell is not three neighbours
    const ring = new Uint32Array(9).fill(TRAIL)
    ring[4] = 0
    expect(lifeStep(ring, 3, 3)[4]).not.toBe(ALIVE)
  })
})

describe('the board', () => {
  it('fits whole cells to the canvas', () => {
    expect(gridFor(1300, 560, 5)).toEqual({ cols: 260, rows: 112 })
  })

  it('never goes under 16 a side', () => {
    expect(gridFor(20, 20, 9)).toEqual({ cols: 16, rows: 16 })
  })

  it('shrinks evenly rather than passing the cap', () => {
    const g = gridFor(8000, 4000, 1)
    expect(g.cols * g.rows).toBeLessThanOrEqual(MAX_CELLS)
    expect(g.cols / g.rows).toBeCloseTo(2, 1)
  })

  it('puts a press in the cell under it', () => {
    const [x, y] = toCell(150, 50, 300, 100, 60, 20)
    expect([Math.floor(x), Math.floor(y)]).toEqual([30, 10])
  })
})

describe('time', () => {
  it('runs generations at the speed asked, carrying the remainder', () => {
    let carry = 0
    let total = 0
    for (let i = 0; i < 60; i++) {
      const d = generationsDue(carry, 1 / 60, 15)
      carry = d.carry
      total += d.run
    }
    expect(total).toBe(15)
  })

  it('slows down rather than jumping when a frame is slow', () => {
    expect(generationsDue(0, 1, 60)).toEqual({ run: 4, carry: 0 })
  })
})

describe('the patterns do what they are famous for', () => {
  /** a pattern alone in the middle of an empty board big enough not to meet itself */
  const alone = (id: PatternId, cols = 90, rows = 60) => {
    let cells: Uint32Array = new Uint32Array(cols * rows)
    for (const run of stampRuns(patternCells(id), cols, rows, cols / 2, rows / 2))
      cells.set(run.cells, run.at)
    const pop = () => cells.filter((v) => v === ALIVE).length
    const run = (n: number) => {
      for (let i = 0; i < n; i++) cells = lifeStep(cells, cols, rows)
    }
    return {
      pop,
      run,
      get cells() {
        return cells
      },
    }
  }

  it('a glider keeps its five cells while it travels', () => {
    const g = alone('glider')
    g.run(40)
    expect(g.pop()).toBe(5)
  })

  it('a spaceship keeps its nine cells while it travels', () => {
    const g = alone('spaceship')
    g.run(40)
    expect(g.pop()).toBe(9)
  })

  it('a pulsar comes back every three generations', () => {
    const g = alone('pulsar')
    const start = aliveAt(g.cells, 90)
    g.run(3)
    expect(aliveAt(g.cells, 90)).toEqual(start)
  })

  it('the gun fires a glider every thirty generations', () => {
    const g = alone('gun', 120, 80)
    const at0 = g.pop()
    g.run(30)
    const at30 = g.pop()
    g.run(30)
    expect(at0).toBe(36)
    expect(at30 - at0).toBe(5)
    expect(g.pop() - at30).toBe(5)
  })

  it('an acorn of seven cells grows into something far bigger', () => {
    const g = alone('acorn', 200, 140)
    g.run(200)
    expect(g.pop()).toBeGreaterThan(100)
  })
})

describe('stamping', () => {
  it('centres the pattern on the cell asked for', () => {
    const runs = stampRuns(patternCells('glider'), 20, 20, 10, 10)
    expect(runs.map((r) => r.at)).toEqual([9 * 20 + 9, 10 * 20 + 9, 11 * 20 + 9])
  })

  it('wraps a pattern across the edge, losing no cells', () => {
    const p = patternCells('spaceship')
    const runs = stampRuns(p, 16, 16, 15, 0)
    const board = new Uint32Array(16 * 16)
    for (const r of runs) {
      expect(r.at + r.cells.length).toBeLessThanOrEqual(board.length)
      // a run never crosses a row's end — that would be wrapping the wrong way
      expect(Math.floor(r.at / 16)).toBe(Math.floor((r.at + r.cells.length - 1) / 16))
      board.set(r.cells, r.at)
    }
    expect(board.filter((v) => v === ALIVE).length).toBe(9)
    expect(runs.length).toBeGreaterThan(p.h)
  })

  it('crops a pattern bigger than the board rather than folding it onto itself', () => {
    const runs = stampRuns(patternCells('gun'), 16, 16, 8, 8)
    for (const r of runs) expect(r.cells.length).toBeLessThanOrEqual(16)
    expect(new Set(runs.map((r) => Math.floor(r.at / 16))).size).toBe(9)
  })
})
