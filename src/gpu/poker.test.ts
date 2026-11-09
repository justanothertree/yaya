import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  STYLES,
  act,
  card,
  choices,
  deal,
  decide,
  describe as name,
  equity,
  finish,
  kindOf,
  newTable,
  pot,
  rank,
  readSaved,
  seeded,
  type Action,
  type Table,
} from './poker'

const hand = (s: string) => s.split(' ').map(card)
const value = (s: string) => rank(hand(s))

describe('ranking hands', () => {
  it('counts every five-card hand in the deck by kind, as published', () => {
    const counts = new Array(9).fill(0)
    const h = [0, 0, 0, 0, 0]
    for (h[0] = 0; h[0] < 52; h[0]++)
      for (h[1] = h[0] + 1; h[1] < 52; h[1]++)
        for (h[2] = h[1] + 1; h[2] < 52; h[2]++)
          for (h[3] = h[2] + 1; h[3] < 52; h[3]++)
            for (h[4] = h[3] + 1; h[4] < 52; h[4]++) counts[kindOf(rank(h))]++
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40])
  }, 60_000)
  it('orders hands of the same kind by their cards, kickers included', () => {
    expect(value('As Ad Kc 7h 2s')).toBeGreaterThan(value('As Ad Qc Jh 9s'))
    expect(value('Ks Kd 2c 2h 9s')).toBeGreaterThan(value('Qs Qd Jc Jh As'))
    expect(value('5s 4d 3c 2h Ac')).toBeLessThan(value('6s 5d 4c 3h 2c'))
    expect(value('Ts 9s 8s 7s 6s')).toBeGreaterThan(value('As Ks Qs Js 9s'))
    expect(value('2s 2d 2c 3h 3s')).toBeGreaterThan(value('As Ks Qs Js 9s'))
    expect(value('As Kd Qc Jh Ts')).toBe(value('Ad Kc Qh Js Td'))
  })
  it('picks the best five of seven', () => {
    expect(name(value('As Ks Qs Js Ts 2d 2c'))).toBe('a royal flush')
    expect(name(value('2s 2d 2c 9h 9s 9d Ac'))).toBe('a full house, nines full of twos')
    expect(name(value('5s 4d 3c 2h Ac Kd Qh'))).toBe('a straight, five high')
    expect(name(value('Ah Kh 2h 7h 9h 3h 4c'))).toBe('a flush, ace high')
    // two pair keeps the best kicker from the third pair
    expect(value('As Ad Ks Kd Qc Qh 2s')).toBe(value('As Ad Ks Kd Qc 3h 2s'))
  })
})

describe('equity', () => {
  it('matches well-known all-in odds before the flop', () => {
    // published figures: aces against one random hand win 85.2%, seven-two offsuit 34.6%, and
    // aces against three random hands 64%. 20,000 deals wander about ±1% at 3σ
    const rand = seeded(5)
    const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(0.012)
    near(equity(hand('As Ah'), [], 1, 20000, rand), 0.852)
    near(equity(hand('7c 2d'), [], 1, 20000, rand), 0.346)
    near(equity(hand('As Ah'), [], 3, 20000, rand), 0.64)
  })
  it('a made hand on the river is certain or not', () => {
    const rand = seeded(2)
    expect(equity(hand('As Ks'), hand('Qs Js Ts 2d 3c'), 3, 500, rand)).toBe(1)
  })
})

/** a table with given stacks, nobody dealt in yet */
function table(stacks: number[], big = 20): Table {
  const t = newTable(
    stacks.map((_, i) => `P${i}`),
    0,
    big,
  )
  stacks.forEach((c, i) => (t.seats[i].chips = c))
  return t
}
const chipsOn = (t: Table) => t.seats.reduce((a, s) => a + s.chips, 0) + pot(t)

