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
  toCell,
  type LifeParams,
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
