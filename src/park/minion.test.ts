import { describe, expect, it } from 'vitest'
import { BAND, biteOf, biteSpan, biting, minionOf } from './minion'
import { A_SWING } from '../pets/attack'
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
      expect(m.scale).toBeGreaterThanOrEqual(0.7)
      expect(m.scale).toBeLessThanOrEqual(1.15)
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
   * ⚠️ ROUGHLY YOUR OWN SIZE, AND THE FIRST VERSION HAD THIS BACKWARDS. It asserted a minion was
   * smaller than the player, on the reasoning that a crowd has to be readable — and forty things
   * at half height read as young rather than as numerous. What separates a minion from you is
   * that it dies in two hits and there are forty of it, not that it is knee-high. The claim worth
   * pinning is that it is nothing like a BOSS, which is the comparison that was always the point.
   */
  it('is a creature beside you, and nothing like a boss', () => {
    for (const d of [lanky, squat]) {
      const m = minionOf(d)
      expect(m.scale, 'knee-high').toBeGreaterThan(0.6)
      expect(m.scale, 'a boss in disguise').toBeLessThan(temperOf(d).scale / 1.7)
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
      /**
       * ⚠️ IN SWINGS, AND AGAINST THE NUMBER IN THE NAME OF THE TEST. This read
       * `expect(m.life / 5).toBeLessThan(6)` — a test called "two or three swings" asserting
       * fewer than six, with the 5 typed in beside a move table that owns the answer. So it
       * passed on a band that was really 1.6 to 5.2, and a wave of ten took fifty swings to
       * clear while this stayed green. A bound taken from the code is the code agreeing with
       * itself; A_SWING is the table's own answer and 3 is the claim.
       */
      expect(m.life / A_SWING, 'swings to fell one').toBeLessThanOrEqual(3)
      expect(m.life / A_SWING, 'it should not fall to a graze').toBeGreaterThan(1)
      expect(m.life).toBeLessThan(temperOf(d).life / 8)
    }
  })

  /**
   * ⚠️ AND THE WHOLE BAND, NOT TWO DRAWINGS, because the two above sit near the bottom of it and
   * passed the old number happily. The creature that actually exposed this in the park rolled
   * near the TOP — 23.8 against a bite of 5 — and no fixture here was anywhere near it, so the
   * test was green about a case it never visited. `into` is monotone, so the band's ends are the
   * extremes of every drawing there will ever be: checking those two numbers checks everybody.
   */
  it('and the toughest thing anybody can draw still dies in three', () => {
    const [weakest, toughest] = BAND.life
    expect(toughest / A_SWING, 'swings for the toughest minion').toBeLessThanOrEqual(3)
    expect(weakest / A_SWING, 'swings for the frailest').toBeGreaterThan(1)
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

/**
 * A minion's bite, which is a move rather than a fact about being near one.
 *
 * ⚠️ THE THING BEING TESTED IS THAT IT HAS STAGES AT ALL. Touching you used to BE the damage:
 * anything whose footprint met yours landed a blow on that frame, which is why the park needed a
 * grace window to stop a crowd locking you out. The invariant worth pinning is the one that makes
 * contact answerable — that there is a window before the blow in which nothing has landed yet,
 * and that it is long enough for a person to do something about.
 */
describe('a minion bites in three stages', () => {
  /** about the floor of what anybody can react to, which the wind-up must clear */
  const REACTABLE = 0.18

  it('winds up before it lands, for long enough to answer', () => {
    for (const d of [lanky, squat]) {
      const b = biteOf(minionOf(d))
      expect(b.wind, 'wind-up you could act on').toBeGreaterThanOrEqual(REACTABLE)
      expect(biting(b, 0), 'dangerous the instant it starts').toBe(false)
      expect(biting(b, b.wind * 0.99), 'dangerous during the wind-up').toBe(false)
      expect(biting(b, b.wind), 'dangerous when the wind-up ends').toBe(true)
    }
  })

  /** ⚠️ and the whole band, not two drawings — see the note on the life band above */
  it('and the quickest thing anybody can draw still telegraphs', () => {
    /* biteOf reads `pace`, so the ends of that band are the ends of every minion there can be */
    for (const pace of BAND.pace) {
      const b = biteOf({ scale: 1, life: 10, pace, bite: 5 })
      expect(b.wind, `pace ${pace}`).toBeGreaterThanOrEqual(REACTABLE)
    }
  })

  it('and is harmless again afterwards, with a gap before the next one', () => {
    const b = biteOf(minionOf(lanky))
    expect(biting(b, b.wind + b.live), 'the window has closed').toBe(false)
    expect(biting(b, biteSpan(b) - 0.001), 'still closed at the end').toBe(false)
    expect(b.rest, 'a recovery you can walk away in').toBeGreaterThan(b.live)
  })

  /**
   * ⚠️ AND THE DANGEROUS WINDOW IS A SLIVER OF THE WHOLE, which is what makes walking out of one
   * the reward for reading it. If the bite were live for most of its span, the wind-up would be
   * decoration — you would be hit for being nearby a moment later, which is what it replaced.
   */
  it('and is dangerous for a small part of the time it takes', () => {
    for (const d of [lanky, squat]) {
      const b = biteOf(minionOf(d))
      expect(b.live / biteSpan(b), 'share of the bite that can hurt you').toBeLessThan(0.15)
    }
  })

  /** ⚠️ a quicker minion snaps and recovers fast, which is how the drawing decides the feel */
  it('and a quicker minion snaps faster than a slow one', () => {
    const slow = biteOf({ scale: 1, life: 10, pace: BAND.pace[0], bite: 5 })
    const fast = biteOf({ scale: 1, life: 10, pace: BAND.pace[1], bite: 5 })
    expect(fast.wind, 'wind-up').toBeLessThan(slow.wind)
    expect(fast.rest, 'recovery').toBeLessThan(slow.rest)
    expect(biteSpan(fast)).toBeLessThan(biteSpan(slow))
  })
})
