import { describe, expect, it } from 'vitest'
import { apart, restSpot, rouse, struck, wantsIt, wildAt, WILD, type Wild } from './wild'
import { outBy, downBy } from './strike'
import { TUNE, type Spot } from './walk'

/**
 * Creatures that live somewhere.
 *
 * ⚠️ EVERY EXPECTATION HERE IS WRITTEN IN CREATURES AND SECONDS — "it notices you from about
 * five creatures away", "it goes home" — never in world units and never against the module's own
 * arithmetic. The park has already shipped a test that divided by the same wrong factor the code
 * multiplied by and therefore agreed with the bug; the way out of that is to say the claim in the
 * unit a person would say it in, and let `apart` be the only thing that converts.
 */

/** a point this many creatures from another, along x */
const east = (from: Spot, creatures: number): Spot => ({
  x: from.x + outBy(creatures),
  y: from.y,
})
const home: Spot = { x: 0.5, y: 0.5 }

/** one that has already noticed you, typed as a Wild so `cross` stays a number — see WILD */
const woken = (at: Spot = home): Wild => ({
  ...wildAt(0, at, 20),
  awake: true,
  cross: WILD.patience,
})

describe('how far apart things are', () => {
  it('measures in creatures, not in world units', () => {
    /* ⚠️ the control that makes every other test in this file mean something. A park unit of x
       and a park unit of y are different distances, so a plain hypot would make these disagree. */
    expect(apart(home, { x: home.x + outBy(3), y: home.y })).toBeCloseTo(3, 6)
    expect(apart(home, { x: home.x, y: home.y + downBy(3) })).toBeCloseTo(3, 6)
  })
})

describe('noticing you', () => {
  it('ignores you until you are close, then wakes', () => {
    const far = [wildAt(0, home, 20)]
    expect(rouse(far, east(home, WILD.notice + 2))[0].awake).toBe(false)
    expect(rouse(far, east(home, WILD.notice - 1))[0].awake).toBe(true)
  })

  it('is something you can walk past at a stroll', () => {
    /**
     * ⚠️ THE CLAIM IS ABOUT PLAYING, NOT ABOUT A NUMBER: crossing a map should not mean fighting
     * everything on it. A thing you can see is roughly a screen away, and the notice range has
     * to be a small part of that or the whole field wakes at once — which is a wave, and the
     * thing this module exists not to be.
     */
    const screenAcross = 1 / outBy(1)
    expect(WILD.notice).toBeLessThan(screenAcross / 3)
  })

  it('wakes the ones standing with it, and no further', () => {
    /**
     * ⚠️ THIS FIXTURE IS BUILT TO TELL TWO RULES APART, and the first version of it could not.
     * "Near the one that noticed you" and "near YOU" agree almost everywhere — by the triangle
     * inequality, anything within `rouse` of a creature that is within `notice` of you is at
     * most `notice + rouse` away from you — so a huddle beside you and a stranger across the
     * field give the same answer under either rule, and the test passed with the spreading
     * rewritten to measure from the player. It was agreeing with the code rather than checking
     * it.
     *
     * The discriminating case is a creature that is CLOSE TO YOU and FAR FROM ANYONE WHO SAW
     * YOU: `lonely` below is 8 creatures from the player — inside notice + rouse, so a
     * player-centred rule wakes it — and 5 from the nearest woken one, which is further than a
     * shout carries. Under the rule that is actually wanted it keeps standing there.
     */
    const you = home
    const seen = east(home, 3) // inside notice: this one looks up
    const withIt = east(home, 3 + WILD.rouse - 1) // standing with it: wakes too
    const lonely = east(home, 8) // 5 from `seen`, which is further than a shout
    const away = east(home, WILD.notice + WILD.rouse + 10) // nowhere near any of it
    const mobs = [
      wildAt(0, seen, 20),
      wildAt(0, withIt, 20),
      wildAt(0, lonely, 20),
      wildAt(0, away, 20),
    ]

    expect(apart(lonely, you)).toBeLessThan(WILD.notice + WILD.rouse)
    expect(apart(lonely, seen)).toBeGreaterThan(WILD.rouse)

    const woke = rouse(mobs, you)
    expect(woke[0].awake).toBe(true)
    expect(woke[1].awake).toBe(true)
    // ⚠️ the one that makes farming possible, and the one a player-centred rule gets wrong
    expect(woke[2].awake).toBe(false)
    expect(woke[3].awake).toBe(false)
  })

  it('can be reached for without waking its friends across the field', () => {
    const mobs = [wildAt(0, home, 20), wildAt(0, east(home, WILD.rouse + 1), 20)]
    const after = struck(mobs, 0)
    expect(after[0].awake).toBe(true)
    expect(after[1].awake).toBe(false)
  })

  it('wakes when hit from further than it can see', () => {
    /* ⚠️ otherwise the game is: stand outside notice range and pick them off one at a time */
    const mobs = [wildAt(0, home, 20), wildAt(0, east(home, 1), 20)]
    const after = struck(mobs, 0)
    expect(after[0].awake).toBe(true)
    expect(after[1].awake).toBe(true)
  })

  it('leaves the dead out of it', () => {
    const mobs = [{ ...wildAt(0, home, 20), life: 0 }]
    expect(rouse(mobs, home)[0].awake).toBe(false)
    expect(struck(mobs, 0)[0].awake).toBe(false)
  })
})

