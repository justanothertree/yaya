import { describe, expect, it } from 'vitest'
import {
  ARROWS_PER_END,
  BOWS,
  EMPTY,
  FACE_R,
  RING,
  ROUNDS,
  SIGHT_SET,
  dailySeed,
  flight,
  land,
  maxScore,
  readSaved,
  scoreAt,
  sway,
  winds,
  type Bow,
  type RoundName,
} from './archery'

/** a whole round shot by an archer who aims at `aimFor(distance, wind)`, with no sway */
function shoot(
  bow: Bow,
  round: RoundName,
  seed: number,
  aimFor: (d: number, wind: number) => { x: number; y: number },
) {
  const ws = winds(seed, round)
  let total = 0
  ROUNDS[round].forEach((d, e) => {
    for (let k = 0; k < ARROWS_PER_END; k++) {
      const w = ws[e * ARROWS_PER_END + k]
      const at = land(aimFor(d, w), bow, d, w)
      total += scoreAt(at.x, at.y).ring
    }
  })
  return total
}

describe('scoring', () => {
  it('ten rings from the gold outward, an inner ten for the X, nothing off the face', () => {
    expect(scoreAt(0, 0)).toEqual({ ring: 10, x: true })
    expect(scoreAt(RING * 0.6, 0)).toEqual({ ring: 10, x: false })
    expect(scoreAt(RING * 1.01, 0).ring).toBe(9)
    expect(scoreAt(0, -RING * 9.5).ring).toBe(1)
    expect(scoreAt(FACE_R * 0.75, FACE_R * 0.75).ring).toBe(0)
    for (let k = 0; k < 10; k++) expect(scoreAt(RING * (k + 0.5), 0).ring).toBe(10 - k)
  })
})

describe('the flight', () => {
  it('drops nothing at the distance the sight is set for, lands low further off and high closer in', () => {
    for (const bow of Object.keys(BOWS) as Bow[]) {
      expect(flight(bow, SIGHT_SET, 0).drop).toBeCloseTo(0, 12)
      expect(flight(bow, 90, 0).drop).toBeGreaterThan(0)
      expect(flight(bow, 18, 0).drop).toBeLessThan(0)
      expect(land({ x: 0, y: 0 }, bow, 90, 0).y).toBeLessThan(0)
    }
  })
  it('the wind carries an arrow its way, further the longer it flies, and a faster bow less', () => {
    expect(land({ x: 0, y: 0 }, 'recurve', 50, 4).x).toBeGreaterThan(0)
    expect(land({ x: 0, y: 0 }, 'recurve', 50, -4).x).toBeLessThan(0)
    expect(flight('recurve', 90, 4).drift).toBeGreaterThan(flight('recurve', 30, 4).drift)
    expect(flight('compound', 70, 4).drift).toBeLessThan(flight('longbow', 70, 4).drift)
  })
  it('an archer who allows for drop and wind shoots a perfect round; one who aims at the gold does not', () => {
    for (const bow of Object.keys(BOWS) as Bow[]) {
      const perfect = shoot(bow, 'standard', 7, (d, w) => {
        const f = flight(bow, d, w)
        return { x: -f.drift, y: f.drop }
      })
      expect(perfect).toBe(maxScore('standard'))
      expect(shoot(bow, 'long', 7, () => ({ x: 0, y: 0 }))).toBeLessThan(maxScore('long') - 20)
    }
  })
})

describe('the sight and the wind', () => {
  it('the sight sways, less when you steady it, more at long range and when the arm tires', () => {
    let calm = 0
    let shaky = 0
    let tired = 0
    for (let t = 0; t < 6; t += 0.05) {
      const a = sway(t, 'recurve', 50, true, 1)
      const b = sway(t, 'recurve', 50, false, 1)
      calm = Math.max(calm, Math.hypot(a.x, a.y))
      shaky = Math.max(shaky, Math.hypot(b.x, b.y))
      if (t > 4) tired = Math.max(tired, Math.hypot(b.x, b.y))
    }
    expect(calm).toBeLessThan(shaky * 0.5)
    expect(shaky).toBeLessThan(BOWS.recurve.sway * 2 * 1.01)
    const early = Math.hypot(
      sway(0.9, 'recurve', 50, false, 0).x,
      sway(0.9, 'recurve', 50, false, 0).y,
    )
    expect(tired).toBeGreaterThan(early)
    expect(Math.hypot(sway(2, 'recurve', 90, false, 1).x, 0)).toBeGreaterThan(
      Math.hypot(sway(2, 'recurve', 30, false, 1).x, 0),
    )
  })
  it('the wind is the same for a seed, an arrow each, and stronger the later the end', () => {
    const a = winds(42, 'standard')
    expect(winds(42, 'standard')).toEqual(a)
    expect(winds(43, 'standard')).not.toEqual(a)
    expect(a).toHaveLength(ROUNDS.standard.length * ARROWS_PER_END)
    for (const w of a) expect(Math.abs(w)).toBeLessThan(6)
    const morning = new Date(2026, 10, 10, 8)
    expect(dailySeed(morning)).toBe(dailySeed(new Date(2026, 10, 10, 22)))
    expect(dailySeed(morning)).not.toBe(dailySeed(new Date(2026, 10, 11, 8)))
  })
})

describe('archery saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      bow: 'longbow',
      round: 'long',
      face: 'field',
      fletch: 3,
      sightPin: false,
      best: { 'recurve/standard': 101, 'longbow/long': 77 },
      daily: { day: '2026-11-10', total: 96 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({
        bow: 'crossbow',
        best: { 'recurve/standard': 500, 'x/y': 3, 'compound/short': 88 },
        sightPin: false,
      }),
    )
    expect(back).toEqual({ ...EMPTY, sightPin: false, best: { 'compound/short': 88 } })
  })
})
