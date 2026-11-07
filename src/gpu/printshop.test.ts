import { describe, expect, it } from 'vitest'
import code from './printshop.wgsl?raw'
import {
  BH,
  BW,
  FILE_LIMIT,
  GOUGES,
  INKS,
  MAX_POINTS,
  MAX_STEPS,
  PAPER,
  SHOP,
  SURFACE,
  blockAt,
  carveHeight,
  carveStroke,
  cutBox,
  grain,
  inkOn,
  layer,
  layout,
  mirrorX,
  packShop,
  readWork,
  follow,
  GAP,
  undoable,
  type Gouge,
  type Step,
  type V2,
} from './printshop'
import { wgslLayout } from './wgslLayout'

/** how many texels across a straight cut print as paper: the line it leaves, measured on a print */
const whiteAcross = (g: Gouge) => {
  let n = 0
  for (let y = 0; y < 60; y++) {
    const h = carveHeight(1, [50.5, y + 0.5], [0, 30], [100, 30], g)
    if (inkOn(h, 0, y, 1, 7) === 0) n++
  }
  return n
}

describe('carving', () => {
  it('each gouge leaves a line of its own width on the print: fine, medium, a broad clearing', () => {
    const v = whiteAcross('v')
    const u = whiteAcross('u')
    const scoop = whiteAcross('scoop')
    expect(v).toBeGreaterThanOrEqual(2)
    expect(v).toBeLessThanOrEqual(3)
    expect(u).toBeGreaterThanOrEqual(8)
    expect(u).toBeLessThanOrEqual(10)
    expect(scoop).toBeGreaterThanOrEqual(22)
    // and they are the order the buttons promise
    expect(GOUGES.v.r < GOUGES.u.r && GOUGES.u.r < GOUGES.scoop.r).toBe(true)
  })

  it('a cut only ever lowers the block, and cutting the same line again changes nothing', () => {
    for (const g of ['v', 'u', 'scoop'] as Gouge[])
      for (let d = 0; d < 16; d += 0.25) {
        const p: V2 = [10 + d, 10]
        const once = carveHeight(1, p, [10, 0], [10, 20], g)
        expect(once).toBeLessThanOrEqual(1)
        expect(carveHeight(once, p, [10, 0], [10, 20], g)).toBe(once)
        // something already cut deeper stays as deep
        expect(carveHeight(0.1, p, [10, 0], [10, 20], g)).toBeLessThanOrEqual(0.1)
      }
  })

  it('a V has sloped walls and a scoop a flat bottom', () => {
    const at = (g: Gouge, d: number) => carveHeight(1, [d, 0], [0, -5], [0, 5], g)
    expect(at('v', 1.1)).toBeCloseTo(0.5, 5)
    expect(at('scoop', 5)).toBe(0)
    expect(at('scoop', 9)).toBe(0)
  })

  it('a stroke carves the same in one piece as segment by segment, in any order', () => {
    const pts: V2[] = [
      [20, 20],
      [40, 25],
      [45, 50],
      [30, 60],
    ]
    for (let y = 10; y < 70; y += 1.5)
      for (let x = 10; x < 60; x += 1.5) {
        const p: V2 = [x, y]
        const whole = carveStroke(1, p, pts, 'u')
        let fwd = 1
        for (let k = 0; k < pts.length - 1; k++) fwd = carveHeight(fwd, p, pts[k], pts[k + 1], 'u')
        let back = 1
        for (let k = pts.length - 2; k >= 0; k--)
          back = carveHeight(back, p, pts[k], pts[k + 1], 'u')
        expect(whole).toBe(fwd)
        expect(whole).toBe(back)
      }
    // a single point is a dab, not nothing
    expect(carveStroke(1, [5, 5], [[5, 5]], 'u')).toBe(0)
  })

  it('every texel a cut changes lies inside the box the GPU is dispatched over', () => {
    for (const g of ['v', 'u', 'scoop'] as Gouge[]) {
      const pts: V2[] = [
        [3.2, 7.9],
        [60.4, 40.1],
        [10, 100.7],
      ]
      const box = cutBox(pts, g)!
      let changed = 0
      for (let y = 0; y < 130; y++)
        for (let x = 0; x < 90; x++)
          if (carveStroke(1, [x + 0.5, y + 0.5], pts, g) < 1) {
            changed++
            expect(x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]).toBe(true)
          }
      expect(changed).toBeGreaterThan(50)
    }
    // a cut entirely off the block touches nothing
    expect(cutBox([[-20, -20]], 'v')).toBeNull()
    // and the box never runs past the block's edge
    expect(cutBox([[BW, BH]], 'scoop')).toEqual([BW - 13, BH - 13, BW - 1, BH - 1])
  })
})

