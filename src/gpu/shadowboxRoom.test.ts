import { describe, expect, it } from 'vitest'
import { CELLS, N, emptyBuild, shadowsOf, type Build } from './shadowbox'
import {
  boxRules,
  clueOf,
  fullest,
  owesBox,
  randomBox,
  readBoxSettings,
  rebuildFor,
  replayPublic,
  standIn,
  totals,
  whoseMove,
  type Box,
  type Clue,
} from './shadowboxRoom'

const R = boxRules(3)
const WALLS = { front: true, side: true, top: false }
const ALL3 = { front: true, side: true, top: true }

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const sum = (b: number[]) => b.reduce((a, x) => a + x, 0)
/**
 * The fewest blocks that throw two walls' shadows, counted here and not by the toy: a stack of
 * height v serves one column and one row that both need v, so each height takes as many stacks as
 * the more of its columns and its rows.
 */
const parOfWalls = (front: number[], side: number[]) => {
  let n = 0
  for (let v = 1; v <= 4; v++)
    n += v * Math.max(front.filter((h) => h === v).length, side.filter((h) => h === v).length)
  return n
}
/** the walls a build throws, counted here: the tallest in each column, and in each row */
const walls = (b: number[]) => ({
  front: [...Array(N).keys()].map((x) =>
    Math.max(...[...Array(N).keys()].map((z) => b[z * N + x])),
  ),
  side: [...Array(N).keys()].map((z) => Math.max(...b.slice(z * N, z * N + N))),
})
const box = (cells: [number, number, number][], show = WALLS): Box => {
  const build = emptyBuild()
  for (const [x, z, h] of cells) build[z * N + x] = h
  return { build, show }
}
/** a whole match, both sides building as the levels say */
function playOut(seed: number, levels: [string, string], rounds = 3, show = WALLS) {
  const rnd = seeded(seed)
  const hide = (): Box => ({ ...randomBox(rnd), show })
  const C = boxRules(rounds)
  let g = C.hidden!.accept(C.fresh(), hide(), 'versus')!
  for (let k = 0; k < 4 * rounds && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const c = g.clues[s === 0 ? 1 : 0][g.rebuilds[s].length]
    const m = { rebuild: rebuildFor(c, levels[s], rnd), ...(owesBox(g, s) ? { box: hide() } : {}) }
    expect(C.legal(g, m, s)).toBe(true)
    g = C.apply(g, m)
  }
  expect(whoseMove(g)).toBeNull()
  return g
}

