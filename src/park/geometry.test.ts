import { describe, expect, it } from 'vitest'
import { ASPECT, across, down, downBy, outBy, PARK_TALL, stepFrom } from './strike'
import { PARK, VIEW } from './walk'
import { PET_TALL } from '../pets/play'
import { MAP_GUIDE } from './mapOf'

/**
 * The park's units, and the one factor that keeps going missing.
 *
 * ⚠️ THIS IS THE BUG CLASS THE REPOSITORY HAS ALREADY PAID FOR THREE TIMES. `across` and
 * `down` take SCREEN-heights while nearly everything else in the game is written in PET-heights,
 * so the correct call was always `across(v * PARK_TALL)` — and the factor went missing in a
 * dodge that crossed most of the field, and in a boss's mark and wave landing past the edge of
 * the world so that two of its three big attacks could never hit anybody. `outBy` and `downBy`
 * exist because a name with the unit in it has nowhere to put a wrong factor. These are the
 * tests that say so out loud.
 *
 * ⚠️ AND NOT ONE OF THEM RESTATES THE IMPLEMENTATION. CLAUDE.md's rule is that a test built
 * from the same sum as the code confirms the mistake — the boss's wave was once "verified"
 * landing in the right place because the check divided by the same wrong thing that placed it.
 * So every expectation below is written from the world's own SHAPE: how many screenfuls it is,
 * how tall a creature is on screen, and the fact that a distance is the same distance whichever
 * way you walk it.
 */

/** how wide the whole world is, in screen-HEIGHTS — the one unit that is the same both ways */
const WORLD_WIDE = PARK.across * ASPECT
/** and how tall, in the same unit */
const WORLD_TALL = PARK.down

/** close enough for floating point, far too close to hide a missing factor of 5.68 */
const near = (a: number, b: number, why: string) =>
  expect(Math.abs(a - b), `${why}: ${a} vs ${b}`).toBeLessThan(1e-9)

describe('a pet-height is the same distance whichever way you walk it', () => {
  /**
   * ⚠️ THE TEST THAT CATCHES A MISSING PARK_TALL IN EITHER DIRECTION. outBy gives a fraction
   * of the world's WIDTH and downBy a fraction of its HEIGHT — two different denominators for
   * one physical distance. Converting both back into screen-heights has to give the same
   * number, and it cannot unless both applied the same creature-height.
   */
  it('outBy and downBy describe one distance in two denominators', () => {
    for (const n of [0.25, 1, 2.5, 7]) {
      near(outBy(n) * WORLD_WIDE, downBy(n) * WORLD_TALL, `${n} pet-heights`)
    }
  })

  it('and that distance is n creatures, measured against a creature on screen', () => {
    /* a creature stands PARK_TALL of a screen-height — this is the definition, not a sum
       copied out of across() */
    near(outBy(1) * WORLD_WIDE, PARK_TALL, 'one creature across')
    near(downBy(1) * WORLD_TALL, PARK_TALL, 'one creature down')
    near(outBy(3) * WORLD_WIDE, 3 * PARK_TALL, 'three creatures across')
  })

  it('a park creature is smaller than a playground one, by the factor that says so', () => {
    /* PARK_TALL is PET_TALL scaled down; if that ever silently becomes PET_TALL the whole
       park gets 2.3x bigger and every reach in the fight is wrong at once */
    expect(PARK_TALL).toBeLessThan(PET_TALL)
    near(PARK_TALL / PET_TALL, 0.44, 'park scale')
  })
})

describe('the screen-height converters', () => {
  it('turn one screenful into one screenful', () => {
    /* across() takes screen-HEIGHTS, so a full screen WIDTH is ASPECT of them */
    near(across(ASPECT), VIEW.w, 'a screen width')
    near(down(1), VIEW.h, 'a screen height')
  })

  it('are linear, so twice as far is twice the number', () => {
    near(across(2), 2 * across(1), 'across')
    near(down(2), 2 * down(1), 'down')
  })
})

describe('stepFrom walks in the direction it is pointed', () => {
  const from = { x: 0.5, y: 0.5 }

  it('straight right moves only in x, by outBy', () => {
    const to = stepFrom(from, { x: 1, y: 0 }, 2)
    near(to.x - from.x, outBy(2), 'x')
    near(to.y - from.y, 0, 'y')
  })

  it('straight down moves only in y, by downBy', () => {
    const to = stepFrom(from, { x: 0, y: 1 }, 2)
    near(to.x - from.x, 0, 'x')
    near(to.y - from.y, downBy(2), 'y')
  })

  /**
   * ⚠️ A DIAGONAL IS ONLY A DIAGONAL ON SCREEN, which is the note strike.ts carries and the
   * reason every piece of geometry with an angle in it happens in screen-heights. An aim of
   * (0.6, 0.8) is a unit vector, so the distance travelled has to be the full 2 pet-heights
   * once both axes are put back into the same unit — in world units alone it is not.
   */
  it('and a diagonal covers the same ground as a straight line', () => {
    const aim = { x: 0.6, y: 0.8 }
    const to = stepFrom(from, aim, 2)
    const wide = (to.x - from.x) * WORLD_WIDE
    const tall = (to.y - from.y) * WORLD_TALL
    near(Math.hypot(wide, tall), 2 * PARK_TALL, 'two creatures, diagonally')
  })
})

describe('the map maker draws on the world', () => {
  /**
   * ⚠️ THE FIELD WAS SQUARE AND THE WORLD IS NOT. Three screens by three is square in
   * SCREENFULS and 16:10 in pixels, so every stamp was drawn four fifths as tall as it really
   * is until MAP_GUIDE.paper existed. A square paper would make this 1.
   */
  it('on paper the shape of the world, not the shape of the screenful count', () => {
    near(MAP_GUIDE.paper, WORLD_WIDE / WORLD_TALL, 'paper aspect')
    expect(MAP_GUIDE.paper).toBeGreaterThan(1.1)
  })

  it('and its grid is the screens the park actually has', () => {
    expect(MAP_GUIDE.cols).toBe(PARK.across)
    expect(MAP_GUIDE.rows).toBe(PARK.down)
  })

  /**
   * ⚠️ THE GUIDE'S REFERENCE RING IS ROUND ONLY IF ITS TWO FRACTIONS AGREE. onPaper returns a
   * width as a fraction of one side and a height as a fraction of the other; put back into one
   * unit they must be the same distance, or the thing the map maker measures against is an egg.
   */
  it('and the creature it shows you is as wide as it is tall', () => {
    const { creature, place } = MAP_GUIDE
    near(creature.w * WORLD_WIDE, creature.h * WORLD_TALL, 'reference creature')
    near(place.w * WORLD_WIDE, place.h * WORLD_TALL, 'reference place')
  })

  it('and that creature is one creature', () => {
    near(MAP_GUIDE.creature.h * WORLD_TALL, PARK_TALL, 'one creature tall')
  })
})
