import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { card } from './poker'
import {
  EMPTY,
  bid,
  bidding,
  chooseBid,
  chooseCard,
  count,
  deal,
  handOver,
  legal,
  nilSafe,
  playCard,
  readSaved,
  scoreHand,
  winnerOf,
  winnerTeam,
  type Hand,
  type Level,
  type Saved,
  type Team,
} from './spades'

const cs = (s: string) => s.split(' ').map(card)
const zero: Team[] = [
  { score: 0, bags: 0 },
  { score: 0, bags: 0 },
]
/** a whole game to 300 between two levels, the first level's team named by `seatA` */
function game(a: Level, b: Level, seed: number) {
  const rand = rng(seed)
  let teams = zero
  let dealer = seed % 4
  const lv: Level[] = seed % 2 ? [a, b, a, b] : [b, a, b, a]
  for (let k = 0; k < 40; k++) {
    let h = deal(rand, dealer)
    while (bidding(h)) h = bid(h, chooseBid(h, lv[h.turn], rand))
    while (!handOver(h)) h = playCard(h, chooseCard(h, lv[h.turn], rand))
    teams = scoreHand(h.bids as number[], h.won, teams)
    dealer = (dealer + 1) % 4
    const w = winnerTeam(teams, 300)
    if (w !== null) return w === (seed % 2 ? 0 : 1)
  }
  return false
}

describe('a hand', () => {
  it('deals thirteen each, every card once, and the seat left of the dealer starts', () => {
    const h = deal(rng(3), 2)
    expect(h.hands.every((x) => x.length === 13)).toBe(true)
    expect(new Set(h.hands.flat()).size).toBe(52)
    expect(h.turn).toBe(3)
    expect(h.leader).toBe(3)
  })
  it('is bid round the table, nil to thirteen, and the first bidder leads', () => {
    let h = deal(rng(4), 0)
    const order: number[] = []
    for (const b of [3, 0, 20, -2]) {
      order.push(h.turn)
      h = bid(h, b)
    }
    expect(order).toEqual([1, 2, 3, 0])
    expect(h.bids).toEqual([0, 3, 0, 13])
    expect(bidding(h)).toBe(false)
    expect(h.turn).toBe(1)
  })
  it('follows suit, and leads no spade until one has been played, unless that is all there is', () => {
    const base = deal(rng(5), 3)
    const h: Hand = {
      ...base,
      bids: [3, 3, 3, 3],
      turn: 0,
      leader: 0,
      hands: [cs('As Ks 2h 3d'), cs('4h 5h 6c 7c'), cs('8d 9d Tc Jc'), cs('Qh Kh 2s 3s')],
    }
    expect(legal(h).sort()).toEqual(cs('2h 3d').sort())
    expect(legal({ ...h, broken: true }).length).toBe(4)
    expect(legal({ ...h, hands: [cs('As Ks'), ...h.hands.slice(1)] }).length).toBe(2)
    const led = playCard(h, card('2h'))
    expect(legal(led)).toEqual(cs('4h 5h'))
    // West holds no diamond: anything goes, a spade included
    const d = playCard(h, card('3d'))
    expect(legal({ ...d, hands: [d.hands[0], cs('2s 6c'), ...d.hands.slice(2)] }).length).toBe(2)
  })
  it('is won by the highest spade, or failing one the highest of the suit led', () => {
    const t = (s: string) => cs(s).map((c, i) => ({ seat: i, card: c }))
    expect(winnerOf(t('Th Ah 2s Kh'))).toBe(2)
    expect(winnerOf(t('Th Ah Kd Kh'))).toBe(1)
    expect(winnerOf(t('Th 3s As Kh'))).toBe(2)
    expect(winnerOf(t('5c Ad Ah 4c'))).toBe(0)
  })
  it('breaks spades, notes a void, and the winner leads the next trick', () => {
    const base = deal(rng(6), 3)
    let h: Hand = {
      ...base,
      bids: [3, 3, 3, 3],
      turn: 0,
      leader: 0,
      hands: [cs('2h 9c'), cs('2s 5d'), cs('Ah 6d'), cs('3h 7d')],
    }
    h = playCard(h, card('2h'))
    h = playCard(h, card('2s'))
    expect(h.broken).toBe(true)
    expect(h.void[1][1]).toBe(true)
    h = playCard(playCard(h, card('Ah')), card('3h'))
    expect(h.won).toEqual([0, 1, 0, 0])
    expect(h.turn).toBe(1)
    expect(h.tricks).toBe(1)
  })
})

