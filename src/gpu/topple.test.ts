import { describe, expect, it } from 'vitest'
import code from './topple.wgsl?raw'
import {
  FALL,
  MAX_DOMINOES,
  NEAREST,
  PUZZLES,
  SPACING,
  TABLE,
  TALL,
  THICK,
  WIDE,
  cascade,
  dominoAt,
  floorAt,
  packDominoes,
  packTable,
  pushOf,
  readLayout,
  resample,
  smooth,
  solve,
  solved,
  spiral,
  standAlong,
  tipTime,
  viewScale,
  W,
  D,
  type Domino,
  type Layout,
  type V2,
} from './topple'
import { wgslLayout } from './wgslLayout'

const empty = (): Layout => ({ dominoes: [], bells: [], walls: [] })
const row = (n: number, gap: number, z = 7, a = 0): Domino[] =>
  Array.from({ length: n }, (_, k) => ({ x: 3 + k * gap, z, a, c: 0 }))
const fell = (l: Layout, first = 0, dir = 1) =>
  cascade(l, first, dir).falls.filter((f) => f.t >= 0).length

describe('standing dominoes along a line', () => {
  it('stands one every SPACING along a straight line, facing along it', () => {
    const d = standAlong(
      empty(),
      [
        [2, 5],
        [8, 5],
      ],
      3,
    )
    expect(d.length).toBe(Math.round(6 / SPACING) + 1)
    for (let k = 1; k < d.length; k++) expect(d[k].x - d[k - 1].x).toBeCloseTo(SPACING, 6)
    expect(d.every((e) => Math.abs(e.a) < 1e-6 && e.c === 3)).toBe(true)
  })
  it('ends on the line’s own end, so a line drawn to a bell reaches the bell', () => {
    const pts = resample(
      [
        [0, 0],
        [3.0, 0],
      ],
      0.6,
    )
    expect(pts[pts.length - 1][0]).toBeCloseTo(3, 9)
  })
  it('rounds a corner off, so each domino turns a little rather than one turning all at once', () => {
    const line: V2[] = [
      [3, 5],
      [8, 5],
      [8, 10],
    ]
    const d = standAlong(empty(), line, 0)
    let worst = 0
    for (let k = 1; k < d.length; k++) {
      const turn = Math.abs(
        Math.atan2(Math.sin(d[k].a - d[k - 1].a), Math.cos(d[k].a - d[k - 1].a)),
      )
      worst = Math.max(worst, turn)
    }
    expect(worst).toBeLessThan(0.6)
    expect(smooth(line).length).toBeGreaterThan(line.length)
  })
  it('does not stand one where one stands, in a wall, off the table, or past the limit', () => {
    const l: Layout = { dominoes: row(5, 0.6), bells: [], walls: [[10, 0, 11, 15]] }
    const d = standAlong(
      l,
      [
        [3, 7],
        [14, 7],
      ],
      0,
    )
    expect(
      d.every((e) => l.dominoes.every((o) => Math.hypot(o.x - e.x, o.z - e.z) >= NEAREST)),
    ).toBe(true)
    expect(d.some((e) => e.x > 9.8 && e.x < 11.2)).toBe(false)
    expect(
      standAlong(
        empty(),
        [
          [-5, 7],
          [-1, 7],
        ],
        0,
      ),
    ).toEqual([])
    const full: Layout = {
      dominoes: Array.from({ length: MAX_DOMINOES }, () => ({ x: 1, z: 1, a: 0, c: 0 })),
      bells: [],
      walls: [],
    }
    expect(
      standAlong(
        full,
        [
          [3, 7],
          [14, 7],
        ],
        0,
      ),
    ).toEqual([])
  })
})

