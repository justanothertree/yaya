import { describe, expect, it } from 'vitest'
import { minionOf } from './minion'
import { temperOf, BAND as BOSS } from './temper'
import type { Drawing, Stroke } from '../draw/strokes'

/**
 * The same creature, at the size there are forty of.
 *
 * ⚠️ THE WHOLE CLAIM IS THAT IT IS THE SAME CREATURE, and that is the only thing here worth
 * testing hard. A minion derived separately from the drawing would be a second opinion about what
 * somebody drew — two readings that agree today and drift the first time either is tuned. These
 * ask whether the ORDER survives: the creature that makes the bigger boss has to make the bigger
 * minion, or the role has stopped being a role and started being a different creature.
 */

const stroke = (p: number[], l: number): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.04,
  p,
  l,
})

const creature = (parts: Array<[string, number[]]>, ratio = 1): Drawing => ({
  v: 1,
  name: 'Test',
  ratio,
  bg: null,
  layers: parts.map(([name]) => name),
  strokes: parts.map(([, box], i) => stroke(box, i)),
})

/** a tall narrow thing and a wide squat thing — the two ends of what temperOf reads for size */
const lanky = creature([
  ['body', [0.45, 0.1, 0.55, 0.72]],
  ['leg', [0.46, 0.72, 0.5, 0.95]],
  ['leg2', [0.52, 0.72, 0.56, 0.95]],
])
const squat = creature([
  ['body', [0.12, 0.42, 0.88, 0.62]],
  ['horn', [0.84, 0.36, 0.95, 0.46]],
])

describe('a minion is the drawing it came from', () => {
  it('and says the same thing twice', () => {
    expect(minionOf(lanky)).toEqual(minionOf(lanky))
  })

  /**
   * ⚠️ THE ORDER SURVIVES THE ROLE, which is the whole of "one drawing, one creature". If the
   * thing that makes the bigger boss did not make the bigger minion, the two readings would have
   * parted company and a creature would mean different things depending which end of the game it
   * turned up at.
   */
  it('and whichever makes the bigger boss makes the bigger minion', () => {
    const bossBigger = temperOf(lanky).scale > temperOf(squat).scale
    const minionBigger = minionOf(lanky).scale > minionOf(squat).scale
    expect(minionBigger).toBe(bossBigger)
  })

  it('and whichever makes the tougher boss makes the tougher minion', () => {
    const bossTougher = temperOf(lanky).life > temperOf(squat).life
    expect(minionOf(lanky).life > minionOf(squat).life).toBe(bossTougher)
  })

  /** ⚠️ and a drawing nobody could have meant is still a creature you can fight */
  it('and no drawing escapes the band', () => {
    const daft: Drawing[] = [
      creature([['body', [0.499, 0.499, 0.5, 0.5]]]),
      creature([['body', [-40, -40, 40, 40]]]),
      creature([['body', [0, 0.49, 1, 0.5]]], 20),
      creature([['body', [0.49, 0, 0.5, 1]]], 0.05),
    ]
    for (const d of daft) {
      const m = minionOf(d)
      expect(m.scale).toBeGreaterThanOrEqual(0.45)
      expect(m.scale).toBeLessThanOrEqual(0.85)
      expect(m.life).toBeGreaterThanOrEqual(8)
      expect(m.life).toBeLessThanOrEqual(26)
      expect(m.pace).toBeGreaterThanOrEqual(1)
      expect(m.pace).toBeLessThanOrEqual(1.75)
      expect(m.bite).toBeGreaterThanOrEqual(3)
      expect(m.bite).toBeLessThanOrEqual(9)
      for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('and it is the role, not the creature', () => {
  /**
   * ⚠️ SMALLER THAN YOU ARE, which is what makes a crowd readable. A boss is 2.05 to 3.05 and you
   * are 1; if a minion were anywhere near either, forty of them would be a wall rather than a
   * thing you move through.
   */
  it('is smaller than the player, never mind the boss', () => {
    for (const d of [lanky, squat]) {
      expect(minionOf(d).scale).toBeLessThan(1)
      expect(minionOf(d).scale).toBeLessThan(temperOf(d).scale)
    }
  })

  /**
   * ⚠️ AND IT DIES IN A FEW HITS, which is the difference between a crowd and forty fights. A
   * boss carries 220 to 470 against swings that land for five to fifteen; a minion has to be
   * something you clear on the way past.
   */
  it('and falls to two or three swings rather than to a campaign', () => {
    for (const d of [lanky, squat]) {
      const m = minionOf(d)
      /* an ordinary swing, which is the bottom of what a creature's move table hits for */
      expect(m.life / 5).toBeLessThan(6)
      expect(m.life).toBeLessThan(temperOf(d).life / 8)
    }
  })

  /** ⚠️ and it comes at you faster than a boss does, because it is small and there are lots */
  it('and moves quicker than the boss version of itself', () => {
    for (const d of [lanky, squat]) expect(minionOf(d).pace).toBeGreaterThan(temperOf(d).pace)
  })

  /** ⚠️ and the bands are the ones the role claims, not the boss's */
  it('and sits nowhere near the boss bands', () => {
    for (const d of [lanky, squat]) {
      expect(minionOf(d).scale).toBeLessThan(BOSS.scale[0])
      expect(minionOf(d).life).toBeLessThan(BOSS.life[0])
    }
  })
})
