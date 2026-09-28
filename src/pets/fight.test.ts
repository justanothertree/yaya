import { describe, expect, it } from 'vitest'
import {
  DECK,
  freshFighter,
  IDLE,
  isOut,
  launchOf,
  MAX_CATCHUP,
  OUT,
  respawn,
  SPAWN,
  STOCKS,
  stepFight,
  winnerOf,
  type Fighter,
} from './fight'
import { PLAIN } from './play'
/* ⚠️ Vite's ?raw rather than node:fs, so this stays a browser-typed test — pulling in
   @types/node for one file read would let `process` type-check throughout the app. */
import fightSrc from './fight.ts?raw'
import attackSrc from './attack.ts?raw'
import playSrc from './play.ts?raw'
import type { Attack } from './attack'
import { flung, KNOCK, restingStriker } from '../park/strike'
import { restingWalker } from '../park/walk'

/**
 * A fight between the things you drew.
 *
 * ⚠️ THIS IS THE ONE SIMULATION THAT HAS TO AGREE WITH SOMEBODY ELSE'S MACHINE, and its own
 * comments say how: "state' = f(state, inputs) AND NOTHING ELSE. No clock, no random, no reading
 * anything outside its arguments", and "the simulation uses only max, min, abs, floor and sign —
 * CHECKED, NOT ASSUMED. Those are exactly specified on IEEE 754 doubles, so they give the same
 * bits in every engine."
 *
 * Both of those were claims. A desync is the worst bug shape this codebase can have, because
 * nothing is wrong on either screen — each player watches a coherent fight and they are not the
 * same fight, and the first anybody knows is an argument about who won.
 */

const attack = (over: Partial<Attack> = {}): Attack => ({ shove: 0.1, ...over }) as Attack

const two = (): Fighter[] => [freshFighter(0), freshFighter(1)]
const noMoves: Attack[][] = [[], []]
const traits = [PLAIN, PLAIN]
const wides = [0.1, 0.1]

