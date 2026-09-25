import { describe, expect, it } from 'vitest'
import { CAST, castFromSlot, castSlot, inPatch, patchesOf, type CastKind } from './cast'
import { ASPECT, HOP, PARK_TALL } from './strike'
import { PARK } from './walk'

/**
 * What a cast covers, and the one thing that must never close.
 *
 * ⚠️ THE FISSURE TEST IS HERE BECAUSE I ALMOST SHIPPED IT SHUT. Widening its steps from 0.46
 * to 0.58 pet-heights reads as an obvious improvement — it is the one attack made of several
 * circles, so bigger circles is a bigger attack — and two radii at 0.58 is 1.16 against a
 * WAVE_GAP of 1.15, so consecutive steps touch and the rolling line becomes a wall with no way
 * across. It was caught by doing the sum in one unit; on screen it is five circles either way.
 * Nothing but arithmetic was ever going to catch it, so the arithmetic lives here now.
 */

const WORLD_WIDE = PARK.across * ASPECT
const WORLD_TALL = PARK.down
const KINDS: CastKind[] = ['bloom', 'mark', 'wave', 'bolt']

const FROM = { x: 0.5, y: 0.5 }
const AIM = { x: 1, y: 0 }

/** two patches, in the one unit both their positions and their radii can be compared in */
const apart = (a: { at: { x: number; y: number } }, b: { at: { x: number; y: number } }) =>
  Math.hypot((a.at.x - b.at.x) * WORLD_WIDE, (a.at.y - b.at.y) * WORLD_TALL)

describe('the fissure leaves floor between its steps', () => {
  it.each([0.4, 0.7, 1])('at the size a player is (%s)', (scale) => {
    const steps = patchesOf('wave', FROM, AIM, 0.6, scale)
    expect(steps.length).toBeGreaterThan(1)
    for (let i = 1; i < steps.length; i++) {
      const gap = apart(steps[i - 1], steps[i])
      const touching = steps[i - 1].r + steps[i].r
      expect(gap, `steps ${i - 1}→${i} at scale ${scale}`).toBeGreaterThan(touching)
    }
  })

  /**
   * ⚠️ AND A BIG BOSS'S FISSURE IS A WALL, WHICH IS A FINDING AND NOT A RULE. The
   * radius scales with the creature and WAVE_GAP deliberately does not — its note explains
   * why, which is that a spacing multiplied by a 2.5 boss put the last step half a screen past
   * the edge of the world. What that note did not work out is the other end: two radii pass
   * 1.15 pet-heights somewhere around scale 1.25, so from there up the steps touch and the
   * "cross it" half of `CAST.wave.says` stops being true.
   *
   * This is deliberately NOT asserted as correct. It is written down so that the day somebody
   * decides to fix it, the test that changes is this one, and the day somebody widens the
   * steps again, the test above is what stops them.
   */
  it('though a boss-sized one is not crossable, only jumpable', () => {
    const steps = patchesOf('wave', FROM, AIM, 0.6, 2.5)
    const merged = steps.some((s, i) => i > 0 && apart(steps[i - 1], s) <= steps[i - 1].r + s.r)
    expect(merged, 'a 2.5 boss still leaves floor between its steps').toBe(true)
    /* the answer that survives at every size: it is drawn low enough to clear */
    expect(CAST.wave.lift).toBeLessThanOrEqual(HOP.under)
  })

  it('and its steps go outward, one after another', () => {
    const steps = patchesOf('wave', FROM, AIM, 0.6)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].at.x).toBeGreaterThan(steps[i - 1].at.x)
    }
  })
})

describe('what each cast is for is visible in its size', () => {
  const widest = (k: CastKind, t: number) =>
    Math.max(...patchesOf(k, FROM, AIM, t, 1).map((p) => p.r)) / PARK_TALL

  /**
   * ⚠️ THE CHEAP FAST ONE STAYS A NEEDLE. The bolt waits 0.55s against the other three's four
   * seconds, and being small is what it trades for that. If a later tuning pass grows
   * everything, this is the line that says the bargain has gone.
   */
  it('the bolt is the smallest, and it is the one you can throw often', () => {
    expect(widest('bolt', 0.5)).toBeLessThan(widest('mark', 1.1))
    expect(widest('bolt', 0.5)).toBeLessThan(widest('bloom', CAST.bloom.time))
    expect(CAST.bolt.wait).toBeLessThan(CAST.mark.wait)
    expect(CAST.bolt.wait).toBeLessThan(CAST.bloom.wait)
  })

  it('and the slowest to land is not the smallest', () => {
    /* what a long telegraph buys is area — the mark warns for about a second */
    expect(widest('mark', 1.1)).toBeGreaterThan(widest('bolt', 0.5))
  })

  it('the swell keeps growing for as long as it is out', () => {
    const early = widest('bloom', 0.6)
    const mid = widest('bloom', 1.0)
    const late = widest('bloom', CAST.bloom.time)
    expect(mid).toBeGreaterThan(early)
    expect(late).toBeGreaterThan(mid)
  })

  it('and a bigger creature throws a bigger one', () => {
    for (const k of KINDS) {
      const t = k === 'bloom' ? CAST.bloom.time : 1.1
      expect(
        widest(k, t) * 0 + Math.max(...patchesOf(k, FROM, AIM, t, 2).map((p) => p.r)),
      ).toBeGreaterThan(Math.max(...patchesOf(k, FROM, AIM, t, 1).map((p) => p.r)))
    }
  })
})

