import { describe, expect, it } from 'vitest'
import code from './shadowbox.wgsl?raw'
import {
  ALL,
  BOX,
  CELLS,
  N,
  PUZZLES,
  TALL,
  at,
  blocks,
  cameraRay,
  emptyBuild,
  fewest,
  inShadow,
  matches,
  nudge,
  packBox,
  pickCell,
  readBuild,
  shadowsOf,
  wallHit,
  type Shadows,
  type Show,
} from './shadowbox'
import { wgslLayout } from './wgslLayout'

const WALLS: Show = { front: true, side: true, top: false }
const build = (cells: [number, number, number][]) => {
  const b = emptyBuild()
  for (const [x, z, h] of cells) b[at(x, z)] = h
  return b
}
/** the fewest blocks, by trying every build the clue allows: only for clues small enough to try */
function brute(clue: Shadows, show: Show) {
  const lo: number[] = Array.from({ length: CELLS }, (_, i) => (show.top && clue.top[i] ? 1 : 0))
  const hi = Array.from({ length: CELLS }, (_, i) => {
    if (show.top && !clue.top[i]) return 0
    return Math.min(
      show.front ? clue.front[i % N] : TALL,
      show.side ? clue.side[Math.floor(i / N)] : TALL,
    )
  })
  const free = hi.map((_, i) => i).filter((i) => hi[i] > lo[i])
  const b = lo.slice()
  let best = Infinity
  const go = (k: number, sum: number) => {
    if (sum >= best) return
    if (k === free.length) {
      if (matches(b, clue, show)) best = sum
      return
    }
    const i = free[k]
    for (let h = lo[i]; h <= hi[i]; h++) {
      b[i] = h
      go(k + 1, sum - lo[i] + h)
    }
    b[i] = lo[i]
  }
  go(0, blocks(lo))
  return best
}
/** the fewest for a walls-only clue, exactly: each height needs as many stacks as the larger of the
 *  columns and the rows that need it */
const wallsOnly = (c: Shadows) =>
  [1, 2, 3, 4].reduce(
    (s, v) =>
      s + v * Math.max(c.front.filter((h) => h === v).length, c.side.filter((h) => h === v).length),
    0,
  )

describe('shadows', () => {
  it('the back wall shows each column’s tallest stack, the left wall each row’s, the floor what is built on', () => {
    const s = shadowsOf(
      build([
        [1, 0, 2],
        [1, 3, 4],
        [3, 3, 1],
      ]),
    )
    expect(s.front).toEqual([0, 4, 0, 1, 0])
    expect(s.side).toEqual([2, 0, 0, 4, 0])
    expect(s.top.filter(Boolean)).toHaveLength(3)
    expect(s.top[at(1, 3)]).toBe(true)
  })
  it('different builds can throw the same shadows, and either one matches', () => {
    const a = build([
      [0, 0, 3],
      [1, 1, 3],
    ])
    const b = build([
      [0, 1, 3],
      [1, 0, 3],
    ])
    expect(a).not.toEqual(b)
    expect(matches(b, shadowsOf(a), WALLS)).toBe(true)
    // but not when the floor is shown too
    expect(matches(b, shadowsOf(a), ALL)).toBe(false)
  })
  it('a shadow that is not shown is not judged', () => {
    const a = build([[2, 2, 3]])
    expect(
      matches(
        build([
          [2, 2, 3],
          [4, 4, 1],
        ]),
        shadowsOf(a),
        { front: false, side: false, top: false },
      ),
    ).toBe(true)
    expect(matches(emptyBuild(), shadowsOf(a), { front: true, side: false, top: false })).toBe(
      false,
    )
  })
  it('a stack is nudged up or down by one, never below the floor nor above the box', () => {
    let b = emptyBuild()
    b = nudge(b, 7, -1)
    expect(b[7]).toBe(0)
    for (let k = 0; k < 9; k++) b = nudge(b, 7, 1)
    expect(b[7]).toBe(TALL)
  })
})

describe('the puzzles', () => {
  it('none is solved by an empty box, and each hidden build matches its own clue', () => {
    for (const p of PUZZLES) {
      expect(p.hidden).toHaveLength(CELLS)
      const clue = shadowsOf(p.hidden)
      expect(matches(emptyBuild(), clue, p.show), p.name).toBe(false)
      expect(matches(p.hidden, clue, p.show), p.name).toBe(true)
    }
  })
  it('par is a build that throws the right shadows, and the fewest blocks that can', () => {
    for (const p of PUZZLES) {
      const clue = shadowsOf(p.hidden)
      const par = fewest(clue, p.show)
      expect(matches(par, clue, p.show), p.name).toBe(true)
      expect(blocks(par), p.name).toBeLessThanOrEqual(blocks(p.hidden))
      const least = p.show.top ? brute(clue, p.show) : wallsOnly(clue)
      expect(blocks(par), p.name).toBe(least)
    }
  })
  it('some ask for fewer blocks than were hidden: the hidden build is never the only answer', () => {
    const stairs = PUZZLES.find((p) => p.name === 'Stairs')!
    expect(blocks(fewest(shadowsOf(stairs.hidden), stairs.show))).toBe(10)
    expect(blocks(stairs.hidden)).toBe(20)
  })
  it('fewest is exact on walls-only clues it was not designed on', () => {
    // every build of two stacks anywhere, at every height pair
    for (let i = 0; i < CELLS; i += 3)
      for (let j = i + 1; j < CELLS; j += 4)
        for (const [hi, hj] of [
          [1, 4],
          [3, 3],
          [2, 4],
        ]) {
          const b = emptyBuild()
          b[i] = hi
          b[j] = hj
          const c = shadowsOf(b)
          expect(blocks(fewest(c, WALLS))).toBe(wallsOnly(c))
          expect(matches(fewest(c, WALLS), c, WALLS)).toBe(true)
        }
  })
})

