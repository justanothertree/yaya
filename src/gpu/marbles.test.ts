import { describe, expect, it } from 'vitest'
import code from './marbles.wgsl?raw'
import {
  DMAX,
  HASH,
  KIND,
  MAZE,
  RADIUS,
  distanceField,
  hashCell,
  hashSort,
  mazeFor,
  sampleField,
  startOf,
  stepMarbles,
  type Board,
  type Marbles,
} from './marbles'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
const open = (w: number, h: number): Board => {
  const kind = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) kind[x] = kind[(h - 1) * w + x] = KIND.wall
  for (let y = 0; y < h; y++) kind[y * w] = kind[y * w + w - 1] = KIND.wall
  return { w, h, kind }
}
const marbles = (pts: [number, number][]): Marbles => ({
  x: Float32Array.from(pts.map((p) => p[0])),
  y: Float32Array.from(pts.map((p) => p[1])),
  vx: new Float32Array(pts.length),
  vy: new Float32Array(pts.length),
  alive: pts.map(() => true),
})

describe('the shader and this file describe one maze', () => {
  const wgsl = wgslLayout(code, 'Maze')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = MAZE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('rolls marbles of the same size, in cells of the same size, off the same field', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+)`).exec(code)?.[1])
    expect([num('RADIUS'), num('HASH'), num('DMAX')]).toEqual([RADIUS, HASH, DMAX])
  })
})

describe('the counting sort', () => {
  it('puts every marble in exactly once, grouped by cell, cell after cell', () => {
    const rand = lcg(4)
    const n = 3000
    const xs = Float32Array.from({ length: n }, () => rand() * 200)
    const ys = Float32Array.from({ length: n }, () => rand() * 120)
    const alive = Array.from({ length: n }, () => rand() > 0.1)
    const cols = Math.ceil(200 / HASH)
    const rows = Math.ceil(120 / HASH)
    const { order, start } = hashSort(xs, ys, alive, cols, rows)
    expect(order.length).toBe(alive.filter(Boolean).length)
    expect(new Set(order).size).toBe(order.length)
    for (let c = 0; c < cols * rows; c++)
      for (let k = start[c]; k < start[c + 1]; k++)
        expect(hashCell(xs[order[k]], ys[order[k]], cols, rows)).toBe(c)
    expect([...order].every((i) => alive[i])).toBe(true)
  })
})

describe('the board', () => {
  it('knows how far each place is from the nearest wall, near enough to Euclid', () => {
    const b = open(40, 30)
    b.kind[15 * 40 + 20] = KIND.wall
    const d = distanceField(b)
    for (const [x, y] of [
      [23, 15],
      [20, 19],
      [24, 18],
      [22, 17],
    ]) {
      const euclid = Math.min(Math.hypot(x - 20, y - 15), x, y, 39 - x, 29 - y)
      expect(d[y * 40 + x]).toBeGreaterThanOrEqual(euclid - 1e-6)
      expect(d[y * 40 + x]).toBeLessThan(euclid * 1.09 + 1e-6)
    }
    // and stops caring past DMAX
    expect(Math.max(...distanceField(open(60, 60)))).toBe(DMAX)
  })

  it('goes below zero inside a wall, with its slope pointing out of it', () => {
    const b = open(40, 30)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) b.kind[y * 40 + x] = KIND.wall
    const d = distanceField(b)
    const deep = sampleField(d, 40, 30, 12.5, 15)
    expect(deep.d).toBeLessThan(-1)
    // nearest way out of the slab from x = 12.5 is left, through x = 10
    expect(deep.n[0]).toBeLessThan(-0.7)
  })

  it('carves a maze where every open place can be reached from the start', () => {
    const w = 240
    const h = 150
    const kind = mazeFor(w, h, 7)
    const [sx, sy] = startOf(w, h)
    const seen = new Uint8Array(w * h)
    const queue = [sy * w + sx]
    seen[queue[0]] = 1
    while (queue.length) {
      const i = queue.pop()!
      for (const j of [i - 1, i + 1, i - w, i + w])
        if (j >= 0 && j < w * h && !seen[j] && kind[j] !== KIND.wall) {
          seen[j] = 1
          queue.push(j)
        }
    }
    let unreachable = 0
    let holes = 0
    for (let i = 0; i < w * h; i++) {
      if (kind[i] !== KIND.wall && !seen[i]) unreachable++
      if (kind[i] === KIND.hole) holes++
    }
    expect(unreachable).toBe(0)
    expect(holes).toBeGreaterThan(0)
  })
})

describe('the marbles', () => {
  const dt = 1 / 180

  it('push two overlapping marbles apart to just touching, evenly, without moving their middle', () => {
    const b = open(40, 40)
    const d = distanceField(b)
    const m = marbles([
      [19, 20],
      [21, 20],
    ])
    stepMarbles(m, b, d, [0, 0], dt)
    expect(m.x[1] - m.x[0]).toBeCloseTo(2 * RADIUS, 5)
    expect((m.x[0] + m.x[1]) / 2).toBeCloseTo(20, 5)
    expect(m.vx[0]).toBeCloseTo(-m.vx[1], 3)
  })

  it('never shoot out of the board, however crowded they start', () => {
    const b = open(40, 30)
    const d = distanceField(b)
    const rand = lcg(2)
    // 300 marbles in a corner a fraction of their size: far more crowded than any pour
    const m = marbles(
      Array.from({ length: 300 }, () => [2 + rand() * 12, 2 + rand() * 8] as [number, number]),
    )
    for (let k = 0; k < 600; k++) stepMarbles(m, b, d, [100, 100], dt)
    for (let i = 0; i < 300; i++) {
      expect(m.x[i]).toBeGreaterThan(0)
      expect(m.y[i]).toBeGreaterThan(0)
      expect(m.x[i]).toBeLessThan(40)
      expect(m.y[i]).toBeLessThan(30)
    }
  })

  it('never leave a marble inside a wall', () => {
    const b = open(40, 40)
    const d = distanceField(b)
    const rand = lcg(9)
    // 100 marbles fill about half the box: room for all of them, however they heap
    const m = marbles(
      Array.from({ length: 100 }, () => [2 + rand() * 36, 2 + rand() * 36] as [number, number]),
    )
    for (let k = 0; k < 400; k++) stepMarbles(m, b, d, [300, 120], dt)
    for (let i = 0; i < 100; i++)
      expect(sampleField(d, 40, 40, m.x[i], m.y[i]).d).toBeGreaterThan(RADIUS - 0.2)
  })

  it('roll downhill and come to rest heaped against the low wall', () => {
    const b = open(60, 40)
    const d = distanceField(b)
    const m = marbles(
      Array.from(
        { length: 30 },
        (_, i) => [10 + (i % 10) * 4, 8 + Math.floor(i / 10) * 4] as [number, number],
      ),
    )
    for (let k = 0; k < 1500; k++) stepMarbles(m, b, d, [0, 200], dt)
    expect(Math.min(...m.y)).toBeGreaterThan(25)
    expect(Math.max(...m.vy.map(Math.abs))).toBeLessThan(5)
  })

  it('drop into a hole and are counted', () => {
    const b = open(40, 40)
    for (let y = 30; y < 36; y++) for (let x = 17; x < 23; x++) b.kind[y * 40 + x] = KIND.hole
    const d = distanceField(b)
    const m = marbles([[20, 10]])
    let fell = 0
    for (let k = 0; k < 600 && !fell; k++) fell += stepMarbles(m, b, d, [0, 200], dt)
    expect(fell).toBe(1)
    expect(m.alive[0]).toBe(false)
  })
})
