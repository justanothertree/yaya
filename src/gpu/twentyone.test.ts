import { describe, expect, it } from 'vitest'
import { card } from './poker'
import {
  DEFAULT_RULES,
  EMPTY,
  book,
  bust,
  dealerPlays,
  isBlackjack,
  playRound,
  readSaved,
  settle,
  shoe,
  total,
  type Act,
} from './twentyone'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
const h = (...names: string[]) => names.map(card)

/** what a way of playing wins per hand over many rounds from a six-deck shoe */
function rate(choose: (hand: number[], up: number, d: boolean, s: boolean) => Act, rounds: number) {
  const rand = seeded(11)
  let cards = shoe(6, rand)
  let at = 0
  let won = 0
  for (let k = 0; k < rounds; k++) {
    if (at > cards.length - 60) {
      cards = shoe(6, rand)
      at = 0
    }
    won += playRound(() => cards[at++], choose, DEFAULT_RULES)
  }
  return won / rounds
}

describe('hands', () => {
  it('counts an ace as eleven while it fits, and says when the hand is soft', () => {
    expect(total(h('As', '6d'))).toEqual({ value: 17, soft: true })
    expect(total(h('As', '6d', 'Tc'))).toEqual({ value: 17, soft: false })
    expect(total(h('As', 'Ad'))).toEqual({ value: 12, soft: true })
    expect(total(h('Ks', 'Qd'))).toEqual({ value: 20, soft: false })
    expect(bust(h('Ks', 'Qd', '2c'))).toBe(true)
    expect(isBlackjack(h('As', 'Jd'))).toBe(true)
    expect(isBlackjack(h('7s', '7d', '7c'))).toBe(false)
  })
  it('a shoe holds every card of every deck once', () => {
    const s = shoe(6, seeded(2))
    expect(s).toHaveLength(312)
    const tally = new Array(52).fill(0)
    for (const c of s) tally[c]++
    expect(tally.every((n) => n === 6)).toBe(true)
  })
})

describe('the house', () => {
  it('the dealer draws to 17, and hits a soft 17 only under that rule', () => {
    const deck = h('5s', '9d', '9c')
    let i = 0
    const draw = () => deck[i++]
    expect(total(dealerPlays(h('As', '6d'), draw, DEFAULT_RULES)).value).toBe(17)
    i = 0
    const hit = dealerPlays(h('As', '6d'), draw, { ...DEFAULT_RULES, hitSoft17: true })
    expect(hit.length).toBeGreaterThan(2)
    expect(total(hit).value).toBeGreaterThanOrEqual(17)
  })
  it('pays three to two for a blackjack, even money for a win, double when doubled, nothing on a push', () => {
    expect(settle(h('As', 'Kd'), h('Ts', '9d'), false, false)).toBe(1.5)
    expect(settle(h('As', 'Kd'), h('Ah', 'Qd'), false, false)).toBe(0)
    expect(settle(h('As', 'Kd'), h('Ts', '9d'), false, true)).toBe(1)
    expect(settle(h('Ts', '9d'), h('Ts', '8d'), true, false)).toBe(2)
    expect(settle(h('Ts', '9d'), h('Th', '9c'), false, false)).toBe(0)
    expect(settle(h('Ts', '5d', 'Kc'), h('Ts', '6d', '9c'), false, false)).toBe(-1)
    expect(settle(h('Ts', '9d'), h('Ah', 'Kd'), true, false)).toBe(-2)
  })
})

describe('the book', () => {
  it('plays the textbook hands the textbook way', () => {
    expect(book(h('Ts', '6d'), 10, true, true)).toBe('hit')
    expect(book(h('Ts', '2d'), 4, true, true)).toBe('stand')
    expect(book(h('6s', '5d'), 6, true, true)).toBe('double')
    expect(book(h('6s', '5d'), 6, false, true)).toBe('hit')
    expect(book(h('As', '7d'), 9, true, true)).toBe('hit')
    expect(book(h('As', '7d'), 2, true, true)).toBe('stand')
    expect(book(h('8s', '8d'), 10, true, true)).toBe('split')
    expect(book(h('Ts', 'Td'), 6, true, true)).toBe('stand')
    expect(book(h('As', 'Ad'), 1, true, true)).toBe('split')
  })
  // Measured over 200,000 hands each from six-deck shoes: the book lost 0.79% of each bet, copying
  // the dealer (hit to 17) 6.09%, and standing on 12 or more 8.43%.
  it('loses far less than playing like the dealer', () => {
    const byBook = rate(book, 60000)
    const mimic = rate((hand) => (total(hand).value >= 17 ? 'stand' : 'hit'), 60000)
    expect(byBook).toBeGreaterThan(-0.025)
    expect(byBook).toBeGreaterThan(mimic + 0.03)
  })
})

describe('twenty-one saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      rules: { decks: 2, hitSoft17: true },
      felt: 'red',
      back: 'stars',
      hints: true,
      bet: 100,
      chips: 1450,
      peak: 2210,
      rebuys: 2,
      hands: 311,
      agreed: 240,
      decided: 402,
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad, and never claims more agreement than decisions', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({ bet: 7, chips: 40, peak: 10, agreed: 9, decided: 5, rules: { decks: 4 } }),
    )
    expect(back.bet).toBe(25)
    expect(back.chips).toBe(40)
    expect(back.peak).toBe(40)
    expect(back.agreed).toBe(5)
    expect(back.rules).toEqual(DEFAULT_RULES)
  })
})