describe('giving up', () => {
  const walkAway = (secs: number, m: Wild = woken()) => {
    let w = m
    /* standing a long way off, which is the thing that makes it lose interest */
    const you = east(home, WILD.chase + 5)
    for (let t = 0; t < secs; t += 1 / 60) w = wantsIt(w, you, 1 / 60)
    return w
  }

  it('keeps coming for a moment, then turns back', () => {
    // ⚠️ the countdown is the point: it must NOT drop you the first frame you step out of range
    expect(walkAway(WILD.patience / 2).awake).toBe(true)
    expect(walkAway(WILD.patience + 0.3).awake).toBe(false)
  })

  it('stays interested while you are near its home', () => {
    let w = woken()
    const you = east(home, 2)
    for (let t = 0; t < 10; t += 1 / 60) w = wantsIt(w, you, 1 / 60)
    expect(w.awake).toBe(true)
  })

  it('forgives you for stepping out of sight for half a second', () => {
    let w = woken()
    const gone = east(home, WILD.chase + 5)
    const back = east(home, 2)
    for (let t = 0; t < 0.5; t += 1 / 60) w = wantsIt(w, gone, 1 / 60)
    expect(w.awake).toBe(true)
    w = wantsIt(w, back, 1 / 60)
    // ⚠️ and its patience is whole again, or a second glance away would finish what the first started
    expect(w.cross).toBeCloseTo(WILD.patience, 6)
  })

  it('can be outrun, which is what makes a pull a decision', () => {
    /**
     * ⚠️ MEASURED AGAINST THE PLAYER'S OWN TOP SPEED rather than against a number typed in here.
     * Running away has to work: the distance you must open up is `chase`, and at a walk that has
     * to take a handful of seconds, not half a minute.
     */
    const secondsToEscape = WILD.chase / (TUNE.speed / outBy(1))
    expect(secondsToEscape).toBeLessThan(8)
    expect(secondsToEscape).toBeGreaterThan(1)
  })
})

describe('standing about', () => {
  it('never wanders further from home than its leash', () => {
    const m = wildAt(0, home, 20, 3)
    for (let t = 0; t < 600; t += 0.37) {
      /* a hair of float slop: the claim is the leash, not the last bit of a double */
      expect(apart(restSpot(m, t), home)).toBeLessThanOrEqual(WILD.leash + 1e-9)
    }
  })

  it('does not stand still', () => {
    const m = wildAt(0, home, 20, 1)
    const seen = new Set<string>()
    for (let t = 0; t < 40; t += 1) {
      const s = restSpot(m, t)
      seen.add(`${s.x.toFixed(3)},${s.y.toFixed(3)}`)
    }
    expect(seen.size).toBeGreaterThan(20)
  })

  it('gives a crowd at one spot different phases, so they do not drift as one body', () => {
    const a = restSpot(wildAt(0, home, 20, 0), 5)
    const b = restSpot(wildAt(0, home, 20, 1), 5)
    expect(apart(a, b)).toBeGreaterThan(0.5)
  })

  it('wakes for you before it strays far enough to be a different fight', () => {
    /* ⚠️ notice < chase, or a creature wakes, hits its range and gives up on a loop */
    expect(WILD.notice).toBeLessThan(WILD.chase)
    expect(WILD.leash).toBeLessThan(WILD.notice)
  })
})
