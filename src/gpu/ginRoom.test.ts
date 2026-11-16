import { arrange } from './gin'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ginRules,
  readGinSettings,
  replayPublic,
  totals,
  whoseMove,
  MAX_HANDS,
  type GinGame,
  type GinMove,
} from './ginRoom'

const R = ginRules(50)
afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** a card's count, written here: an ace one, two to ten their face, the court ten */
const worth = (c: number) => {
  const r = c >> 2 // 0 a two … 12 an ace
  return r === 12 ? 1 : Math.min(10, r + 2)
}
const dw = (cs: number[]) => cs.reduce((a, c) => a + worth(c), 0)
const arrangeAt = (cs: number[]) => arrange(cs).points
/** a server's game: dealt with the yes, every half-turn by the computer at these levels */
function playOut(seed: number, levels: [string, string], target = 50) {
  const C = ginRules(target)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = C.hidden!.accept(C.fresh(), null, 'versus')!
  const moments: GinGame[] = []
  for (let k = 0; k < 6000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m = C.computer!.choose(g, levels[s]) as GinMove
    expect(C.legal(g, m, s)).toBe(true)
    g = C.roll(C.apply(g, m), rnd)
    if (k % 37 === 5) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments }
}

describe('gin rummy by turns: hands kept back, first to so many points', () => {
  it('reads its target and nothing else', () => {
    expect(readGinSettings({})).toEqual({ target: 50 })
    expect(readGinSettings({ target: 100 })).toEqual({ target: 100 })
    for (const bad of [{ target: 75 }, { target: '50' }, { target: 0 }])
      expect(readGinSettings(bad)).toBeNull()
  })

  it('deals with the yes: ten each, one up, the rest in the stock, none of it in what travels', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(g.hands[0]).toHaveLength(10)
    expect(g.hands[1]).toHaveLength(10)
    expect(g.pile).toHaveLength(1)
    expect(g.stockLeft).toBe(31)
    expect(new Set([...g.hands[0]!, ...g.hands[1]!, ...g.pile, ...g.stock!]).size).toBe(52)
    const wire = JSON.stringify(R.encode(g))
    expect(wire).not.toContain('hands')
    expect(wire).not.toContain('stock"')
    expect(R.hidden!.mine(g, 0)).toEqual(g.hands[0])
    expect(R.hidden!.mine(g, 1)).toEqual(g.hands[1])
    expect(whoseMove(g)).toBe(0)
  })

  it('takes half a turn at a time: a draw, then a discard that is not the card just taken', () => {
    let g = R.hidden!.accept(R.fresh(), null, 'versus')!
    const up = g.pile[0]
    expect(R.legal(g, { draw: 'pile' }, 1)).toBe(false)
    expect(R.legal(g, { discard: g.hands[0]![0], knock: false }, 0)).toBe(false)
    g = R.apply(g, { draw: 'pile' })
    expect(g.phase).toBe('discard')
    expect(g.hands[0]).toHaveLength(11)
    expect(g.picked[0]).toEqual([up])
    expect(R.legal(g, { discard: up, knock: false }, 0)).toBe(false)
    expect(R.legal(g, { discard: g.hands[1]![0], knock: false }, 0)).toBe(false)
    // a knock only at ten deadwood or less, for every card she might throw
    let refused = 0
    for (const c of g.hands[0]!.filter((x) => x !== up)) {
      const ok = arrangeAt(g.hands[0]!.filter((x) => x !== c)) <= 10
      if (!ok) refused++
      expect(R.legal(g, { discard: c, knock: true }, 0)).toBe(ok)
    }
    expect(refused).toBeGreaterThan(0)
    const throwIt = g.hands[0]!.find((c) => c !== up)!
    g = R.apply(g, { discard: throwIt, knock: false })
    expect(whoseMove(g)).toBe(1)
    expect(g.pile).toEqual([throwIt])
  })

  it('plays whole matches to the target, every hand’s points what its laid-down cards say', () => {
    const hows = new Set<string>()
    const winners = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { g } = playOut(
        seed,
        [['easy', 'fair', 'hard'][seed % 3], ['hard', 'easy', 'fair'][seed % 3]],
        seed % 2 ? 50 : 100,
      )
      const t = [0, 0]
      for (const r of g.done) {
        hows.add(r.how)
        if (r.how === 'void') continue
        const k = r.knocker!
        const mine = dw(r.shown[k].dead)
        const theirs = dw(r.shown[1 - k].dead)
        const pts =
          r.how === 'gin' ? 25 + theirs : r.how === 'undercut' ? 25 + mine - theirs : theirs - mine
        expect(r.points).toBe(pts)
        t[r.winner!] += pts
      }
      expect(totals(g)).toEqual(t)
      expect(Math.max(...t)).toBeGreaterThanOrEqual(g.target)
      const w = t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : 'draw'
      expect(R.result!(g)).toBe(w)
      winners.add(String(w))
    }
    expect(hows.has('knock')).toBe(true)
    expect(hows.has('gin') || hows.has('undercut')).toBe(true)
    expect(winners.has('0') && winners.has('1')).toBe(true)
  })

  it('travels and comes back as it was, mid-hand and finished, every field', () => {
    const { g, moments } = playOut(5, ['hard', 'fair'])
    const busy = moments.filter(
      (m) => m.done.length > 0 && m.picked.some((p) => p.length) && m.phase === 'discard',
    )
    expect(busy.length).toBeGreaterThan(0)
    for (const m of [...busy, g]) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const joined = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      const keys = [
        'target',
        'done',
        'first',
        'between',
        'pile',
        'turn',
        'phase',
        'took',
        'picked',
        'stockLeft',
      ] as const
      for (const k of keys) expect(joined[k]).toEqual(m[k])
      if (!m.between) {
        expect(joined.hands).toEqual(m.hands)
        expect(joined.stock).toEqual(m.stock)
      }
    }
  })

  it('refuses points its cards do not give, a deck that is not one, and a hand the wrong size', () => {
    let found: { g: GinGame; mid: GinGame } | null = null
    for (let seed = 9; seed < 40 && !found; seed++) {
      const { g, moments } = playOut(seed, ['fair', 'fair'])
      const mid = moments.find((m) => m.done.some((r) => r.how !== 'void') && !m.between)
      if (mid) found = { g, mid }
    }
    const { g, mid } = found!
    const w = R.encode(mid) as Record<string, unknown> & { done: Record<string, unknown>[] }
    const at = w.done.findIndex((r) => r.how !== 'void')
    const off = w.done.map((r, i) => (i === at ? { ...r, points: (r.points as number) + 1 } : r))
    expect(R.decode({ ...w, done: off })).toBeNull()
    expect(R.decode({ ...w, stockLeft: (w.stockLeft as number) - 1 })).toBeNull()
    expect(R.decode({ ...w, pile: [...(w.pile as number[]), (w.pile as number[])[0]] })).toBeNull()
    expect(R.decode({ ...w, between: true })).toBeNull()
    const back = R.decode(w)!
    const sec = R.hidden!.secret(mid) as { hands: number[][]; stock: number[] }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    // a card in two places, a hand short a card, the stock longer than the state says
    expect(
      R.hidden!.join(back, { ...sec, stock: [...sec.stock.slice(1), sec.hands[0][0]] }),
    ).toBeNull()
    expect(
      R.hidden!.join(back, { ...sec, hands: [sec.hands[0].slice(1), sec.hands[1]] }),
    ).toBeNull()
    expect(R.hidden!.join(back, { ...sec, stock: [...sec.stock, sec.stock[0]] })).toBeNull()
    expect(replayPublic(50, { ...(R.encode(g) as object), done: [] })).toBeNull()
    expect(g.done.length).toBeLessThanOrEqual(MAX_HANDS)
    expect(R.readMove({ draw: 'deck' })).toBeNull()
    expect(R.readMove({ discard: 52, knock: false })).toBeNull()
    expect(R.readMove({ discard: 3, knock: false, peek: 1 })).toBeNull()
  })

  it('the computer reads only its own hand and the table: shuffle what it cannot see, same choice', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 12; seed++) {
        const { moments } = playOut(seed + 20, ['fair', 'fair'])
        for (const m of moments.filter((x) => !x.between && x.turn === 1).slice(0, 3)) {
          // the other hand and the stock swap cards among themselves: what side 1 cannot see
          const unseen = [...m.hands[0]!, ...m.stock!]
          const rnd = seeded(seed)
          const shuffled = unseen
            .map((c) => [rnd(), c])
            .sort((a, b) => a[0] - b[0])
            .map((x) => x[1])
          const other: GinGame = {
            ...m,
            hands: [shuffled.slice(0, m.hands[0]!.length), m.hands[1]],
            stock: shuffled.slice(m.hands[0]!.length),
          }
          const ask = (x: GinGame) => {
            vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 3))
            const a = R.computer!.choose(x, level)
            vi.restoreAllMocks()
            return a
          }
          expect(ask(other), `${level} ${seed}`).toEqual(ask(m))
        }
      }
  })

  it('offers three computers that beat each other in order', () => {
    const share = (a: string, b: string, n: number) => {
      let won = 0
      let decided = 0
      for (let k = 0; k < n; k++) {
        const C = ginRules(50)
        vi.spyOn(Math, 'random').mockImplementation(seeded(500 + k))
        let g = C.hidden!.accept(C.fresh(), null, 'versus')!
        const lv = k % 2 ? [b, a] : [a, b]
        // one hand each time
        for (let s = 0; s < 400 && g.done.length === 0; s++)
          g = C.apply(g, C.computer!.choose(g, lv[whoseMove(g)!]) as GinMove)
        vi.restoreAllMocks()
        const r = g.done[0]
        if (r.winner === null) continue
        decided++
        if (r.winner === (k % 2 ? 1 : 0)) won++
      }
      return won / decided
    }
    // measured 65.6% and 64.3% over 3,000 hands each; asserted well inside those
    expect(share('fair', 'easy', 500)).toBeGreaterThan(0.58)
    expect(share('hard', 'fair', 500)).toBeGreaterThan(0.57)
  }, 60000)
})