describe('shadow box by turns: hide and rebuild, scored over par', () => {
  it('reads its rounds and nothing else', () => {
    expect(readBoxSettings({})).toEqual({ rounds: 3 })
    expect(readBoxSettings({ rounds: 5 })).toEqual({ rounds: 5 })
    for (const bad of [{ rounds: 2 }, { rounds: '3' }, { rounds: 0 }])
      expect(readBoxSettings(bad)).toBeNull()
  })

  it('takes a box with the yes and with every move that owes one, and a rebuild that throws the shadows', () => {
    const bo = box([
      [1, 1, 3],
      [3, 2, 2],
    ])
    const ann = box([[0, 0, 1]], ALL3)
    // a box of nothing, or with every lamp off, is no box
    expect(R.hidden!.accept(R.fresh(), { build: emptyBuild(), show: WALLS }, 'versus')).toBeNull()
    expect(
      R.hidden!.accept(
        R.fresh(),
        { build: bo.build, show: { front: false, side: false, top: false } },
        'versus',
      ),
    ).toBeNull()
    let g = R.hidden!.accept(R.fresh(), bo, 'versus')!
    const c = g.clues[1][0]
    // a rebuild must throw Bo's shadows; Ann's first move must bring her box; only Ann moves
    const wrong = box([[1, 1, 3]]).build
    expect(R.legal(g, { rebuild: wrong, box: ann }, 0)).toBe(false)
    expect(R.legal(g, { rebuild: bo.build }, 0)).toBe(false)
    expect(R.legal(g, { rebuild: bo.build, box: ann }, 1)).toBe(false)
    expect(R.legal(g, { rebuild: bo.build, box: ann }, 0)).toBe(true)
    // a different build with the same shadows is as good: they are what is asked
    const other = box([
      [1, 1, 3],
      [3, 2, 2],
      [1, 2, 2],
      [3, 1, 1],
    ]).build
    expect(shadowsOf(other).front).toEqual(c.shadows.front)
    expect(R.legal(g, { rebuild: other, box: ann }, 0)).toBe(true)
    g = R.apply(g, { rebuild: other, box: ann })
    expect(whoseMove(g)).toBe(1)
    // Ann's box shows the floor too: Bo's rebuild must stand on exactly its cell
    expect(R.legal(g, { rebuild: box([[1, 0, 1]]).build, box: bo }, 1)).toBe(false)
    expect(R.legal(g, { rebuild: ann.build, box: bo }, 1)).toBe(true)
  })

  it('alternates to the end of the rounds, the last move bringing no box, and scores each over par', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const rounds = [1, 3, 5][seed % 3]
      const levels: [string, string] = [
        ['easy', 'fair', 'hard'][seed % 3],
        ['hard', 'easy', 'fair'][(seed >> 1) % 3],
      ]
      const g = playOut(seed, levels, rounds)
      expect(g.rebuilds[0]).toHaveLength(rounds)
      expect(g.rebuilds[1]).toHaveLength(rounds)
      expect(g.clues[0]).toHaveLength(rounds)
      expect(g.clues[1]).toHaveLength(rounds)
      // over par, counted here from the walls the hidden boxes throw
      const over = [0, 1].map((s) =>
        g.rebuilds[s].reduce((a, rb, i) => {
          const hid = g.boxes[1 - s][i]!.build
          const w = walls(hid)
          expect(walls(rb)).toEqual(w)
          return a + sum(rb) - parOfWalls(w.front, w.side)
        }, 0),
      )
      expect(totals(g)).toEqual(over)
      const want = over[0] < over[1] ? 0 : over[1] < over[0] ? 1 : 'draw'
      expect(R.result!(g)).toBe(want)
      seen.add(String(want))
    }
    expect(seen).toEqual(new Set(['0', '1', 'draw']))
  })

  it('travels without its boxes until the end, then with all of them, every field as it was', () => {
    const g = playOut(7, ['fair', 'easy'], 3, ALL3)
    // half way: two moves made
    const C = boxRules(3)
    let mid = C.hidden!.accept(C.fresh(), g.boxes[1][0], 'versus')!
    mid = C.apply(mid, { rebuild: g.rebuilds[0][0], box: g.boxes[0][0]! })
    mid = C.apply(mid, { rebuild: g.rebuilds[1][0], box: g.boxes[1][1]! })
    const wire = JSON.parse(JSON.stringify(C.encode(mid)))
    expect(JSON.stringify(wire)).not.toContain('"boxes"')
    expect(JSON.stringify(wire)).not.toContain('"build"')
    const back = C.decode(wire)!
    expect(back.boxes).toEqual([[null], [null, null]])
    for (const k of ['rounds', 'clues', 'rebuilds'] as const) expect(back[k]).toEqual(mid[k])
    expect(C.hidden!.join(back, C.hidden!.secret(mid))).toEqual(mid)
    // and finished, with the boxes
    const end = C.decode(JSON.parse(JSON.stringify(C.encode(g))))!
    for (const k of ['rounds', 'clues', 'rebuilds', 'boxes'] as const) expect(end[k]).toEqual(g[k])
  })

  it('refuses boxes that do not throw their shadows, boxes shown early, and rebuilds that do not', () => {
    const g = playOut(3, ['hard', 'hard'], 3)
    const w = R.encode(g) as { clues: unknown[][]; rebuilds: string[][]; boxes: Box[][] }
    // a box swapped for another: its shadows are not the clue's
    const swapped = { ...w, boxes: [w.boxes[0], [w.boxes[1][1], w.boxes[1][0], w.boxes[1][2]]] }
    expect(R.decode(swapped)).toBeNull()
    expect(
      R.hidden!.join(R.decode({ clues: w.clues, rebuilds: w.rebuilds })!, { boxes: swapped.boxes }),
    ).toBeNull()
    // boxes before the end
    expect(
      R.decode({
        clues: w.clues,
        rebuilds: [w.rebuilds[0], w.rebuilds[1].slice(0, 2)],
        boxes: w.boxes,
      }),
    ).toBeNull()
    // a rebuild one block short of its clue
    const short = w.rebuilds[0][0].replace(/[1-4]/, (d) => String(Number(d) - 1))
    expect(
      R.decode({ clues: w.clues, rebuilds: [[short, ...w.rebuilds[0].slice(1)], w.rebuilds[1]] }),
    ).toBeNull()
    // a clue showing a shadow its lamps do not, or one no build could throw
    const c0 = w.clues[0][0] as Record<string, unknown>
    expect(
      R.decode({
        ...w,
        boxes: undefined,
        clues: [[{ ...c0, top: '1'.repeat(25) }, ...w.clues[0].slice(1)], w.clues[1]],
      }),
    ).toBeNull()
    expect(
      R.decode({
        ...w,
        boxes: undefined,
        clues: [[{ ...c0, side: [0, 0, 0, 0, 0] }, ...w.clues[0].slice(1)], w.clues[1]],
      }),
    ).toBeNull()
    // more than the rounds hold
    expect(replayPublic(1, { clues: w.clues, rebuilds: w.rebuilds })).toBeNull()
  })

  it('keeps the rebuild and not the box in the history', () => {
    const b = box([[1, 1, 2]])
    expect(R.hidden!.logged({ rebuild: b.build, box: b })).toEqual({ rebuild: b.build })
  })

  it('gives the GPU a build that throws the very shadows of the hidden one', () => {
    const rnd = seeded(5)
    for (let k = 0; k < 200; k++) {
      const b = randomBox(rnd)
      const c: Clue = clueOf(b)
      const s = shadowsOf(standIn(c))
      expect(s.front).toEqual(c.shadows.front)
      expect(s.side).toEqual(c.shadows.side)
      if (c.show.top) expect(s.top).toEqual(c.shadows.top)
    }
  })

  it('offers three computers that go over par in order, the hardest not at all on the walls', () => {
    const rnd = seeded(11)
    const over = { easy: 0, fair: 0, hard: 0 } as Record<string, number>
    for (let k = 0; k < 300; k++) {
      const b = randomBox(rnd)
      const c = clueOf({ ...b, show: WALLS })
      const par = parOfWalls(c.shadows.front, c.shadows.side)
      for (const lv of ['easy', 'fair', 'hard']) {
        const rb: Build = rebuildFor(c, lv, rnd)
        expect(walls(rb)).toEqual(walls(b.build))
        over[lv] += sum(rb) - par
      }
    }
    expect(over.hard).toBe(0)
    expect(over.fair).toBeGreaterThan(over.hard)
    expect(over.easy).toBeGreaterThan(over.fair * 2)
    // and the fullest is the most a rebuild can hold
    expect(sum(fullest(clueOf(box([[0, 0, 4]]))))).toBe(4)
    expect(CELLS).toBe(25)
  })
})