describe('the fight agrees with itself', () => {
  /**
   * ⚠️ THE SAME STATE AND THE SAME INPUTS GIVE THE SAME BITS. Not "close" — identical, because
   * a shared fight is two machines running this and comparing nothing. Any drift at all
   * compounds over a round.
   */
  it('and stepping twice from one state lands in exactly one place', () => {
    const start = two()
    const inputs = [
      { ...IDLE, right: true, quick: true },
      { ...IDLE, left: true, jump: true },
    ]
    let a = start
    let b = start
    for (let i = 0; i < 200; i++) {
      a = stepFight(a, inputs, noMoves, traits, wides)
      b = stepFight(b, inputs, noMoves, traits, wides)
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('and reads no clock, so it runs the same however long it takes', () => {
    const inputs = [{ ...IDLE, right: true }, IDLE]
    const once = stepFight(two(), inputs, noMoves, traits, wides)
    /* burn some wall-clock between the two runs; a step that peeked at a clock would diverge */
    const until = Date.now() + 30
    while (Date.now() < until) {
      /* deliberately idle */
    }
    expect(JSON.stringify(stepFight(two(), inputs, noMoves, traits, wides))).toBe(
      JSON.stringify(once),
    )
  })

  /**
   * ⚠️ AND THE ARITHMETIC IS THE KIND EVERY ENGINE SPELLS THE SAME. Math.sin, cos, exp, pow and
   * sqrt are NOT bit-identical across implementations — the spec allows an implementation-defined
   * approximation — so one of them anywhere in the fight path is a desync waiting for two players
   * on different browsers. max, min, abs, floor and sign are exactly specified.
   *
   * This is a source check because there is no other way to ask it: a function that is
   * deterministic on THIS engine is exactly what a cross-engine desync looks like from here.
   * walk.ts uses hypot and exp on purpose and is not in this list — the park does not have to
   * agree with anybody.
   */
  it('and never asks for a number an engine is allowed to round its own way', () => {
    const loose = /Math\.(sin|cos|tan|asin|acos|atan2?|exp|log2?|pow|sqrt|cbrt|hypot|random)\b/
    const sources = { 'fight.ts': fightSrc, 'attack.ts': attackSrc, 'play.ts': playSrc }
    for (const [file, text] of Object.entries(sources)) {
      const found = text
        .split('\n')
        .map((line: string, i: number) => ({ line: line.trim(), n: i + 1 }))
        .filter(
          ({ line }: { line: string }) =>
            loose.test(line) && !line.startsWith('*') && !line.startsWith('//'),
        )
      expect(found, `${file} reaches for maths two engines may spell differently`).toEqual([])
    }
  })

  /**
   * ⚠️ A BACKGROUNDED TAB HANDS YOU SECONDS AT ONCE, and a fixed step turns that into hundreds
   * of frames in one go — which locks the page up and, in a shared fight, fast-forwards one
   * player through a round the other watched at normal speed. "The clock is allowed to be
   * behind, the simulation is not allowed to lie."
   */
  it('and never runs more than a handful of frames to catch up', () => {
    expect(MAX_CATCHUP).toBeGreaterThan(0)
    expect(MAX_CATCHUP, 'a tab asleep for a minute must not run 3600 frames').toBeLessThanOrEqual(
      10,
    )
  })
})

describe('where the fight stops being the fight', () => {
  it('is off the sides, over the top, or down the pit', () => {
    const f = freshFighter(0)
    expect(isOut(f), 'a fighter on the deck is in the fight').toBe(false)
    expect(isOut({ ...f, x: -OUT.side - 0.01 })).toBe(true)
    expect(isOut({ ...f, x: 1 + OUT.side + 0.01 })).toBe(true)
    expect(isOut({ ...f, y: OUT.sky - 0.01 })).toBe(true)
    expect(isOut({ ...f, y: OUT.pit + 0.01 })).toBe(true)
  })

  /**
   * ⚠️ YOU DIE DOWNWARDS BEFORE YOU DIE UPWARDS, which is the shape of the whole genre: the
   * pit is the ordinary way a round ends and the ceiling is the rare one. Its own note says the
   * sky is "far enough up that a fresh fighter cannot be killed off the top".
   *
   * ⚠️ THE FIRST VERSION OF THIS WAS CALLED "kinder sideways than downwards" AND COMPARED THE
   * CEILING TO THE PIT — a name that described one thing and arithmetic that measured another.
   * It also could not be broken in the direction that mattered: moving the pit CLOSER made the
   * claim more true, so the probe passed and told me nothing. Measured properly, from the deck:
   * 1.65 above against 0.80 below.
   */
  it('and the ceiling is twice the pit away from the deck', () => {
    const roomBelow = OUT.pit - DECK.y
    const roomAbove = DECK.y - OUT.sky
    expect(roomBelow, 'the pit is the ordinary way out').toBeGreaterThan(0)
    expect(roomAbove, 'and the ceiling is the rare one').toBeGreaterThan(roomBelow * 1.5)
  })

  /**
   * ⚠️ A FRESH FIGHTER CANNOT BE KILLED OFF THE TOP — its own note says "checked, rather than
   * assumed; at zero damage no attack in the game launches anywhere near it". Being killed at 0%
   * by one hit is the thing that makes a fighting game feel arbitrary.
   */
  it('and nobody dies off the top at nothing per cent', () => {
    const hardest = attack({ shove: 0.5 })
    const atNothing = launchOf(hardest, 0)
    const roomAbove = DECK.y - OUT.sky
    expect(
      atNothing,
      'the hardest hit in the game still leaves the ceiling out of reach',
    ).toBeLessThan(roomAbove)
  })

  /**
   * ⚠️ AND A SPAWN IS FURTHER FROM THE EDGE THAN THE WEAKEST HIT CARRIES. Watched in a real
   * round when it was not: "a kick at 0% damage — the weakest exchange the game has — carries
   * 0.16 of the stage, which was exactly the distance from a spawn to the drop, so a player who
   * had done nothing wrong was over the edge on the first thing that touched them and lost three
   * lives in ten seconds at 7%."
   *
   * The margin today is one hundredth of the stage, which is thin. This is what notices if a
   * spawn or the deck moves again.
   */
  it('and no spawn is one weak hit from the drop', () => {
    const weakest = 0.16
    for (const x of SPAWN) {
      const toEdge = Math.min(x - DECK.x, DECK.x + DECK.w - x)
      expect(toEdge, `the spawn at ${x} is ${toEdge.toFixed(3)} from the drop`).toBeGreaterThan(
        weakest,
      )
    }
  })
})

describe('how hard a hit throws you', () => {
  it('starts below its own baseline and grows with the damage', () => {
    const a = attack({ shove: 1 })
    expect(launchOf(a, 0), 'a fresh fighter is hard to move').toBeLessThan(1)
    expect(launchOf(a, 100)).toBeGreaterThan(launchOf(a, 0))
    expect(launchOf(a, 200)).toBeGreaterThan(launchOf(a, 100))
  })

  /** ⚠️ no ceiling, because "the launch growing without limit is how a scrap is won" */
  it('and never stops growing', () => {
    const a = attack({ shove: 1 })
    expect(launchOf(a, 999)).toBeGreaterThan(launchOf(a, 500))
  })

  /**
   * ⚠️ AND IT IS NOT THE PARK'S, DELIBERATELY. The park's KNOCK "runs 1 to 1.85 and stops,
   * because the park has a pool that fills, no edge to fall off, and going down is a setback."
   * Same idea, two jobs, and its own note says neither should be quietly merged into the other.
   * This is what notices if somebody tries.
   */
  it('and is a different curve from the park, which has no edge to fall off', () => {
    const a = attack({ shove: 1 })
    const battered = { ...restingStriker(restingWalker(0.5, 0.5)), hurt: 99999 }
    /* the park's multiplier saturates at 1 + KNOCK and stays there, however battered you are */
    expect(flung(battered)).toBeCloseTo(1 + KNOCK, 10)
    /* the scrap's is the same idea with no ceiling, because here there is an edge to go over */
    expect(launchOf(a, 99999) / a.shove, 'the scrap does not stop').toBeGreaterThan(1 + KNOCK)
  })
})

describe('stocks and who is left', () => {
  it('says nobody has won while more than one is standing', () => {
    expect(winnerOf(two())).toBeNull()
  })

  it('and names the one that is', () => {
    const [a, b] = two()
    expect(winnerOf([a, { ...b, stocks: 0 }])).toBe(0)
    expect(winnerOf([{ ...a, stocks: 0 }, b])).toBe(1)
  })

  it('and says so when nobody is', () => {
    const [a, b] = two()
    expect(
      winnerOf([
        { ...a, stocks: 0 },
        { ...b, stocks: 0 },
      ]),
      'a double ring-out',
    ).toBe(-1)
  })

  it('and a round is mostly frames where nobody fell off anything', () => {
    expect(respawn(two()), 'nothing to do is null, not a copy').toBeNull()
  })

  it('and somebody who fell comes back one life lighter', () => {
    const [a, b] = two()
    const fell = { ...a, y: OUT.pit + 0.1 }
    const back = respawn([fell, b])!
    expect(back[0].stocks).toBe(STOCKS - 1)
    expect(isOut(back[0]), 'and is back in the fight').toBe(false)
    expect(back[1], 'and nobody else is disturbed').toBe(b)
  })

  /**
   * ⚠️ THE LAST STOCK DOES NOT RESPAWN. "A fighter on zero is left where it is and stops being
   * stepped, rather than reappearing to be knocked off again by somebody who has already won."
   */
  it('and the last life is the last life', () => {
    const [a, b] = two()
    const done = { ...a, stocks: 1, y: OUT.pit + 0.1 }
    const back = respawn([done, b])!
    expect(back[0].stocks).toBe(0)
    expect(isOut(back[0]), 'it is left where it fell').toBe(true)
    expect(winnerOf(back)).toBe(1)
  })
})