describe('the cascade', () => {
  it('a run carries from one push to the end, each domino a little after the last', () => {
    const l: Layout = { ...empty(), dominoes: row(12, 0.6) }
    const c = cascade(l, 0, 1)
    expect(c.falls.every((f) => f.t >= 0 && f.dir === 1)).toBe(true)
    for (let k = 1; k < 12; k++)
      expect(c.falls[k].t - c.falls[k - 1].t).toBeCloseTo(tipTime(0.6), 9)
  })
  it('a gap wider than a domino is tall stops it', () => {
    const l: Layout = {
      ...empty(),
      dominoes: [...row(4, 0.6), ...row(4, 0.6).map((d) => ({ ...d, x: d.x + 2.4 + TALL }))],
    }
    expect(fell(l)).toBe(4)
  })
  it('pushed the other way, it falls the other way and knocks nothing in front', () => {
    const l: Layout = { ...empty(), dominoes: row(6, 0.6) }
    expect(fell(l, 0, -1)).toBe(1)
    expect(fell(l, 5, -1)).toBe(6)
    expect(cascade(l, 5, -1).falls[0].dir).toBe(-1)
  })
  it('a domino turned side-on stops the run, and the one that hit it ends leaning on it', () => {
    const d = row(6, 0.6)
    d[3] = { ...d[3], a: Math.PI / 2 }
    const l: Layout = { ...empty(), dominoes: d }
    const c = cascade(l, 0, 1)
    expect(c.falls.filter((f) => f.t >= 0)).toHaveLength(3)
    expect(c.falls[2].rest).toBeCloseTo(Math.asin(0.6 / TALL), 9)
    expect(c.falls[0].rest).toBeCloseTo(Math.PI / 2, 9)
  })
  it('one falling into two side by side knocks both: a fork', () => {
    const l: Layout = {
      ...empty(),
      dominoes: [
        { x: 3, z: 7, a: 0, c: 0 },
        { x: 3.6, z: 6.8, a: -0.5, c: 0 },
        { x: 3.6, z: 7.2, a: 0.5, c: 0 },
      ],
    }
    expect(fell(l)).toBe(3)
  })
  it('a domino beside the run, out of reach across it, stays up', () => {
    const l: Layout = {
      ...empty(),
      dominoes: [...row(5, 0.6), { x: 4.2, z: 7 + WIDE + 0.1, a: 0, c: 0 }],
    }
    expect(fell(l)).toBe(5)
  })
  it('a falling domino takes FALL to land flat, and less to reach one nearer', () => {
    expect(tipTime(TALL)).toBeCloseTo(FALL, 9)
    expect(tipTime(0.3)).toBeLessThan(tipTime(0.6))
    expect(THICK).toBeLessThan(SPACING)
  })
})

describe('the puzzles', () => {
  it('none is solved by an empty table, and each is solved by its stored way within its budget', () => {
    for (const p of PUZZLES) {
      expect(pushOf(p, { dominoes: [], bells: p.bells, walls: p.walls }), p.name).toBeNull()
      const l = solve(p)
      expect(l.dominoes.length, p.name).toBeLessThanOrEqual(p.budget)
      const push = pushOf(p, l)!
      expect(push, p.name).not.toBeNull()
      const c = cascade(l, push.first, push.dir)
      expect(solved(p, c), p.name).toBe(true)
    }
  })
  it('the duet is not solved by the obvious answer: two straight branches ring 0.38 s apart', () => {
    const p = PUZZLES.find((q) => q.name === 'Duet')!
    const straight = {
      ...p,
      solution: [
        p.solution[0],
        p.solution[1],
        [
          [7.6, 7.7],
          [11.56, 12.75],
        ] as V2[],
      ],
    }
    const l = solve(straight)
    const push = pushOf(p, l)!
    const c = cascade(l, push.first, push.dir)
    expect(c.bells.every((t) => t >= 0)).toBe(true)
    expect(solved(p, c)).toBe(false)
  })
  it('chimes in the wrong order is not solved', () => {
    const p = PUZZLES.find((q) => q.name === 'Chimes')!
    const l = solve(p)
    const push = pushOf(p, l)!
    const c = cascade(l, push.first, push.dir)
    const reversed = { ...c, bells: [...c.bells].reverse() }
    expect(solved(p, reversed)).toBe(false)
  })
  it('the picture spiral comes down whole from one push in the middle', () => {
    const d = spiral()
    expect(d.length).toBeGreaterThan(250)
    expect(d.length).toBeLessThanOrEqual(MAX_DOMINOES)
    expect(fell({ dominoes: d, bells: [], walls: [] })).toBe(d.length)
    expect(d.some((e) => e.c === 0) && d.some((e) => e.c === 7)).toBe(true)
  })
})

