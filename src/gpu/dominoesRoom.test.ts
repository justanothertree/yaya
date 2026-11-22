import { afterEach, describe, expect, it, vi } from 'vitest'
import { SET, type Tile } from './dominoes'
import {
  MAX_ROUNDS,
  dominoRules,
  readDominoSettings,
  replayPublic,
  totals,
  whoseMove,
  type DominoGame,
  type DominoMove,
} from './dominoesRoom'

const R = dominoRules(100)
afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** a hand's pips, counted here */
const weigh = (h: number[][]) => h.reduce((s, t) => s + t[0] + t[1], 0)
function playOut(seed: number, levels: [string, string], target = 100) {
  const C = dominoRules(target)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = C.hidden!.accept(C.fresh(), null, 'versus')!
  const moments: DominoGame[] = []
  for (let k = 0; k < 5000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m = C.computer!.choose(g, levels[s]) as DominoMove
    expect(C.legal(g, m, s)).toBe(true)
    g = C.roll(C.apply(g, m), rnd)
    if (k % 13 === 4) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments }
}
/** a table set out by hand: a double six down, and the hands and boneyard as given */
function table(h0: Tile[], h1: Tile[]): DominoGame {
  const used = [...h0, ...h1, [6, 6]].map((t) => t.join())
  const yard = SET.filter((t) => !used.includes(t.join()))
  return {
    ...R.fresh(),
    between: false,
    first: 0,
    line: [{ a: 6, b: 6 }],
    turn: 0,
    sizes: [h0.length, h1.length],
    yardLeft: yard.length,
    hands: [h0, h1],
    yard,
  }
}

