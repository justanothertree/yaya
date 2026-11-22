import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  liarsRules,
  readLiarsSettings,
  replayPublic,
  whoseMove,
  type LiarsGame,
  type LiarsMove,
} from './liarsRoom'

const R = liarsRules(true)
afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** dice bearing a face out, counted here: the face, and ones too when wild unless the bid is on ones */
const bearing = (dice: number[][], f: number, wild: boolean) =>
  dice.flat().filter((d) => d === f || (wild && f !== 1 && d === 1)).length

function playOut(seed: number, levels: [string, string], wild = true) {
  const C = liarsRules(wild)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let x = C.hidden!.accept(C.fresh(), null, 'versus')!
  const moments: LiarsGame[] = []
  for (let k = 0; k < 3000 && whoseMove(x) !== null; k++) {
    const s = whoseMove(x)!
    const m = C.computer!.choose(x, levels[s]) as LiarsMove
    if (!C.legal(x, m, s)) {
      // the toy's own computer may run out of raises: then it calls, as the toy does
      x = C.apply(x, { call: true })
    } else x = C.apply(x, m)
    if (k % 3 === 1) moments.push(x)
  }
  vi.restoreAllMocks()
  expect(whoseMove(x)).toBeNull()
  return { x, moments, C }
}

describe('liar’s dice by turns: the cups, and the seed they are rolled from, kept back', () => {
  it('reads its wild ones and nothing else', () => {
    expect(readLiarsSettings({})).toEqual({ wild: true })
    expect(readLiarsSettings({ wild: false })).toEqual({ wild: false })
    for (const bad of [{ wild: 'yes' }, { wild: 1 }]) expect(readLiarsSettings(bad)).toBeNull()
  })

  it('rolls five each with the yes, and nothing of either cup or the seed travels', () => {
    const x = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(x.g.dice[0]).toHaveLength(5)
    expect(x.g.dice[1]).toHaveLength(5)
    const wire = JSON.stringify(R.encode(x))
    expect(wire).not.toMatch(/dice|seed/)
    expect(R.hidden!.mine(x, 0, 0)).toEqual(x.g.dice[0])
    expect(R.hidden!.mine(x, 1, 1)).toEqual(x.g.dice[1])
    expect(whoseMove(x)).toBe(0)
  })

  it('takes only raises in turn, and a call only of a bid on the table', () => {
    let x = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(R.legal(x, { call: true }, 0)).toBe(false)
    expect(R.legal(x, { bid: { q: 2, f: 3 } }, 1)).toBe(false)
    x = R.apply(x, { bid: { q: 2, f: 3 } })
    expect(whoseMove(x)).toBe(1)
    // not a raise: fewer, or as many of a lower face; on ones, half as many (rounded up) will do
    expect(R.legal(x, { bid: { q: 1, f: 6 } }, 1)).toBe(false)
    expect(R.legal(x, { bid: { q: 2, f: 2 } }, 1)).toBe(false)
    expect(R.legal(x, { bid: { q: 2, f: 4 } }, 1)).toBe(true)
    expect(R.legal(x, { bid: { q: 1, f: 1 } }, 1)).toBe(true)
    expect(R.legal(x, { bid: { q: 11, f: 6 } }, 1)).toBe(false)
    expect(R.legal(x, { call: true }, 1)).toBe(true)
  })

  it('plays whole matches, every showdown what the cups held as counted here', () => {
    const winners = new Set<string>()
    let showdowns = 0
    for (let seed = 1; seed <= 16; seed++) {
      const wild = seed % 4 !== 0
      const { x, C } = playOut(
        seed,
        [['easy', 'fair', 'hard'][seed % 3], ['fair', 'hard', 'easy'][seed % 3]],
        wild,
      )
      const left = [5, 5]
      for (const s of x.past) {
        expect(s.dice[0]).toHaveLength(left[0])
        expect(s.dice[1]).toHaveLength(left[1])
        const n = bearing(s.dice, s.bid.f, wild)
        expect(s.actual).toBe(n)
        expect(s.loser).toBe(n >= s.bid.q ? s.caller : s.bidder)
        left[s.loser]--
        showdowns++
      }
      expect(x.g.left).toEqual(left)
      const w = left[0] === 0 ? 1 : 0
      expect(Math.min(...left)).toBe(0)
      expect(C.result!(x)).toBe(w)
      winners.add(String(w))
    }
    expect(showdowns).toBeGreaterThan(100)
    expect(winners).toEqual(new Set(['0', '1']))
  })

  it('travels and comes back as it was, mid-round, every field', () => {
    const { moments, C } = playOut(3, ['fair', 'fair'])
    const busy = moments.filter(
      (m) => m.past.length > 0 && m.g.bids.length > 0 && m.g.winner === null,
    )
    expect(busy.length).toBeGreaterThan(0)
    for (const m of busy.slice(0, 8)) {
      const back = C.decode(JSON.parse(JSON.stringify(C.encode(m))))!
      expect(back).not.toBeNull()
      const j = C.hidden!.join(back, JSON.parse(JSON.stringify(C.hidden!.secret(m))))!
      expect(j.past).toEqual(m.past)
      for (const k of [
        'dice',
        'left',
        'wild',
        'turn',
        'bid',
        'bidder',
        'bids',
        'shown',
        'winner',
        'seed',
      ] as const)
        expect(j.g[k]).toEqual(m.g[k])
    }
  })

  it('refuses a showdown its cups do not bear out, a cup the wrong size, and a bid that is not a raise', () => {
    const { moments, C } = playOut(5, ['fair', 'fair'])
    const m = moments.find((x) => x.past.length > 1 && x.g.bids.length > 1 && x.g.winner === null)!
    const w = C.encode(m) as {
      past: Record<string, unknown>[]
      turn: number
      bids: { who: number; bid: { q: number; f: number } }[]
    }
    const off = (i: number, patch: Record<string, unknown>) => ({
      ...w,
      past: w.past.map((p, k) => (k === i ? { ...p, ...patch } : p)),
    })
    expect(C.decode(off(0, { actual: (w.past[0].actual as number) + 1 }))).toBeNull()
    expect(C.decode(off(0, { loser: 1 - (w.past[0].loser as number) }))).toBeNull()
    // the last showdown's loser swapped: no later cup is there to give it away, only the count
    const lastAt = w.past.length - 1
    expect(C.decode(off(lastAt, { loser: 1 - (w.past[lastAt].loser as number) }))).toBeNull()
    const d0 = w.past[0].dice as number[][]
    expect(C.decode(off(0, { dice: [d0[0].slice(1), d0[1]] }))).toBeNull()
    expect(C.decode({ ...w, bids: [w.bids[1], w.bids[0], ...w.bids.slice(2)] })).toBeNull()
    expect(
      C.decode({ ...w, bids: w.bids.map((b, i) => (i === 0 ? { ...b, who: 1 - b.who } : b)) }),
    ).toBeNull()
    const back = C.decode(w)!
    const sec = C.hidden!.secret(m) as { dice: number[][]; seed: number }
    expect(C.hidden!.join(back, sec)).not.toBeNull()
    expect(C.hidden!.join(back, { ...sec, dice: [sec.dice[0].slice(1), sec.dice[1]] })).toBeNull()
    expect(
      C.hidden!.join(back, { ...sec, dice: [sec.dice[0].map(() => 7), sec.dice[1]] }),
    ).toBeNull()
    expect(replayPublic(true, { ...w, past: Array(11).fill(w.past[0]) })).toBeNull()
    // a finished match whose deciding showdown is put down to the winner instead: with dice to
    // spare, the winner would still have some, and the turn it leaves is the one stored — only the
    // count says who really lost that die
    let flipped = 0
    for (let seed = 1; seed <= 30; seed++) {
      const { x } = playOut(seed, ['fair', 'fair'])
      const fw = C.encode(x) as { past: Record<string, unknown>[] }
      const last = fw.past.length - 1
      if (x.g.left[x.g.winner!] < 2) continue
      const swapped = {
        ...fw,
        past: fw.past.map((p, k) => (k === last ? { ...p, loser: 1 - (p.loser as number) } : p)),
      }
      expect(C.decode(swapped), `seed ${seed}`).toBeNull()
      flipped++
    }
    expect(flipped).toBeGreaterThan(3)
    expect(C.readMove({ bid: { q: 2, f: 7 } })).toBeNull()
    expect(C.readMove({ call: true, bid: { q: 2, f: 3 } })).toBeNull()
  })

  it('the computer reads only its own cup and the bids: roll the other cup again, same move', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 8; seed++) {
        const { moments } = playOut(seed + 40, ['fair', 'fair'])
        for (const m of moments.filter((x) => x.g.winner === null && x.g.turn === 1).slice(0, 3)) {
          const rnd = seeded(seed)
          const other: LiarsGame = {
            ...m,
            g: { ...m.g, dice: [m.g.dice[0].map(() => 1 + Math.floor(rnd() * 6)), m.g.dice[1]] },
          }
          const ask = (x: LiarsGame) => {
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