describe('a table as a file', () => {
  it('comes back field for field', () => {
    const l: Layout = {
      dominoes: [{ x: 3.25, z: 4.5, a: 0.75, c: 6 }],
      bells: [{ x: 9.5, z: 2.25 }],
      walls: [],
    }
    expect(readLayout(JSON.stringify(l))).toEqual(l)
  })
  it('refuses what is not a table, saying why', () => {
    expect(readLayout('x'.repeat(70_000))).toMatch(/too big/)
    expect(readLayout('{')).toMatch(/not JSON/)
    expect(readLayout(JSON.stringify({ dominoes: [{ x: 1, z: 1, a: 0, c: 9 }] }))).toMatch(/colour/)
    expect(readLayout(JSON.stringify({ dominoes: [{ x: 99, z: 1, a: 0, c: 1 }] }))).toMatch(
      /on the table/,
    )
    expect(readLayout(JSON.stringify({ dominoes: [{ x: '1', z: 1, a: 0, c: 1 }] }))).toMatch(
      /on the table/,
    )
    expect(
      readLayout(
        JSON.stringify({ dominoes: Array(MAX_DOMINOES + 1).fill({ x: 1, z: 1, a: 0, c: 0 }) }),
      ),
    ).toMatch(/600/)
    expect(readLayout(JSON.stringify({ dominoes: [], bells: [{ x: -1, z: 0 }] }))).toMatch(/bells/)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Table')
    const { bytes, ...rest } = TABLE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packTable({ w: 800, h: 500, count: 30, bells: 2, time: 1.5, walls: 1, rung: 3, preview: 12 }),
    )
    expect([0, 4, 8, 12].map((o) => v.getUint32(o, true))).toEqual([800, 500, 30, 2])
    expect(v.getFloat32(TABLE.time, true)).toBe(1.5)
    expect([TABLE.walls, TABLE.rung, TABLE.preview].map((o) => v.getUint32(o, true))).toEqual([
      1, 3, 12,
    ])
  })
  it('carries the shader’s copies of the sizes and the fall', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(code)?.[1])
    expect(['W', 'D', 'TALL', 'WIDE', 'THICK', 'FALL'].map(num)).toEqual([
      W,
      D,
      TALL,
      WIDE,
      THICK,
      FALL,
    ])
  })
  it('packs each domino and how it falls, a domino that never falls as −1', () => {
    const l: Layout = { ...empty(), dominoes: row(3, 0.6) }
    const c = cascade(l, 1, 1)
    const f = packDominoes(l, c)
    expect(Array.from(f.slice(0, 8))).toEqual([3, 7, 0, 0, -1, 0, Math.fround(Math.PI / 2), 0])
    expect(Array.from(f.slice(8, 16))).toEqual([
      Math.fround(3.6),
      7,
      0,
      0,
      0,
      1,
      Math.fround(Math.PI / 2),
      0,
    ])
  })
  it('a point of the stage lands on the floor where the shader draws it, the middle in the middle', () => {
    const size: [number, number] = [800, 500]
    const [x, z] = floorAt(size, [400, 250])
    expect(x).toBeCloseTo(W / 2, 9)
    expect(z).toBeCloseTo(D / 2, 9)
    const s = viewScale(size)
    expect(floorAt(size, [400 + s, 250])[0]).toBeCloseTo(W / 2 + 1, 9)
    expect(dominoAt({ ...empty(), dominoes: row(3, 0.6) }, [3.62, 7.05])).toBe(1)
  })
})
