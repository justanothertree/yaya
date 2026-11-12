import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { card } from './poker'
import {
  EMPTY,
  choose,
  cost,
  deal,
  drawCard,
  fits,
  isEight,
  legal,
  pass,
  payout,
  playCard,
  playHand,
  readSaved,
  top,
  type Hand,
  type Level,
  type Saved,
} from './eights'

const cs = (s: string) => s.split(' ').map(card)
/** a hand in a given state: hands, the pile's top, the suit asked for, the stock */
const table = (hands: string[], pile: string, stock = '2c 3c 4c', suit?: number): Hand => {
  const p = cs(pile)
  return {
    hands: hands.map(cs),
    stock: stock ? cs(stock) : [],
    pile: p,
    suit: suit ?? p[p.length - 1] % 4,
    turn: 0,
    drew: null,
    short: hands.map(() => [false, false, false, false]),
    winner: null,
  }
}

describe('a hand', () => {
  it('deals seven each to two players and five to more, and never turns up an eight', () => {
    for (let s = 1; s <= 40; s++) {
      const two = deal(2, rng(s))
      expect(two.hands.map((h) => h.length)).toEqual([7, 7])
      expect(isEight(top(two))).toBe(false)
      expect(two.stock.length + 14 + 1).toBe(52)
      const four = deal(4, rng(s))
      expect(four.hands.map((h) => h.length)).toEqual([5, 5, 5, 5])
      expect(new Set([...four.hands.flat(), ...four.stock, ...four.pile]).size).toBe(52)
    }
  })
  it('takes a card of the suit asked for, or of the same rank, or any eight', () => {
    const h = table(['Kh 5s 8d 2c', 'As'], '5h')
    expect(legal(h).sort()).toEqual(cs('Kh 5s 8d').sort())
    // after an eight that named clubs, only clubs or another eight
    const named = table(['Kh 5s 8d 2c', 'As'], '5h 8s', '2d', 3)
    expect(legal(named).sort()).toEqual(cs('8d 2c').sort())
    expect(fits(named, card('Ks'))).toBe(false)
  })
  it('names a suit with an eight, which the next player must follow', () => {
    const h = table(['Kh 8d', 'As 2s'], '5h')
    const after = playCard(h, card('8d'), 0)
    expect(after.suit).toBe(0)
    expect(after.turn).toBe(1)
    expect(legal(after).sort()).toEqual(cs('As 2s').sort())
  })
  it('draws one when nothing will go, and may play it only if it fits, else the turn passes', () => {
    const fitsNow = table(['2d 3s', 'As'], '9h', 'Th Jc')
    const d = drawCard(fitsNow, rng(1))
    expect(d.drew).toBe(card('Th'))
    expect(d.turn).toBe(0)
    expect(legal(d)).toEqual(cs('Th'))
    // having drawn, only the card drawn may go, even beside another that would fit
    expect(legal({ ...d, hands: [[...d.hands[0], card('9c')], d.hands[1]] })).toEqual(cs('Th'))
    expect(pass(d).turn).toBe(1)
    const not = table(['2d 3s', 'As'], '9h', 'Jc Th')
    const n = drawCard(not, rng(1))
    expect(n.drew).toBeNull()
    expect(n.turn).toBe(1)
    // and having drawn, it is known the player held no heart
    expect(n.short[0][1]).toBe(true)
  })
  it('turns the pile back into the stock when the stock runs out, keeping the top card', () => {
    const h = table(['2d', 'As'], '4c 5c 6c 9h', '')
    const d = drawCard(h, rng(2))
    expect(d.pile).toEqual(cs('9h'))
    // the three under the top go back into the stock, and one of them is drawn
    expect(d.stock.length + d.hands[0].length).toBe(3 + 1)
  })
  it('goes out with the last card, and pays the cards left in the others’ hands', () => {
    const h = table(['Kh', 'As 8c Qd 5s'], '5h')
    const out = playCard(h, card('Kh'))
    expect(out.winner).toBe(0)
    // an ace one, an eight fifty, a picture ten, the rest their number
    expect(payout(out)).toBe(1 + 50 + 10 + 5)
    expect([cost(card('2c')), cost(card('Tc')), cost(card('Jc'))]).toEqual([2, 10, 10])
  })
})

describe('the computer', () => {
  it('saves its eights while anything else will go', () => {
    const h = table(['8s 5h 9c', 'As Kd'], '2h')
    for (const level of ['fair', 'hard'] as const) {
      const c = choose(h, level, rng(1))
      expect(c).toEqual({ kind: 'play', card: card('5h') })
    }
  })
  it('on Hard, names a suit the next player has been seen without', () => {
    const h = table(['8s 5h 4h 3c', 'As Kd'], '2d')
    h.short[1][3] = true
    const c = choose({ ...h, hands: [cs('8s 4h 3c'), h.hands[1]] }, 'hard', rng(1))
    expect(c).toEqual({ kind: 'play', card: card('8s'), suit: 3 })
    // Fair names the suit it holds most of
    const f = choose({ ...h, hands: [cs('8s 4h 3h 3c'), h.hands[1]] }, 'fair', rng(1))
    expect(f).toEqual({ kind: 'play', card: card('8s'), suit: 1 })
  })
  it('wins more, level by level', () => {
    // measured on other games, two players to a hundred: Fair beats Easy 346 in 400, Hard beats
    // Fair 322 in 600 — a small edge: between two sensible players this game is mostly the deal
    const games = (a: Level, b: Level, n: number) => {
      let won = 0
      for (let g = 1; g <= n; g++) {
        const rand = rng(g * 131)
        const pts = [0, 0]
        let first = g % 2
        for (let k = 0; k < 200; k++) {
          const r = playHand([a, b], rand, first)
          first = 1 - first
          if (r.winner === null) continue
          pts[r.winner] += r.points
          if (pts[r.winner] >= 100) {
            if (r.winner === 0) won++
            break
          }
        }
      }
      return won
    }
    expect(games('fair', 'easy', 60)).toBeGreaterThanOrEqual(46)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      players: 4,
      felt: 'blue',
      back: 'stars',
      record: {
        easy: { won: 3, played: 4 },
        fair: { won: 2, played: 5 },
        hard: { won: 1, played: 7 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"players":5,"felt":"gold"}')).toEqual(EMPTY)
  })
})