describe('a box as a file', () => {
  it('comes back field for field', () => {
    const b = build([
      [0, 0, 1],
      [4, 4, 4],
      [2, 3, 2],
    ])
    const show = { front: true, side: false, top: true }
    expect(readBuild(JSON.stringify({ build: b, show }))).toEqual({ build: b, show })
  })
  it('refuses what is not a box, saying why', () => {
    expect(readBuild('x'.repeat(5000))).toMatch(/too big/)
    expect(readBuild('{')).toMatch(/not JSON/)
    expect(readBuild(JSON.stringify({ build: [1, 2] }))).toMatch(/25 stacks/)
    expect(readBuild(JSON.stringify({ build: Array(25).fill(5) }))).toMatch(/25 stacks/)
    expect(readBuild(JSON.stringify({ build: Array(25).fill(1.5) }))).toMatch(/25 stacks/)
    expect(readBuild(JSON.stringify({ build: Array(25).fill(0) }))).toMatch(/empty/)
    expect(
      readBuild(
        JSON.stringify({
          build: Array(25).fill(1),
          show: { front: false, side: false, top: false },
        }),
      ),
    ).toMatch(/at least one/)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Box')
    const { bytes, ...rest } = BOX
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packBox({
        w: 300,
        h: 400,
        show: { front: true, side: false, top: true },
        mine: true,
        hidden: false,
        time: 2,
        yaw: 0.5,
      }),
    )
    expect([v.getUint32(0, true), v.getUint32(4, true), v.getUint32(BOX.show, true)]).toEqual([
      300, 400, 5,
    ])
    expect([
      v.getUint32(BOX.mine, true),
      v.getFloat32(BOX.time, true),
      v.getFloat32(BOX.yaw, true),
      v.getUint32(BOX.hidden, true),
    ]).toEqual([1, 2, 0.5, 0])
  })
  it('the camera’s centre ray goes through the middle of the box, and x runs left to right on the screen', () => {
    const { o, d } = cameraRay([400, 400], 0.75, [200, 200])
    const t = (2.4 - o[0]) / d[0]
    expect(o[1] + d[1] * t).toBeCloseTo(1.3, 6)
    expect(o[2] + d[2] * t).toBeCloseTo(2.6, 6)
    const l = cameraRay([400, 400], 0.75, [60, 200])
    const r = cameraRay([400, 400], 0.75, [340, 200])
    const left = wallHit(l.o, l.d)
    const right = wallHit(r.o, r.d)
    expect(left?.kind).toBe('left')
    expect(right?.kind).toBe('back')
    expect(right!.p[0]).toBeGreaterThan(2.5)
  })
  it('a wall point is in a build’s shadow by its profile', () => {
    const s = shadowsOf(build([[1, 2, 3]]))
    expect(inShadow(s, 'back', [1.5, 2.9, N])).toBe(true)
    expect(inShadow(s, 'back', [1.5, 3.1, N])).toBe(false)
    expect(inShadow(s, 'left', [0, 1, 2.5])).toBe(true)
    expect(inShadow(s, 'left', [0, 1, 3.5])).toBe(false)
    expect(inShadow(s, 'floor', [1.5, 0, 2.5])).toBe(true)
  })
})

describe('building by tapping the box', () => {
  /** where a point of the box is drawn on a 400 × 400 stage: the camera's own axes, worked out
   *  here independently of the ray it casts */
  const screenOf = (p: [number, number, number], yaw = 0.75): [number, number] => {
    const back = [Math.sin(yaw), 0.85, -Math.cos(yaw)]
    const bl = Math.hypot(...back)
    const bk = back.map((v) => v / bl)
    // x to the right on the screen, as drawn: the camera's right is +x turned toward the viewer
    const right = [-bk[2], 0, bk[0]].map((v) => v / Math.hypot(bk[2], bk[0]))
    const up = [
      right[1] * bk[2] - right[2] * bk[1],
      right[2] * bk[0] - right[0] * bk[2],
      right[0] * bk[1] - right[1] * bk[0],
    ]
    const rel = [p[0] - 2.4, p[1] - 1.3, p[2] - 2.6]
    const u = (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) / 8.6
    const v = -(rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) / 8.6
    return [200 + u * 400, 200 + v * 400]
  }
  const tower = build([[2, 2, 3]])
  it('a tap on the top of a stack picks that stack', () => {
    expect(pickCell(tower, [400, 400], 0.75, screenOf([2.5, 3, 2.5]))).toBe(at(2, 2))
  })
  it('a tap on the side of a stack picks that stack, not the floor behind it', () => {
    // the middle of its front face, half way up
    expect(pickCell(tower, [400, 400], 0.75, screenOf([2.5, 1.5, 2.0]))).toBe(at(2, 2))
  })
  it('a tap on bare floor picks the floor cell, and outside the box picks nothing', () => {
    expect(pickCell(emptyBuild(), [400, 400], 0.75, screenOf([1.5, 0, 3.5]))).toBe(at(1, 3))
    expect(pickCell(emptyBuild(), [400, 400], 0.75, screenOf([4.5, 0, 0.5]))).toBe(at(4, 0))
    expect(pickCell(emptyBuild(), [400, 400], 0.75, [5, 395])).toBe(-1)
  })
})
