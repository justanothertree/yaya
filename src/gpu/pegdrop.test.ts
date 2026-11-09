import { describe, expect, it } from 'vitest'
import {
  BETS,
  EMPTY,
  FALL,
  GAP,
  HOP,
  ODDS,
  PEG_R,
  BALL_R,
  RISKS,
  ROWS,
  SLOTS,
  at,
  drop,
  expected,
  paid,
  peg,
  readSaved,
  seeded,
  slotX,
  type Risk,
} from './pegdrop'

const risks = Object.keys(RISKS) as Risk[]

describe('peg drop odds', () => {
  it('are the binomial, from Pascal’s triangle built by addition rather than by the formula', () => {
    // an independent route to the same numbers: each row of the triangle is the sum of the one above
    let row = [1]
    for (let r = 0; r < ROWS; r++) row = [...row, 0].map((v, i) => v + (row[i - 1] ?? 0))
    expect(ODDS.map((p) => p * 2 ** ROWS)).toEqual(row)
    expect(ODDS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })
  it('every risk pays back a little under what goes in — 99%, as the page says', () => {
    for (const r of risks) {
      expect(RISKS[r]).toHaveLength(SLOTS)
      expect(RISKS[r], r).toEqual([...RISKS[r]].reverse())
      const ev = expected(r)
      expect(ev, r).toBeGreaterThan(0.985)
      expect(ev, r).toBeLessThan(1)
    }
  })
  it('the edges pay most and the middle least, at every risk', () => {
    for (const r of risks) {
      const p = RISKS[r]
      for (let k = 0; k < ROWS / 2; k++) expect(p[k], `${r} ${k}`).toBeGreaterThanOrEqual(p[k + 1])
    }
  })
  it('a hundred thousand seeded drops land where the odds say', () => {
    const rand = seeded(7)
    const n = 100_000
    const hits = new Array(SLOTS).fill(0)
    for (let i = 0; i < n; i++) hits[drop(rand).slot]++
    // chi-squared with 12 degrees of freedom: 32.9 is the 0.1% tail, so a fair board passes
    // nearly always and a biased one (try rand() < 0.52) fails by hundreds
    const chi = hits.reduce((t, h, k) => t + (h - n * ODDS[k]) ** 2 / (n * ODDS[k]), 0)
    expect(chi).toBeLessThan(32.9)
  })
  it('the slot is the number of rights, and a drop replays exactly from its seed', () => {
    const a = drop(seeded(3))
    expect(a.slot).toBe(a.turns.filter(Boolean).length)
    expect(drop(seeded(3))).toEqual(a)
  })
})

describe('peg drop path', () => {
  it('rests on top of each peg it meets, in the order its coins chose', () => {
    const d = drop(seeded(11))
    let rights = 0
    for (let r = 0; r < ROWS; r++) {
      const [x, y] = at(d, (r + 1) * HOP)
      const [px, py] = peg(r, rights + 1)
      expect(x, `row ${r}`).toBeCloseTo(px, 9)
      // touching: the gap between the centres is the two radii
      expect(py - y, `row ${r}`).toBeCloseTo(PEG_R + BALL_R, 9)
      if (d.turns[r]) rights++
    }
    const [x] = at(d, FALL + 1)
    expect(x).toBeCloseTo(slotX(d.slot), 9)
  })
  it('never passes through a peg on the way down', () => {
    for (let seed = 1; seed < 40; seed++) {
      const d = drop(seeded(seed))
      for (let t = 0; t < FALL; t += 1 / 240) {
        const [x, y] = at(d, t)
        for (let r = 0; r < ROWS; r++)
          for (let i = 0; i < r + 3; i++) {
            const [px, py] = peg(r, i)
            expect(Math.hypot(x - px, y - py), `seed ${seed} t ${t}`).toBeGreaterThan(
              (PEG_R + BALL_R) * 0.97,
            )
          }
      }
    }
  })
  it('the slots sit between the bottom pegs, one gap apart', () => {
    expect(slotX(1) - slotX(0)).toBeCloseTo(GAP, 12)
    const [a] = peg(ROWS - 1, 0)
    const [b] = peg(ROWS - 1, 1)
    expect(slotX(0)).toBeCloseTo((a + b) / 2, 12)
  })
})

describe('peg drop saves', () => {
  it('round-trips every field, each set away from its default', () => {
    const s = { points: 312.4, best: 900, drops: 77, bigHit: 33, refills: 2, risk: 'high', bet: 25 }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    // drop each field in turn: that one falls back, and every other survives
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      const rest: Record<string, unknown> = { ...s }
      delete rest[k]
      const back = readSaved(JSON.stringify(rest))
      // the most ever held cannot fall below what is held, so a lost best becomes the points
      expect(back[k], k).toBe(k === 'best' ? s.points : EMPTY[k])
      for (const j of Object.keys(s) as (keyof typeof s)[])
        if (j !== k && !(k === 'points' && j === 'best')) expect(back[j], `${k}→${j}`).toBe(s[j])
    }
  })
  it('a broken or hostile store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved('[1]')).toEqual(EMPTY)
    const s = readSaved(
      JSON.stringify({ points: -5, best: 'lots', risk: 'insane', bet: 3, drops: 4 }),
    )
    expect(s).toEqual({ ...EMPTY, drops: 4 })
    // the most ever held is never below what is held now
    expect(readSaved(JSON.stringify({ points: 500, best: 10 })).best).toBe(500)
  })
  it('pays to the tenth, so small bets add up exactly', () => {
    expect(paid(1, 'high', 6)).toBe(0.2)
    expect(paid(25, 'medium', 0)).toBe(825)
    expect(BETS[0]).toBe(1)
  })
})
