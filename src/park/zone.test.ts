import { describe, expect, it } from 'vitest'
import { blankZone, brushZone, packZone, readZone, ZONE, zoneIsEmpty, zoneWalls } from './zone'
import { ASPECT } from './strike'
import { PARK } from './walk'

/**
 * Where you may not walk, and the three ways it could quietly go wrong.
 *
 * ⚠️ IT DECIDES WHERE A CREATURE MAY STAND, and it is read out of localStorage, which anything
 * on this origin can write. So the interesting cases are not the ones somebody paints: they are
 * a string of the wrong length, a grid too fragmented to express as rectangles, and a merge that
 * quietly loses a cell somebody painted.
 */

const CELLS = ZONE.w * ZONE.h

/** paint by predicate, which is how a shape gets into a grid without a pointer */
const shape = (fn: (x: number, y: number) => boolean) => {
  const g = blankZone()
  for (let y = 0; y < ZONE.h; y++)
    for (let x = 0; x < ZONE.w; x++) if (fn(x, y)) g[y * ZONE.w + x] = 1
  return g
}

const areaOf = (walls: { x0: number; y0: number; x1: number; y1: number }[]) =>
  walls.reduce((a, w) => a + (w.x1 - w.x0) * (w.y1 - w.y0), 0)

describe('the grid is the world, in square cells', () => {
  /**
   * ⚠️ 192 BY 120 IS NOT ARBITRARY: the world is `across × ASPECT` wide against `down` tall,
   * so a grid shaped the same way has SQUARE cells — which is the whole reason brushZone can
   * use one radius in both directions and get a circle. Change either number alone and the
   * brush becomes an ellipse with nothing saying so.
   */
  it('so a cell is as wide as it is tall', () => {
    const worldAspect = (PARK.across * ASPECT) / PARK.down
    expect(ZONE.w / ZONE.h).toBeCloseTo(worldAspect, 10)
  })

  it('and a fresh one is empty', () => {
    expect(zoneIsEmpty(blankZone())).toBe(true)
    expect(zoneWalls(blankZone())).toHaveLength(0)
  })
})