describe('the score', () => {
  it('pays ten a trick and one a bag for a made bid, and takes ten a trick for a missed one', () => {
    // you 4 and North 3 = 7, taking 9: 70 and two bags; West 2 and East 2 = 4, taking 4: 40
    expect(scoreHand([4, 2, 3, 2], [5, 2, 4, 2], zero)).toEqual([
      { score: 72, bags: 2 },
      { score: 40, bags: 0 },
    ])
    expect(scoreHand([4, 3, 3, 4], [3, 4, 3, 3], zero)[0]).toEqual({ score: -70, bags: 0 })
  })
  it('scores nil alone: a hundred either way, and a nil bidder’s tricks are only bags', () => {
    // you nil and clean, North 4 taking 5
    expect(scoreHand([0, 3, 4, 3], [0, 4, 5, 4], zero)[0]).toEqual({ score: 141, bags: 1 })
    // you nil taking two: those two do not help North's 4, who took 3
    expect(scoreHand([0, 3, 4, 3], [2, 4, 3, 4], zero)[0]).toEqual({ score: -140, bags: 2 })
  })
  it('costs a hundred for every tenth bag', () => {
    const before: Team[] = [
      { score: 200, bags: 8 },
      { score: 0, bags: 0 },
    ]
    expect(scoreHand([3, 3, 3, 3], [5, 3, 3, 2], before)[0]).toEqual({ score: 162, bags: 0 })
  })
  it('ends the game at the target, or at minus half of it, with the higher team the winner', () => {
    const t = (a: number, b: number): Team[] => [
      { score: a, bags: 0 },
      { score: b, bags: 0 },
    ]
    expect(winnerTeam(t(290, 250), 300)).toBeNull()
    expect(winnerTeam(t(310, 250), 300)).toBe(0)
    expect(winnerTeam(t(310, 340), 300)).toBe(1)
    expect(winnerTeam(t(100, -150), 300)).toBe(0)
    expect(winnerTeam(t(320, 320), 300)).toBeNull()
  })
})

describe('the computer', () => {
  it('counts tricks the way a player does', () => {
    expect(count(cs('As Ks Qs Js Ts 9s 2h 3h 4d 5d 6c 7c 8c'))).toBeGreaterThan(5)
    expect(count(cs('2s 3h 4h 5h 6d 7d 8d 9c Tc 2c 3c 4c 5d'))).toBeLessThan(1)
    expect(nilSafe(cs('2s 3h 4h 5h 6d 7d 8d 9c Tc 2c 3c 4c 5d'))).toBe(true)
    expect(nilSafe(cs('Ks 3h 4h 5h 6d 7d 8d 9c Tc 2c 3c 4c 5d'))).toBe(false)
  })
  it('never bids nil beside a nil, nor more than the thirteen there are between partners', () => {
    for (let s = 1; s <= 40; s++)
      for (const level of ['fair', 'hard'] as const) {
        let h = deal(rng(s), 3)
        // you bid first here, as nil; West bids next; North is the one under test, beside you
        h = bid(h, 0)
        h = bid(h, 3)
        expect(chooseBid(h, level, rng(s))).toBeGreaterThan(0)
        let g = deal(rng(s), 3)
        g = bid(bid(g, 11), 3)
        expect(chooseBid(g, level, rng(s))).toBeLessThanOrEqual(2)
      }
  }, 30_000)
  it('wins more games, level by level, from both partnerships', () => {
    // measured on other games: Fair beats Easy 95 in 120, Hard beats Fair 60 in 80
    let fair = 0
    for (let s = 1; s <= 30; s++) if (game('fair', 'easy', s)) fair++
    expect(fair).toBeGreaterThanOrEqual(19)
    // here, 36 of 40; a Hard that bid by Fair's rule of thumb, or played its cards by habit as Fair
    // does, won 26 — so both halves of it are earning their keep
    let hard = 0
    for (let s = 1; s <= 40; s++) if (game('hard', 'fair', s)) hard++
    expect(hard).toBeGreaterThanOrEqual(31)
  }, 90_000)
  it('bids nil on Hard with a hand that cannot take a trick, but not beside a partner’s nil', () => {
    const weak = cs('2s 3s 2h 3h 4h 5h 2d 3d 4d 2c 3c 4c 5c')
    let h = deal(rng(8), 3)
    // you, first to bid, bid 3; West 3; North holds the weak hand
    h = { ...h, hands: [h.hands[0], h.hands[1], weak, h.hands[3]] }
    // swap the weak cards out of whoever held them, so every card is still dealt once
    const taken = new Set(weak)
    const spare = Array.from({ length: 52 }, (_, c) => c).filter(
      (c) =>
        !taken.has(c) &&
        !h.hands[0].includes(c) &&
        !h.hands[1].includes(c) &&
        !h.hands[3].includes(c),
    )
    const fix = (x: number[]) => x.map((c) => (taken.has(c) ? spare.pop()! : c))
    h = { ...h, hands: [fix(h.hands[0]), fix(h.hands[1]), weak, fix(h.hands[3])] }
    expect(new Set(h.hands.flat()).size).toBe(52)
    expect(chooseBid(bid(bid(h, 3), 3), 'hard', rng(1))).toBe(0)
    expect(chooseBid(bid(bid(h, 0), 3), 'hard', rng(1))).toBeGreaterThan(0)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      target: 500,
      felt: 'red',
      back: 'stars',
      record: {
        easy: { won: 3, played: 4, nils: 1 },
        fair: { won: 2, played: 5, nils: 0 },
        hard: { won: 1, played: 7, nils: 2 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"target":250,"felt":"gold"}')).toEqual(EMPTY)
  })
})
