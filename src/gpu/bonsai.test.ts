import { describe, expect, it } from 'vitest'
import {
  BEND,
  DEFAULT_DRESS,
  EMPTY,
  MAX_BRANCHES,
  MAX_DEPTH,
  MAX_SEASONS,
  cut,
  decode,
  encode,
  grow,
  nearest,
  readSaved,
  replay,
  settleAngle,
  shape,
  sprout,
  wire,
  type Op,
  type Tree,
} from './bonsai'

const seasons = (t: Tree, n: number) => Array.from({ length: n }).reduce<Tree>((x) => grow(x), t)
const subtree = (t: Tree, id: string) =>
  [...t.branches.values()]
    .filter((b) => b.id === id || b.id.startsWith(id + '.'))
    .sort((a, b) => a.id.localeCompare(b.id))

describe('growing', () => {
  it('the same seed grows the same tree, and a different seed a different one', () => {
    expect(shape(seasons(sprout(7), 6))).toEqual(shape(seasons(sprout(7), 6)))
    expect(shape(seasons(sprout(7), 6))).not.toEqual(shape(seasons(sprout(8), 6)))
  })
  it('stays within its bounds however long it grows', () => {
    const t = seasons(sprout(3), 60)
    expect(t.seasons).toBe(MAX_SEASONS)
    for (const id of t.branches.keys())
      expect(id === '' ? 0 : id.split('.').length).toBeLessThanOrEqual(MAX_DEPTH)
    expect(t.branches.size).toBeLessThanOrEqual(MAX_BRANCHES)
  })
  it('wood thickens where it feeds more tips: a branch is never thinner than what grows from it', () => {
    const segs = shape(seasons(sprout(11), 8))
    const width = new Map(segs.map((s) => [s.id, s.width]))
    for (const s of segs) {
      if (s.id === '') continue
      const parent = s.id.includes('.') ? s.id.slice(0, s.id.lastIndexOf('.')) : ''
      expect(width.get(parent)!, s.id).toBeGreaterThanOrEqual(s.width)
    }
  })
  it('each branch starts where its parent ends', () => {
    const segs = shape(seasons(sprout(5), 7))
    const end = new Map(segs.map((s) => [s.id, [s.x1, s.y1]]))
    for (const s of segs) {
      if (s.id === '') continue
      const parent = s.id.includes('.') ? s.id.slice(0, s.id.lastIndexOf('.')) : ''
      expect(s.x0).toBeCloseTo(end.get(parent)![0], 12)
      expect(s.y0).toBeCloseTo(end.get(parent)![1], 12)
    }
  })
})

describe('pruning and wiring', () => {
  const t = seasons(sprout(21), 6)
  const branch = [...t.branches.keys()].find((k) => k.split('.').length === 2)!
  it('a cut takes the branch and everything grown from it, and nothing else', () => {
    const after = cut(t, branch)
    for (const k of t.branches.keys())
      expect(after.branches.has(k), k).toBe(!(k === branch || k.startsWith(branch + '.')))
    expect(cut(t, '').branches.size).toBe(t.branches.size)
  })
  it('cutting one branch does not change how another grows', () => {
    const other = branch.startsWith('0') ? '1' : '0'
    const a = seasons(t, 3)
    const b = seasons(cut(t, branch), 3)
    expect(a.branches.size).toBeLessThan(MAX_BRANCHES - 30)
    expect(subtree(b, other)).toEqual(subtree(a, other))
  })
  it('wiring turns a branch about its base, as far as a branch will bend', () => {
    const turned = wire(t, branch, 0.9)
    const s0 = shape(t).find((s) => s.id === branch)!
    const s1 = shape(turned).find((s) => s.id === branch)!
    expect([s1.x0, s1.y0]).toEqual([s0.x0, s0.y0])
    expect(Math.hypot(s1.x1 - s1.x0, s1.y1 - s1.y0)).toBeCloseTo(
      Math.hypot(s0.x1 - s0.x0, s0.y1 - s0.y0),
      12,
    )
    expect(wire(t, branch, 9).branches.get(branch)!.angle).toBe(BEND)
    expect(wire(t, '', 0.5).branches.get('')!.angle).toBe(0)
  })
  it('finds the branch under a finger', () => {
    const s = shape(t).find((x) => x.id === branch)!
    expect(nearest(shape(t), (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2)).toBe(branch)
    expect(nearest(shape(t), 50, 50)).toBeNull()
  })
})

describe('a tree as a link', () => {
  const ops: Op[] = [
    { kind: 'grow' },
    { kind: 'grow' },
    { kind: 'grow' },
    { kind: 'cut', id: '1.0' },
    { kind: 'wire', id: '0', angle: settleAngle(0.7) },
    { kind: 'grow' },
    { kind: 'wire', id: '0.1.2', angle: settleAngle(-1.1) },
  ]
  const dress = {
    pot: 'cascade',
    glaze: 4,
    season: 'autumn',
    leaf: 'blossom',
    moss: false,
    stones: true,
  } as const
  it('round-trips the seed, every operation and the dress, and rebuilds the same tree', () => {
    const back = decode(encode(4000000001, ops, dress))!
    expect(back.seed).toBe(4000000001)
    expect(back.dress).toEqual(dress)
    expect(back.ops).toHaveLength(ops.length)
    for (let i = 0; i < ops.length; i++) {
      const a = ops[i]
      const b = back.ops[i]
      expect(b.kind).toBe(a.kind)
      if (a.kind !== 'grow' && b.kind !== 'grow') expect(b.id).toBe(a.id)
      if (a.kind === 'wire' && b.kind === 'wire') expect(b.angle).toBeCloseTo(a.angle, 12)
    }
    expect(shape(replay(back.seed, back.ops))).toEqual(shape(replay(4000000001, ops)))
  })
  it('a settled angle stays put through a link', () => {
    for (const a of [-2, -1.2, -0.31, 0, 0.5, 1.19, 3])
      expect(settleAngle(settleAngle(a))).toBeCloseTo(settleAngle(a), 12)
  })
  it('turns away anything malformed', () => {
    const good = encode(1, ops, DEFAULT_DRESS)
    expect(decode(good.slice(0, -2))).toBeNull()
    expect(decode(encode(1, ops, { ...DEFAULT_DRESS, glaze: 9 }))).toBeNull()
    expect(decode('$$$$$$$$')).toBeNull()
    const tooLong = encode(
      1,
      Array.from({ length: 30 }, () => ({ kind: 'grow' }) as Op),
      DEFAULT_DRESS,
    )
    expect(decode(tooLong)).toBeNull()
  })
})

describe('bonsai saves', () => {
  it('round-trips the tree in hand and the kept ones', () => {
    const s = {
      current: encode(9, [{ kind: 'grow' }], DEFAULT_DRESS),
      kept: [
        { name: 'Juniper', code: encode(5, [{ kind: 'grow' }, { kind: 'grow' }], DEFAULT_DRESS) },
      ],
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ current: 'x', kept: [{ name: 'a', code: 'bad' }] }))).toEqual(
      EMPTY,
    )
  })
})