describe('a painted patch', () => {
  it('is round, because the cells are square', () => {
    const g = blankZone()
    brushZone(g, 0.5, 0.5, 0.05, true)
    let x0 = 1e9,
      x1 = -1,
      y0 = 1e9,
      y1 = -1
    for (let i = 0; i < CELLS; i++) {
      if (!g[i]) continue
      const x = i % ZONE.w
      const y = Math.floor(i / ZONE.w)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    /* in CELLS the footprint has to be as tall as it is wide, whatever it is in world units */
    expect(x1 - x0).toBeCloseTo(y1 - y0, 0)
  })

  it('and the eraser takes back exactly what the brush put down', () => {
    const g = blankZone()
    brushZone(g, 0.4, 0.6, 0.04, true)
    expect(zoneIsEmpty(g)).toBe(false)
    brushZone(g, 0.4, 0.6, 0.04, false)
    expect(zoneIsEmpty(g)).toBe(true)
  })

  it('and painting off the edge does not wrap round to the other side', () => {
    const g = blankZone()
    brushZone(g, 0.0, 0.5, 0.05, true)
    const rightEdge = Array.from({ length: ZONE.h }, (_, y) => g[y * ZONE.w + (ZONE.w - 1)])
    expect(rightEdge.some((c) => c)).toBe(false)
  })
})

describe('packing it for disk', () => {
  it('round-trips every cell', () => {
    const g = shape((x, y) => ((x * 7 + y * 13) % 11 === 0 && x < 150) || (x > 20 && x < 30))
    const back = readZone(packZone(g))
    expect(back).not.toBeNull()
    expect(Array.from(back!)).toEqual(Array.from(g))
  })

  /**
   * ⚠️ A FIXED SIZE WHATEVER IS ON IT, which is the reason it is a bitset rather than run
   * lengths. Runs are smaller for the maps people paint and UNBOUNDED for the ones they do
   * not — a fine speckle encodes larger than the raw bits. A number that cannot surprise you
   * is worth more here than one that is usually smaller.
   */
  it('at the same size whatever is painted on it', () => {
    const sparse = shape((x, y) => x === 5 && y === 5)
    const dense = shape(() => true)
    const speckle = shape((x, y) => ((x + y) & 1) === 0)
    const n = packZone(sparse).length
    expect(packZone(dense).length).toBe(n)
    expect(packZone(speckle).length).toBe(n)
    expect(n).toBeLessThan(6000)
  })

  it('and refuses anything that is not one', () => {
    expect(readZone('')).toBeNull()
    expect(readZone('not base64 at all !!')).toBeNull()
    expect(readZone(123)).toBeNull()
    expect(readZone(null)).toBeNull()
    expect(readZone({})).toBeNull()
    /* right alphabet, wrong length — the case a truncated write would produce */
    expect(readZone(btoa('short'))).toBeNull()
  })

  it('and an empty grid reads back as no zone rather than an empty one', () => {
    expect(readZone(packZone(blankZone()))).toBeNull()
  })
})

describe('turning it into things you bump into', () => {
  it('a filled rectangle is one box, exactly its own size', () => {
    const g = shape((x, y) => x >= 40 && x < 120 && y >= 20 && y < 80)
    const walls = zoneWalls(g)
    expect(walls).toHaveLength(1)
    expect(areaOf(walls)).toBeCloseTo((80 / ZONE.w) * (60 / ZONE.h), 10)
  })

  /**
   * ⚠️ THE MERGE MUST NOT LOSE A CELL. Every painted cell has to end up inside some box, or a
   * zone somebody drew has a hole in it that nothing on screen explains. Checked by asking each
   * box which cells it covers and comparing the count, rather than by comparing areas — an
   * area can come out right with the wrong cells in it.
   */
  it('and every painted cell ends up inside some box', () => {
    const g = shape((x, y) => {
      const dx = x - 96
      const dy = y - 60
      return dx * dx + dy * dy < 40 * 40 || (x > 150 && y > 90)
    })
    const walls = zoneWalls(g)
    let covered = 0
    let painted = 0
    for (let y = 0; y < ZONE.h; y++)
      for (let x = 0; x < ZONE.w; x++) {
        if (!g[y * ZONE.w + x]) continue
        painted++
        const cx = (x + 0.5) / ZONE.w
        const cy = (y + 0.5) / ZONE.h
        if (walls.some((w) => cx > w.x0 && cx < w.x1 && cy > w.y0 && cy < w.y1)) covered++
      }
    expect(painted).toBeGreaterThan(1000)
    expect(covered).toBe(painted)
  })

  it('and no box covers ground nobody painted', () => {
    const g = shape((x, y) => x >= 10 && x < 40 && y >= 10 && y < 40)
    for (const w of zoneWalls(g)) {
      const x = Math.round(((w.x0 + w.x1) / 2) * ZONE.w)
      const y = Math.round(((w.y0 + w.y1) / 2) * ZONE.h)
      expect(g[y * ZONE.w + x], `box at cell ${x},${y}`).toBe(1)
    }
  })

  it('a round blob is tens of boxes, not the hundred a row-at-a-time merge would give', () => {
    const g = shape((x, y) => {
      const dx = x - 96
      const dy = y - 60
      return dx * dx + dy * dy < 40 * 40
    })
    const walls = zoneWalls(g)
    expect(walls.length).toBeGreaterThan(1)
    expect(walls.length).toBeLessThan(80)
    /* and it is the circle's own area, to within the cells its rim cuts in half */
    expect(areaOf(walls)).toBeCloseTo((Math.PI * 40 * 40) / CELLS, 2)
  })

  /**
   * ⚠️ AND A HOSTILE ONE COARSENS RATHER THAN EXPLODING. A hand-written chequerboard is
   * eleven thousand boxes, each tested against every creature several times a frame. Over the
   * cap the grid is halved and retried taking ANY of four cells, so it loses precision in the
   * safe direction: a zone that grew stops you, one that shrank lets you through something
   * somebody painted shut.
   */
  it('and a chequerboard nobody could have painted comes back small, and bigger not smaller', () => {
    const speckle = shape((x, y) => ((x + y) & 1) === 0)
    const walls = zoneWalls(speckle)
    expect(walls.length).toBeLessThan(800)
    /* it grew: the coarsened answer covers at least the half the speckle occupied */
    expect(areaOf(walls)).toBeGreaterThanOrEqual(0.5)
  })

  it('and a single cell is a single box', () => {
    const g = blankZone()
    g[60 * ZONE.w + 96] = 1
    const walls = zoneWalls(g)
    expect(walls).toHaveLength(1)
    expect(walls[0].x1 - walls[0].x0).toBeCloseTo(1 / ZONE.w, 10)
  })
})
