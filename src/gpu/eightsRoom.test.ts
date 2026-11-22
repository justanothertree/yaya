import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  eightsRules,
  readEightsSettings,
  totals,
  whoseMove,
  type EightsGame,
  type EightsMove,
} from './eightsRoom'

const R = eightsRules(100)
afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** what a card left in hand costs, written here: an eight fifty, a picture ten, an ace one */
const price = (c: number) => {
  const r = c >> 2
  return r === 6 ? 50 : r === 12 ? 1 : r >= 9 ? 10 : r + 2
}
function playOut(seed: number, levels: [string, string], target = 100) {
  const C = eightsRules(target)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = C.hidden!.accept(C.fresh(), null, 'versus')!
  const moments: EightsGame[] = []
  for (let k = 0; k < 20000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m = C.computer!.choose(g, levels[s]) as EightsMove
    expect(C.legal(g, m, s), JSON.stringify(m)).toBe(true)
    g = C.roll(C.apply(g, m), rnd)
    if (k % 5 === 2) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments }
}

describe('crazy eights by turns: the hands, the stock and the card just drawn kept back', () => {
  it('reads its target and nothing else', () => {
    expect(readEightsSettings({})).toEqual({ target: 100 })
    expect(readEightsSettings({ target: 50 })).toEqual({ target: 50 })
    for (const bad of [{ target: 75 }, { target: '100' }, { target: 0 }])
      expect(readEightsSettings(bad)).toBeNull()
  })

  it('deals with the yes: seven each, one up that is not an eight, none of it in what travels', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(g.sizes).toEqual([7, 7])
    expect(g.pile).toHaveLength(1)
    expect(g.pile[0] >> 2).not.toBe(6)
    expect(g.stockLeft).toBe(37)
    expect(JSON.stringify(R.encode(g))).not.toMatch(/hands|stock"|"drew"/)
    expect(whoseMove(g)).toBe(0)
  })

  it('plays only what fits, names a suit with an eight and only then, and draws only with nothing to play', () => {
    for (let seed = 1; seed < 60; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(seed))
      const g = R.hidden!.accept(R.fresh(), null, 'versus')!
      vi.restoreAllMocks()
      const hand = g.hands[0]!
      const top = g.pile[0]
      for (const c of hand) {
        const eight = c >> 2 === 6
        const goes = eight || (c & 3) === g.suit || c >> 2 === top >> 2
        expect(R.legal(g, eight ? { play: c, suit: 2 } : { play: c }, 0)).toBe(goes)
        if (eight) expect(R.legal(g, { play: c }, 0)).toBe(false)
        else expect(R.legal(g, { play: c, suit: 1 }, 0)).toBe(false)
      }
      const canPlay = hand.some((c) => c >> 2 === 6 || (c & 3) === g.suit || c >> 2 === top >> 2)
      expect(R.legal(g, { draw: true }, 0)).toBe(!canPlay)
      expect(R.legal(g, { pass: true }, 0)).toBe(false)
      if (!canPlay) {
        // a draw: the card drawn is the stock's top, and only the drawer is shown it
        const drawnCard = g.stock![0]
        const after = R.apply(g, { draw: true })
        expect(after.hands[0]).toContain(drawnCard)
        if (after.drawn) {
          expect(R.hidden!.mine(after, 0, 0)).toMatchObject({ drew: drawnCard })
          expect(R.hidden!.mine(after, 1, 1)).toMatchObject({ drew: null })
          expect(JSON.stringify(R.encode(after))).toContain('"drawn":true')
          expect(R.legal(after, { pass: true }, 0)).toBe(true)
          expect(R.legal(after, { draw: true }, 0)).toBe(false)
        } else expect(whoseMove(after)).toBe(1)
        return
      }
    }
    throw new Error('no deal left the first player without a card to play')
  })

  it('plays whole matches, every hand’s points what the loser held as counted here', () => {
    const winners = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { g } = playOut(
        seed,
        [['easy', 'fair', 'hard'][seed % 3], ['hard', 'easy', 'fair'][seed % 3]],
        seed % 2 ? 50 : 100,
      )
      const t = [0, 0]
      for (const r of g.done) {
        if (r.winner === null) continue
        expect(r.points).toBe(r.left.reduce((a, c) => a + price(c), 0))
        t[r.winner] += r.points
      }
      expect(totals(g)).toEqual(t)
      expect(Math.max(...t)).toBeGreaterThanOrEqual(g.target)
      const w = t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : 'draw'
      expect(R.result!(g)).toBe(w)
      winners.add(String(w))
    }
    expect(winners.has('0') && winners.has('1')).toBe(true)
  })

  it('travels and comes back as it was, mid-hand and mid-draw, every field', () => {
    let busy: EightsGame[] = []
    for (let seed = 3; seed < 40 && !busy.some((m) => m.drawn); seed++) {
      const { moments } = playOut(seed, ['hard', 'fair'])
      busy = busy.concat(
        moments.filter((m) => m.done.length > 0 && !m.between && m.short.flat().some(Boolean)),
      )
    }
    expect(busy.some((m) => m.drawn)).toBe(true)
    for (const m of busy.slice(-8)) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      for (const k of [
        'target',
        'done',
        'first',
        'between',
        'pile',
        'suit',
        'turn',
        'drawn',
        'short',
        'sizes',
        'stockLeft',
        'moves',
        'hands',
        'stock',
        'drew',
      ] as const)
        expect(j[k]).toEqual(m[k])
    }
  })

  it('refuses points the cards do not give, a deck that is not one, and a drawn card that is not there', () => {
    let m: EightsGame | undefined
    for (let seed = 7; seed < 40 && !m; seed++)
      m = playOut(seed, ['fair', 'fair']).moments.find(
        (x) => x.done.some((r) => r.winner !== null) && !x.between && x.drawn,
      )
    const w = R.encode(m!) as Record<string, unknown> & {
      done: Record<string, unknown>[]
      pile: number[]
    }
    const at = w.done.findIndex((r) => r.winner !== null)
    expect(
      R.decode({
        ...w,
        done: w.done.map((r, i) => (i === at ? { ...r, points: (r.points as number) + 1 } : r)),
      }),
    ).toBeNull()
    expect(R.decode({ ...w, stockLeft: (w.stockLeft as number) + 1 })).toBeNull()
    // the suit to follow is the top card's, unless an eight named another
    const top = w.pile[w.pile.length - 1]
    if (top >> 2 !== 6) expect(R.decode({ ...w, suit: ((top & 3) + 1) % 4 })).toBeNull()
    expect(R.decode({ ...w, between: true })).toBeNull()
    const back = R.decode(w)!
    const sec = R.hidden!.secret(m!) as { hands: number[][]; stock: number[]; drew: number | null }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    expect(R.hidden!.join(back, { ...sec, drew: null })).toBeNull()
    const theirs = sec.hands[1 - (w.turn as number)][0]
    expect(R.hidden!.join(back, { ...sec, drew: theirs })).toBeNull()
    expect(
      R.hidden!.join(back, { ...sec, stock: [...sec.stock.slice(1), sec.hands[0][0]] }),
    ).toBeNull()
    expect(R.readMove({ play: 3, suit: 4 })).toBeNull()
    expect(R.readMove({ draw: true, pass: true })).toBeNull()
  })

  it('the computer reads only its own hand and the table: shuffle the rest, same choice', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 8; seed++) {
        const { moments } = playOut(seed + 40, ['fair', 'fair'])
        for (const m of moments.filter((x) => !x.between && x.turn === 1).slice(0, 3)) {
          const unseen = [...m.hands[0]!, ...m.stock!]
          const rnd = seeded(seed)
          const mixed = unseen
            .map((c) => [rnd(), c] as const)
            .sort((a, b) => a[0] - b[0])
            .map((x) => x[1])
          const other: EightsGame = {
            ...m,
            hands: [mixed.slice(0, m.hands[0]!.length), m.hands[1]],
            stock: mixed.slice(m.hands[0]!.length),
          }
          const ask = (x: EightsGame) => {
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