describe('betting and pots', () => {
  it('posts the blinds and gives the first move to the player after the big blind', () => {
    const t = table([1000, 1000, 1000, 1000])
    deal(t, seeded(1))
    // dealer 0, small 1, big 2, first to act 3
    expect(t.dealer).toBe(0)
    expect(t.seats[1].put).toBe(10)
    expect(t.seats[2].put).toBe(20)
    expect(t.toAct).toBe(3)
    expect(choices(t)).toMatchObject({ owe: 20, canCheck: false, minTo: 40 })
  })
  it('a raise must be at least the last raise, and re-opens the betting', () => {
    const t = table([1000, 1000, 1000])
    deal(t, seeded(1))
    act(t, { kind: 'raise', to: 60 })
    expect(t.current).toBe(60)
    expect(choices(t).minTo).toBe(100)
    // asking for less is taken as the minimum
    act(t, { kind: 'raise', to: 70 })
    expect(t.current).toBe(100)
  })
  it('everyone folding to a bet hands the pot over, uncontested', () => {
    const t = table([1000, 1000, 1000])
    deal(t, seeded(1))
    act(t, { kind: 'fold' })
    act(t, { kind: 'fold' })
    expect(t.street).toBe('done')
    expect(t.result!.uncontested).toBe(true)
    expect(t.seats[2].chips).toBe(1010)
  })
  it('splits the pot into side pots by what each player could cover', () => {
    // three all in for 100, 300 and 600: the short stack can win 300, the middle 300 + 400 more
    const t = table([100, 300, 600])
    deal(t, seeded(3))
    // rig the cards: P0 best, P1 second, P2 worst
    t.seats[0].hole = hand('As Ad')
    t.seats[1].hole = hand('Ks Kd')
    t.seats[2].hole = hand('7c 2h')
    t.deck = hand('3c 4d 9h Js Qc 8d 6h 5s').reverse()
    t.board = []
    while (t.toAct >= 0) act(t, { kind: 'raise', to: 10_000 })
    // board 3c 4d 9h Js Qc; P0 wins the main pot (3 × 100), P1 the side pot (2 × 200), P2 keeps 300
    expect(t.result!.won).toEqual([300, 400, 300])
    expect(t.seats.map((s) => s.chips)).toEqual([300, 400, 300])
  })
  it('splits a tied pot evenly', () => {
    const t = table([500, 500])
    deal(t, seeded(4))
    t.seats[0].hole = hand('2c 3d')
    t.seats[1].hole = hand('2h 3s')
    t.deck = hand('As Ks Qd Jh Tc 4c 5d').reverse()
    while (t.toAct >= 0) act(t, { kind: 'call' })
    expect(t.result!.won).toEqual([20, 20])
  })
  it('never makes or loses a chip, over thousands of hands of random play', () => {
    const rand = seeded(7)
    for (let game = 0; game < 40; game++) {
      const t = table([500, 1500, 800, 1200], 20)
      const total = chipsOn(t)
      for (let h = 0; h < 60; h++) {
        if (t.seats.filter((s) => s.chips > 0).length < 2) break
        deal(t, rand)
        let guard = 0
        while (t.toAct >= 0 && guard++ < 200) {
          const c = choices(t)
          const r = rand()
          const a: Action =
            r < 0.15
              ? { kind: 'fold' }
              : r < 0.6
                ? { kind: c.canCheck ? 'check' : 'call' }
                : { kind: 'raise', to: c.minTo + Math.floor(rand() * (c.maxTo - c.minTo + 1)) }
          act(t, a)
        }
        expect(t.street).toBe('done')
        expect(chipsOn(t), `game ${game} hand ${h}`).toBe(total)
        expect(t.seats.every((s) => s.chips >= 0)).toBe(true)
      }
    }
  })
  it('a finished hand can be finished again without paying twice', () => {
    const t = table([1000, 1000])
    deal(t, seeded(9))
    while (t.toAct >= 0) act(t, { kind: 'call' })
    const after = t.seats.map((s) => s.chips)
    finish(t)
    expect(t.seats.map((s) => s.chips)).toEqual(after)
  })
})

describe('the computer players', () => {
  it('fold rubbish to a big bet and raise with aces', () => {
    const rand = seeded(12)
    const t = table([2000, 2000, 2000])
    deal(t, rand)
    t.seats[t.toAct].hole = hand('7c 2d')
    act(t, { kind: 'raise', to: 600 }) // the first player raises big
    t.seats[t.toAct].hole = hand('7h 2s')
    expect(decide(t, STYLES.steady, rand).kind).toBe('fold')
    const u = table([2000, 2000, 2000])
    deal(u, rand)
    u.seats[u.toAct].hole = hand('As Ah')
    expect(decide(u, STYLES.steady, rand).kind).toBe('raise')
  })
  it('beat a player who calls everything, over many hands', () => {
    const rand = seeded(21)
    let ahead = 0
    const games = 12
    for (let g = 0; g < games; g++) {
      const t = table([1000, 1000])
      for (let h = 0; h < 80 && t.seats.every((s) => s.chips > 0); h++) {
        deal(t, rand)
        while (t.toAct >= 0)
          act(t, t.toAct === 0 ? decide(t, STYLES.steady, rand, 120) : { kind: 'call' })
      }
      if (t.seats[0].chips > t.seats[1].chips) ahead++
    }
    expect(ahead / games).toBeGreaterThan(0.6)
  }, 60_000)
})

describe('poker saves', () => {
  it('round-trips every field set away from its default, and drops each alone', () => {
    const s = { tables: 9, won: 3, hands: 412, biggestPot: 5600 }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      const rest: Record<string, unknown> = { ...s }
      delete rest[k]
      const back = readSaved(JSON.stringify(rest))
      // tables won cannot exceed tables played, so losing `tables` takes `won` to zero too
      expect(back).toEqual({ ...s, [k]: EMPTY[k], ...(k === 'tables' ? { won: 0 } : {}) })
    }
  })
})