describe('a cast is only dangerous while it says it is', () => {
  it('nothing is live on the frame it starts', () => {
    for (const k of KINDS) {
      for (const p of patchesOf(k, FROM, AIM, 0)) {
        expect(p.live, `${k} at t=0`).toBe(false)
        expect(p.ready, `${k} readiness at t=0`).toBeLessThan(1)
      }
    }
  })

  it('and every one of them becomes live before its time is up', () => {
    for (const k of KINDS) {
      const span = CAST[k].time
      let everLive = false
      for (let t = 0; t <= span + 0.4; t += 0.02) {
        if (patchesOf(k, FROM, AIM, t).some((p) => p.live)) everLive = true
      }
      expect(everLive, `${k} never became live`).toBe(true)
    }
  })

  it('and readiness only ever climbs towards 1', () => {
    for (const k of KINDS) {
      let was = -1
      for (let t = 0; t <= CAST[k].time; t += 0.05) {
        const r = patchesOf(k, FROM, AIM, t)[0].ready
        expect(r, `${k} readiness`).toBeGreaterThanOrEqual(was)
        expect(r).toBeLessThanOrEqual(1)
        was = r
      }
    }
  })
})

describe('the bolt is thrown', () => {
  it('and travels away from where it was thrown', () => {
    const at = (t: number) => patchesOf('bolt', FROM, AIM, t)[0].at.x
    expect(at(0.9)).toBeGreaterThan(at(0.6))
    expect(at(0.6)).toBeGreaterThan(at(0.45))
  })

  it('and a held one is fatter and faster than a tapped one', () => {
    const plain = patchesOf('bolt', FROM, AIM, 0.8, 1, 0)[0]
    const charged = patchesOf('bolt', FROM, AIM, 0.8, 1, 1)[0]
    expect(charged.r).toBeGreaterThan(plain.r)
    expect(charged.at.x).toBeGreaterThan(plain.at.x)
  })
})

describe('standing in one', () => {
  it('is true at the middle and false well outside', () => {
    const p = patchesOf('mark', FROM, AIM, 1.1)[0]
    expect(inPatch(p.at, 1, p)).toBe(true)
    expect(inPatch({ x: p.at.x + 0.4, y: p.at.y }, 1, p)).toBe(false)
  })

  /**
   * ⚠️ SEARCHED FOR RATHER THAN GUESSED AT. The first version of this put the target at
   * 1.1 times the radius and asserted a narrow creature was clear — which it is not, because a
   * footprint is added to the circle and 10% of the radius is smaller than the footprint of
   * even a thin thing. A magic multiplier is a test that encodes today's numbers; this asks the
   * actual question, which is whether width buys reach at all.
   */
  it('and a wider creature is caught where a thin one is not', () => {
    const p = patchesOf('mark', FROM, AIM, 1.1)[0]
    const caughtAt = (wide: number) => {
      for (let out = 0; out < 1; out += 0.002) {
        if (!inPatch({ x: p.at.x + out, y: p.at.y }, wide, p)) return out
      }
      return Infinity
    }
    const thin = caughtAt(0.05)
    const fat = caughtAt(3)
    expect(thin).toBeLessThan(fat)
    expect(inPatch({ x: p.at.x + thin, y: p.at.y }, 3, p)).toBe(true)
  })
})

describe('a cast survives the wire', () => {
  /**
   * ⚠️ THE STALE CLAMP MADE A BOLT ARRIVE AS A WAVE. Slots are numbers above the six move
   * slots, and the ceiling was written down as 9 while there were three kinds; the fourth made
   * castFromSlot(9) the third entry. This is the round trip that would have said so.
   */
  it('and comes back as the cast it went out as', () => {
    for (const k of KINDS) expect(castFromSlot(castSlot(k))).toBe(k)
  })

  it('and slots start above the six a creature has of its own', () => {
    for (const k of KINDS) expect(castSlot(k)).toBeGreaterThan(6)
  })

  it('and nothing outside the range decodes to anything', () => {
    expect(castFromSlot(6)).toBeNull()
    expect(castFromSlot(0)).toBeNull()
    expect(castFromSlot(KINDS.length + 7)).toBeNull()
  })

  it('and every kind has a sentence to say about it', () => {
    for (const k of KINDS) {
      expect(CAST[k].says.length).toBeGreaterThan(10)
      expect(CAST[k].short.length).toBeGreaterThan(2)
    }
  })
})
