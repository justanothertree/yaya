import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  BLAST,
  COLS,
  CRATER,
  EMPTY,
  FIELD_W,
  G,
  HANDS,
  LIFE,
  MAX_SPEED,
  aim,
  duel,
  fly,
  groundAt,
  gunAt,
  harm,
  newField,
  readSaved,
  shoot,
  type Field,
  type Saved,
} from './artillery'

/** a flat field, still air, guns where the test wants them */
const flat = (h = 0.2, wind = 0, at: [number, number] = [0.2, 1.4]): Field => ({
  ...newField(1),
  ground: new Array(COLS + 1).fill(h),
  wind,
  guns: [
    { x: at[0], life: LIFE },
    { x: at[1], life: LIFE },
  ],
})

describe('the field', () => {
  it('is rolling ground within bounds, the same for the same seed, level under each gun', () => {
    for (let s = 1; s < 40; s++) {
      const f = newField(s)
      expect(f.ground.every((h) => h >= 0.06 && h <= 0.62)).toBe(true)
      for (const g of f.guns) {
        const c = Math.round(g.x / (FIELD_W / COLS))
        expect(f.ground[c - 3]).toBe(f.ground[c + 3])
      }
      expect(Math.abs(f.wind)).toBeLessThanOrEqual(0.35)
    }
    expect(newField(9)).toEqual(newField(9))
  })
})

describe('a shell', () => {
  it('in still air over flat ground lands where the textbook says', () => {
    // fired from the muzzle, a gun's height up and half a gun forward of its middle: the range of
    // a shot from a height h is v cos a (v sin a + sqrt(v² sin² a + 2gh)) / g
    const f = flat()
    const start = gunAt(f, 0)
    for (const [angle, charge] of [
      [45, 0.6],
      [30, 0.5],
      [60, 0.55],
    ]) {
      const a = (angle * Math.PI) / 180
      const v = charge * MAX_SPEED
      const mx = start.x + Math.cos(a) * 0.022 * 1.5
      const h = start.y + Math.sin(a) * 0.022 * 1.5 - 0.2
      const range =
        (v * Math.cos(a) * (v * Math.sin(a) + Math.sqrt(v * v * Math.sin(a) ** 2 + 2 * G * h))) / G
      expect(fly(f, 0, angle, charge).burst!.x).toBeCloseTo(mx + range, 2)
    }
  })
  it('is carried by the wind, and flies the other way from the other gun', () => {
    const calm = fly(flat(), 0, 45, 0.45).burst!.x
    expect(fly(flat(0.2, 0.3), 0, 45, 0.45).burst!.x).toBeGreaterThan(calm + 0.05)
    expect(fly(flat(0.2, -0.3), 0, 45, 0.45).burst!.x).toBeLessThan(calm - 0.05)
    const back = fly(flat(), 1, 45, 0.45).burst!.x
    expect(back).toBeLessThan(gunAt(flat(), 1).x - 0.3)
  })
  it('flies off the field when sent too hard, and bursts on nothing', () => {
    expect(fly(flat(), 0, 30, 1).burst).toBeNull()
  })
  it('strikes a gun square when it meets it', () => {
    const f = flat(0.2, 0, [0.2, 0.9])
    const a = aim(f, 0)
    expect(fly(f, 0, a.angle, a.charge).struck).toBe(1)
  })
})

describe('a burst', () => {
  it('harms most at the gun and nothing beyond the blast', () => {
    const f = flat()
    const g = gunAt(f, 1)
    expect(harm(f, g, 1, true)).toBe(45)
    expect(harm(f, { x: g.x + BLAST * 0.5, y: g.y }, 1, false)).toBeGreaterThan(10)
    expect(harm(f, { x: g.x + BLAST * 1.01, y: g.y }, 1, false)).toBe(0)
  })
  it('digs a crater, and a gun on the dug ground drops into it', () => {
    let f = flat(0.3, 0, [0.2, 1.0])
    // fire straight at the ground just short of the right gun, many times over
    const before = groundAt(f, 1.0)
    for (let i = 0; i < 6; i++) {
      f = { ...f, turn: 0 }
      const a = aim(f, 0)
      f = shoot(f, a.angle, a.charge).field
    }
    expect(groundAt(f, 1.0)).toBeLessThan(before - CRATER * 0.5)
    expect(gunAt(f, 1).y).toBeCloseTo(groundAt(f, 1.0) + 0.022, 9)
  })
  it('wins the duel when a gun is out of life, and hands the turn over otherwise', () => {
    const f = {
      ...flat(0.2, 0, [0.2, 0.9]),
      guns: [
        { x: 0.2, life: LIFE },
        { x: 0.9, life: 10 },
      ] as Field['guns'],
    }
    const a = aim(f, 0)
    const after = shoot(f, a.angle, a.charge)
    expect(after.field.winner).toBe(0)
    const miss = shoot(flat(), 20, 0.2)
    expect(miss.field.turn).toBe(1)
    expect(miss.field.winner).toBeNull()
  })
})

describe('the computer', () => {
  it('works out a shot that lands square on you, whatever the wind, nearly always', () => {
    // measured: 79 square hits on these 80 fields; without its second, finer look, 77
    let square = 0
    for (let s = 1; s <= 80; s++) {
      const from = (s & 1) as 0 | 1
      const f = newField(s * 13)
      const a = aim(f, from)
      if (fly(f, from, a.angle, a.charge).struck === (from ? 0 : 1)) square++
    }
    expect(square).toBeGreaterThanOrEqual(78)
  }, 30_000)
  it('hurts more a shot level by level, from the same aim', () => {
    const fields = [3, 5, 7, 11].map((s) => newField(s))
    const aims = fields.map((f) => aim(f, 0))
    const per = (lv: 'easy' | 'fair' | 'hard') => {
      const r = rng(4)
      const n = () => (r() + r() + r() + r() - 2) / 0.577
      let t = 0
      fields.forEach((f, i) => {
        for (let k = 0; k < 40; k++) {
          const fl = fly(
            f,
            0,
            aims[i].angle + n() * HANDS[lv].angle,
            aims[i].charge + n() * HANDS[lv].charge,
          )
          t += fl.burst ? harm(f, fl.burst, 1, fl.struck === 1) : 0
        }
      })
      return t / (fields.length * 40)
    }
    // measured over thirty fields: 8.3, 17.2 and 29.4 harm a shot
    const easy = per('easy')
    const fair = per('fair')
    const hard = per('hard')
    expect(fair).toBeGreaterThan(easy * 1.4)
    expect(hard).toBeGreaterThan(fair * 1.3)
  })
  it('fights a whole duel to a finish', () => {
    const d = duel('hard', 'hard', 3)
    expect(d.winner).not.toBeNull()
    expect(d.shots).toBeLessThan(120)
  }, 30_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      sky: 'night',
      trail: false,
      record: {
        easy: { won: 3, lost: 1, fewest: 4 },
        fair: { won: 2, lost: 5, fewest: 6 },
        hard: { won: 1, lost: 7, fewest: 9 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"sky":"noon","trail":"yes"}')).toEqual(EMPTY)
  })
})
