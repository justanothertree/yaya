import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  arrange,
  deal,
  discard,
  draw,
  layOff,
  play,
  readSaved,
  value,
  type Hand,
  type Level,
} from './gin'
import { card } from './poker'

const cs = (s: string) => s.split(' ').map(card)

describe('melds and deadwood', () => {
  it('finds the arrangement that leaves the least, even when a card could go two ways', () => {
    // the seven of hearts could join the sevens or the run; the run is worth more here
    const hand = cs('7h 7s 7d 7c 8h 9h Kd Qs 2c 3d')
    const a = arrange(hand)
    expect(a.points).toBe(10 + 10 + 2 + 3)
    // aces count one, and a run starts at the ace but never wraps past the king
    expect(value(card('As'))).toBe(1)
    expect(arrange(cs('As 2s 3s')).points).toBe(0)
    expect(arrange(cs('Qs Ks As')).points).toBe(10 + 10 + 1)
  })
  it("the other player's loose cards go onto the knocker's melds", () => {
    const melds = [cs('4h 5h 6h'), cs('9s 9d 9c')]
    const { left, laid } = layOff(melds, cs('7h 9h Kc 3h'))
    expect(laid.map(String).sort()).toEqual(cs('7h 9h 3h').map(String).sort())
    expect(left).toEqual(cs('Kc'))
  })
})

describe('a hand', () => {
  const at = (mine: string, theirs: string, extra: Partial<Hand> = {}): Hand => ({
    ...deal(1),
    hands: [cs(mine), cs(theirs)],
    phase: 'discard',
    turn: 0,
    ...extra,
  })
  it('knocking needs ten or less; gin pays 25 and their deadwood', () => {
    // left with 2h 3h 9c 8d — 22 — after the three kings and the spade run
    expect(
      discard(
        at('Kh Kd Kc Qs Js Ts 2h 3h 9c 8d Qd', 'As 2d 5c 8h 9h Th Jc Qc 3s 4d'),
        card('Qd'),
        true,
      ).over,
    ).toBeNull()
    const gin = discard(
      at('Kh Kd Kc Qs Js Ts 2h 3h 4h 5h 9c', '2c 3c 5d 6d 8s 9d Jh Qh 4s 6s'),
      card('9c'),
      true,
    ).over!
    expect(gin.how).toBe('gin')
    expect(gin.points).toBe(25 + 2 + 3 + 5 + 6 + 8 + 9 + 10 + 10 + 4 + 6)
  })
  it('a knock scores the difference; an undercut pays the defender 25 and the difference', () => {
    const knock = discard(
      at('Kh Kd Kc Qs Js Ts 2h 3h 4h 5c Qd', '2c 3c 5d 6d 8s 9d Jh Qh 4s 6s'),
      card('Qd'),
      true,
    ).over!
    expect(knock.how).toBe('knock')
    expect(knock.points).toBe(2 + 3 + 5 + 6 + 8 + 9 + 10 + 10 + 4 + 6 - 5)
    // the knocker keeps 9 (the nine of clubs); the defender melds all but an ace, 1, and undercuts
    const under = discard(
      at('Kh Kd Kc Qs Js Ts 2h 3h 4h 9c Qd', 'As 2s 3s 7d 7c 7h 4d 5d 6d Ac'),
      card('Qd'),
      true,
    ).over!
    expect(under.how).toBe('undercut')
    expect(under.winner).toBe(1)
    expect(under.points).toBe(25 + 9 - 1)
  })
  it('a card taken from the pile cannot go straight back, and the cards always number 52', () => {
    let h = deal(5)
    const top = h.pile[h.pile.length - 1]
    h = draw(h, 'pile')
    expect(discard(h, top)).toBe(h)
    for (let k = 0; k < 60 && !h.over; k++) {
      h =
        h.phase === 'draw'
          ? draw(h, 'stock')
          : discard(h, h.hands[h.turn].find((c) => c !== h.took)!)
      expect(h.hands[0].length + h.hands[1].length + h.stock.length + h.pile.length).toBe(52)
    }
    // nobody knocked and the stock ran down: void
    expect(h.over?.how).toBe('void')
  })
})

describe('the computer', () => {
  // measured over 1,200 hands from both seats: hard won 78.2% against easy, +15.6 points a hand
  it('hard beats easy from either seat', () => {
    let wins = 0
    let n = 0
    for (let s = 1; s <= 150; s++)
      for (const seat of [0, 1] as const) {
        let h = deal(s, (s % 2) as 0 | 1)
        const lv = (who: number): Level => (who === seat ? 'hard' : 'easy')
        for (let k = 0; k < 200 && !h.over; k++) h = play(h, lv(h.turn))
        if (h.over!.winner === null) continue
        n++
        if (h.over!.winner === seat) wins++
      }
    expect(wins / n).toBeGreaterThan(0.7)
  }, 60000)
})

describe('gin saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'easy',
      felt: 'red',
      back: 'stars',
      melds: false,
      record: { easy: { won: 3, lost: 1, gins: 1 }, hard: { won: 4, lost: 6, gins: 0 } },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('x')).toEqual(EMPTY)
  })
})