describe('printing', () => {
  it('an uncut block prints solid at full pressure, and a cut prints nothing whatever the pressure', () => {
    for (let k = 0; k < 500; k++) {
      expect(inkOn(1, k, k * 3, 1, 11)).toBe(1)
      for (const p of [0.3, 0.6, 1]) expect(inkOn(0.2, k, k * 3, p, 11)).toBe(0)
    }
  })

  it('a texel takes ink by how far it stands proud, from the surface line up', () => {
    expect(inkOn(SURFACE, 0, 0, 1, 1)).toBe(0)
    expect(inkOn(SURFACE + 0.075, 0, 0, 1, 1)).toBeCloseTo(0.5, 5)
    expect(inkOn(SURFACE + 0.15, 0, 0, 1, 1)).toBe(1)
  })

  it('light pressure leaves the grain showing: some of an uncut block misses, more the lighter', () => {
    const solid = (p: number) => {
      let n = 0
      for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) n += inkOn(1, x, y, p, 3)
      return n / 10_000
    }
    expect(solid(1)).toBe(1)
    expect(solid(0.6)).toBeLessThan(1)
    expect(solid(0.6)).toBeGreaterThan(0.6)
    expect(solid(0.3)).toBeLessThan(solid(0.6))
    expect(solid(0.3)).toBeGreaterThan(0.1)
  })

  it('the grain is repeatable, in 0..1, and different for a different pull', () => {
    let sum = 0
    let same = 0
    for (let k = 0; k < 4000; k++) {
      const g = grain(k % 97, k >> 3, 5)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThan(1)
      expect(grain(k % 97, k >> 3, 5)).toBe(g)
      if (grain(k % 97, k >> 3, 6) === g) same++
      sum += g
    }
    expect(sum / 4000).toBeGreaterThan(0.45)
    expect(sum / 4000).toBeLessThan(0.55)
    expect(same).toBeLessThan(5)
  })

  it('the print is the block turned over: a cut at the block’s left is a gap at the print’s right', () => {
    const block = (x: number, y: number) =>
      carveHeight(1, [x + 0.5, y + 0.5], [20, 10], [20, 50], 'u')
    const print = (x: number, y: number) => inkOn(block(mirrorX(x), y), x, y, 1, 9)
    expect(print(BW - 1 - 20, 30)).toBe(0)
    expect(print(20, 30)).toBe(1)
    expect(mirrorX(0)).toBe(BW - 1)
    expect(mirrorX(BW - 1)).toBe(0)
  })

  it('inks lie over each other: a second colour over the first is darker than either alone', () => {
    const lemon = layer(PAPER, INKS[0].rgb, 1)
    const both = layer(lemon, INKS[5].rgb, 1)
    const blue = layer(PAPER, INKS[5].rgb, 1)
    for (let k = 0; k < 3; k++) {
      expect(lemon[k]).toBeLessThanOrEqual(PAPER[k])
      expect(both[k]).toBeLessThanOrEqual(blue[k])
    }
    // what took no ink is the paper still
    expect(layer(PAPER, INKS[7].rgb, 0)).toEqual(PAPER)
    // the inks run light to dark, as a reduction print is planned
    const lum = (c: [number, number, number]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11
    expect(lum(INKS[0].rgb)).toBeGreaterThan(lum(INKS[INKS.length - 1].rgb))
  })
})