describe('dominoes by turns: hands and boneyard kept back', () => {
  it('reads its target and nothing else', () => {
    expect(readDominoSettings({})).toEqual({ target: 100 })
    expect(readDominoSettings({ target: 50 })).toEqual({ target: 50 })
    for (const bad of [{ target: 75 }, { target: '100' }, { target: 0 }])
      expect(readDominoSettings(bad)).toBeNull()
  })

  it('deals with the yes: seven each, fourteen in the boneyard, none of it in what travels', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(g.hands[0]).toHaveLength(7)
    expect(g.hands[1]).toHaveLength(7)
    expect(g.yardLeft).toBe(14)
    expect(JSON.stringify(R.encode(g))).not.toMatch(/hands|"yard"/)
    expect(R.hidden!.mine(g, 1)).toEqual(g.hands[1])
    expect(whoseMove(g)).toBe(0)
  })

  it('lays only a tile that meets an end, and draws only with nothing to lay — until something will', () => {
    const g = table(
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
      [
        [0, 0],
        [1, 1],
      ],
    )
    // nothing of Ann's meets a six: no lay, and a draw until a six comes
    expect(R.legal(g, { lay: [0, 1], side: 'right' }, 0)).toBe(false)
    expect(R.legal(g, { draw: true }, 1)).toBe(false)
    const after = R.apply(g, { draw: true })
    const drawn = after.hands[0]!.slice(3)
    expect(drawn.length).toBeGreaterThan(0)
    // every tile drawn before the last will not go; the last one will
    expect(drawn.slice(0, -1).every((t) => !t.includes(6))).toBe(true)
    expect(drawn[drawn.length - 1]).toContain(6)
    expect(whoseMove(after)).toBe(0)
    expect(after.lacks[0]).toEqual([6])
    // and with a six in hand, the draw is refused and the lay goes
    expect(R.legal(after, { draw: true }, 0)).toBe(false)
    expect(R.legal(after, { lay: drawn[drawn.length - 1], side: 'left' }, 0)).toBe(true)
  })

  it('plays whole matches, every round’s points what its final hands show, as counted here', () => {
    const whys = new Set<string>()
    const winners = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { g } = playOut(
        seed,
        [['easy', 'fair', 'hard'][seed % 3], ['hard', 'easy', 'fair'][seed % 3]],
        seed % 2 ? 50 : 100,
      )
      const t = [0, 0]
      for (const r of g.done) {
        whys.add(r.why)
        const [a, b] = [weigh(r.hands[0]), weigh(r.hands[1])]
        if (r.why === 'out') {
          const w = r.hands[0].length === 0 ? 0 : 1
          expect(r.winner).toBe(w)
          expect(r.points).toBe(w === 0 ? b : a)
        } else {
          expect(r.points).toBe(Math.abs(a - b))
          expect(r.winner).toBe(a === b ? null : a < b ? 0 : 1)
        }
        if (r.winner !== null) t[r.winner] += r.points
      }
      expect(totals(g)).toEqual(t)
      expect(Math.max(...t)).toBeGreaterThanOrEqual(g.target)
      const w = t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : 'draw'
      expect(R.result!(g)).toBe(w)
      winners.add(String(w))
    }
    expect(whys.has('out')).toBe(true)
    expect(winners.has('0') && winners.has('1')).toBe(true)
  })

  it('travels and comes back as it was, mid-round, every field', () => {
    let busy: DominoGame[] = []
    for (let seed = 3; seed < 30 && !busy.length; seed++) {
      const { moments } = playOut(seed, ['hard', 'fair'])
      busy = moments.filter(
        (m) =>
          m.done.length > 0 && !m.between && m.lacks.some((l) => l.length) && m.line.length > 2,
      )
    }
    expect(busy.length).toBeGreaterThan(0)
    for (const m of busy) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      for (const k of [
        'target',
        'done',
        'first',
        'between',
        'line',
        'turn',
        'passes',
        'lacks',
        'sizes',
        'yardLeft',
        'hands',
        'yard',
      ] as const)
        expect(j[k]).toEqual(m[k])
    }
  })

  it('refuses points the hands do not give, a set that is not one, and a line that does not join', () => {
    let m: DominoGame | undefined
    for (let seed = 7; seed < 40 && !m; seed++)
      m = playOut(seed, ['fair', 'fair']).moments.find(
        (x) => x.done.length > 0 && !x.between && x.line.length > 1,
      )
    const w = R.encode(m!) as Record<string, unknown> & {
      done: Record<string, unknown>[]
      line: { a: number; b: number }[]
    }
    expect(
      R.decode({
        ...w,
        done: w.done.map((r, i) => (i === 0 ? { ...r, points: (r.points as number) + 1 } : r)),
      }),
    ).toBeNull()
    expect(R.decode({ ...w, yardLeft: (w.yardLeft as number) + 1 })).toBeNull()
    expect(
      R.decode({
        ...w,
        line: [...w.line.slice(0, -1), { a: (w.line.at(-1)!.a + 1) % 7, b: w.line.at(-1)!.b }],
      }),
    ).toBeNull()
    expect(R.decode({ ...w, between: true })).toBeNull()
    // a blocked round goes to the lighter hand, by the difference: one pip against eleven is ten
    const blocked = { why: 'blocked', winner: 0, points: 10, hands: [[[0, 1]], [[5, 6]]], laid: 26 }
    expect(R.decode({ ...w, done: [blocked] })).not.toBeNull()
    expect(R.decode({ ...w, done: [{ ...blocked, points: 11 }] })).toBeNull()
    expect(R.decode({ ...w, done: [{ ...blocked, winner: 1 }] })).toBeNull()
    const back = R.decode(w)!
    const sec = R.hidden!.secret(m!) as { hands: number[][][]; yard: number[][] }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    expect(
      R.hidden!.join(back, { ...sec, yard: [...sec.yard.slice(1), sec.hands[0][0]] }),
    ).toBeNull()
    expect(R.hidden!.join(back, { ...sec, hands: [sec.hands[1], sec.hands[0]] })).toBeNull()
    expect(replayPublic(100, { ...w, done: Array(MAX_ROUNDS + 1).fill(w.done[0]) })).toBeNull()
    expect(R.readMove({ lay: [3, 2], side: 'left' })).toBeNull()
    expect(R.readMove({ lay: [2, 3], side: 'middle' })).toBeNull()
    expect(R.readMove({ draw: 'yes' })).toBeNull()
  })

  it('the computer reads only its own hand and the table: shuffle the rest, same choice', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 8; seed++) {
        const { moments } = playOut(seed + 40, ['fair', 'fair'])
        for (const m of moments.filter((x) => !x.between && x.turn === 1).slice(0, 3)) {
          const unseen = [...m.hands[0]!, ...m.yard!]
          const rnd = seeded(seed)
          const mixed = unseen
            .map((t) => [rnd(), t] as const)
            .sort((a, b) => a[0] - b[0])
            .map((x) => x[1])
          const other: DominoGame = {
            ...m,
            hands: [mixed.slice(0, m.hands[0]!.length), m.hands[1]],
            yard: mixed.slice(m.hands[0]!.length),
          }
          const ask = (x: DominoGame) => {
            vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 3))
            const a = R.computer!.choose(x, level)
            vi.restoreAllMocks()
            return a
          }
          expect(ask(other), `${level} ${seed}`).toEqual(ask(m))
        }
      }
  })
})