describe('the work', () => {
  it('a cut carved piece by piece as it is dragged is the cut its saved points replay', () => {
    const drag = Array.from(
      { length: 400 },
      (_, k): V2 => [30 + k * 0.13 + Math.sin(k / 9) * 6, 30 + k * 0.05 + Math.cos(k / 13) * 9],
    )
    const pts: V2[] = [drag[0]]
    const live = new Float64Array(90 * 70).fill(1)
    const carve = (piece: V2[]) => {
      for (let y = 0; y < 70; y++)
        for (let x = 0; x < 90; x++)
          live[y * 90 + x] = carveStroke(live[y * 90 + x], [x + 0.5, y + 0.5], piece, 'u')
    }
    carve([drag[0]])
    for (const q of drag.slice(1)) {
      const piece = follow(pts, q)
      if (piece) carve(piece)
    }
    expect(pts.length).toBeGreaterThan(10)
    expect(pts.length).toBeLessThan(drag.length / 2)
    for (let k = 1; k < pts.length; k++)
      expect(
        Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]),
      ).toBeGreaterThanOrEqual(GAP)
    for (let y = 0; y < 70; y++)
      for (let x = 0; x < 90; x++)
        expect(live[y * 90 + x]).toBe(carveStroke(1, [x + 0.5, y + 0.5], pts, 'u'))
  })

  it('only the cuts since the last print can be undone', () => {
    const cut: Step = { cut: { g: 'v', pts: [[1, 1]] } }
    const pull: Step = { pull: { ink: 0, pressure: 1, seed: 1 } }
    expect(undoable([])).toBe(0)
    expect(undoable([cut, cut])).toBe(2)
    expect(undoable([cut, pull])).toBe(0)
    expect(undoable([cut, pull, cut, cut, cut])).toBe(3)
  })

  it('a file round-trips with every field something other than its default', () => {
    const steps: Step[] = [
      {
        cut: {
          g: 'scoop',
          pts: [
            [12.3, 45.6],
            [78.9, 101.2],
          ],
        },
      },
      { pull: { ink: 5, pressure: 0.55, seed: 123456 } },
      { cut: { g: 'v', pts: [[400.1, 300.2]] } },
    ]
    expect(readWork(JSON.stringify({ steps }))).toEqual(steps)
  })

  it('refuses anything that is not a print, saying why', () => {
    const ok = { cut: { g: 'u', pts: [[1, 2]] } }
    const bad = (steps: unknown) => readWork(JSON.stringify({ steps }))
    expect(readWork('not json')).toMatch(/not JSON/)
    expect(readWork(42)).toMatch(/too big/)
    expect(readWork('x'.repeat(FILE_LIMIT + 1))).toMatch(/too big/)
    expect(bad('lots')).toMatch(/up to/)
    expect(bad(Array(MAX_STEPS + 1).fill(ok))).toMatch(/up to/)
    expect(bad([{ cut: { g: 'chisel', pts: [[1, 2]] } }])).toMatch(/gouge/)
    expect(bad([{ cut: { g: 'u', pts: [] } }])).toMatch(/points/)
    expect(bad([{ cut: { g: 'u', pts: Array(MAX_POINTS + 1).fill([1, 2]) } }])).toMatch(/points/)
    expect(bad([{ cut: { g: 'u', pts: [[1, 2, 3]] } }])).toMatch(/points/)
    expect(bad([{ cut: { g: 'u', pts: [[1e9, 2]] } }])).toMatch(/points/)
    expect(bad([{ cut: { g: 'u', pts: [['1', 2]] } }])).toMatch(/points/)
    expect(bad([{ pull: { ink: 99, pressure: 1, seed: 1 } }])).toMatch(/ink/)
    expect(bad([{ pull: { ink: 1.5, pressure: 1, seed: 1 } }])).toMatch(/ink/)
    expect(bad([{ pull: { ink: 1, pressure: 0, seed: 1 } }])).toMatch(/pressure/)
    expect(bad([{ pull: { ink: 1, pressure: 1, seed: 0.5 } }])).toMatch(/pressure/)
    expect(bad([{ pull: { ink: 1, pressure: 1 } }])).toMatch(/pressure/)
    expect(bad([null])).toMatch(/neither/)
    expect(bad([{ script: 'alert(1)' }])).toMatch(/neither/)
    // and nothing outside the known fields comes through
    const r = readWork(JSON.stringify({ steps: [{ ...ok, cut: { ...ok.cut, extra: 1 } }] }))
    expect(r).toEqual([{ cut: { g: 'u', pts: [[1, 2]] } }])
  })

  it('the largest block anybody can make fits in a file the shop will open', () => {
    const corner: V2 = [479.9, 359.9]
    const steps: Step[] = Array.from({ length: MAX_STEPS }, () => ({
      cut: { g: 'scoop' as Gouge, pts: Array.from({ length: MAX_POINTS }, () => corner) },
    }))
    const text = JSON.stringify({ steps })
    expect(text.length).toBeLessThanOrEqual(FILE_LIMIT)
    expect(Array.isArray(readWork(text))).toBe(true)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Shop')
    const { bytes, ...rest } = SHOP
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packShop({
        w: 800,
        h: 500,
        box: [1, 2, 30, 40],
        points: 17,
        gouge: 'scoop',
        pressure: 0.55,
        seed: 99,
        ink: [0.1, 0.2, 0.3],
        last: [0.4, 0.5, 0.6, 1],
      }),
    )
    expect([0, 4, 8, 12].map((o) => v.getUint32(o, true))).toEqual([800, 500, BW, BH])
    expect([0, 1, 2, 3].map((k) => v.getFloat32(SHOP.seg + k * 4, true))).toEqual([1, 2, 30, 40])
    expect(v.getUint32(SHOP.gouge, true)).toBe(2)
    expect(v.getFloat32(SHOP.pressure, true)).toBeCloseTo(0.55, 6)
    expect(v.getUint32(SHOP.seed, true)).toBe(99)
    expect(v.getUint32(SHOP.points, true)).toBe(17)
    expect(v.getFloat32(SHOP.ink + 8, true)).toBeCloseTo(0.3, 6)
    expect(v.getFloat32(SHOP.ink + 12, true)).toBe(1)
    expect(v.getFloat32(SHOP.last + 12, true)).toBe(1)
  })

  it('the shader’s gouge sizes are the module’s', () => {
    expect(code).toContain(`const V_R = ${GOUGES.v.r};`)
    expect(code).toContain(`const U_R = ${GOUGES.u.r.toFixed(1)};`)
    expect(code).toContain(`const SCOOP_R = ${GOUGES.scoop.r.toFixed(1)};`)
    expect(code).toContain(`const SURFACE = ${SURFACE};`)
  })

  it('lays the block and the print side by side on a wide stage and stacked on a tall one, both on it', () => {
    for (const size of [
      [1000, 560],
      [375, 413],
      [820, 560],
    ] as V2[]) {
      const l = layout(size)
      const end = (p: V2): V2 => [p[0] + BW * l.s, p[1] + BH * l.s]
      for (const p of [l.block, l.print]) {
        expect(p[0]).toBeGreaterThanOrEqual(0)
        expect(p[1]).toBeGreaterThanOrEqual(0)
        expect(end(p)[0]).toBeLessThanOrEqual(size[0])
        expect(end(p)[1]).toBeLessThanOrEqual(size[1])
      }
      if (l.tall) expect(l.print[1]).toBeGreaterThanOrEqual(end(l.block)[1])
      else expect(l.print[0]).toBeGreaterThanOrEqual(end(l.block)[0])
    }
    expect(layout([375, 413]).tall).toBe(true)
    expect(layout([1000, 560]).tall).toBe(false)
  })

  it('a point on the stage finds its texel of the block, and the print is not the block', () => {
    const size: V2 = [1000, 560]
    const l = layout(size)
    const at = blockAt(size, [l.block[0] + 100 * l.s, l.block[1] + 50 * l.s])!
    expect(at[0]).toBeCloseTo(100, 6)
    expect(at[1]).toBeCloseTo(50, 6)
    expect(blockAt(size, [l.print[0] + 100 * l.s, l.print[1] + 50 * l.s])).toBeNull()
  })
})
