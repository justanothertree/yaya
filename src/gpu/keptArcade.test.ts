import { describe, expect, it } from 'vitest'
import { readSaved as readMobius, HOLES, SPACES } from './mobius'
import { readSaved as readPinball, DEFAULT_TABLE } from './pinball'
import { readSaved as readCrossing, COURSES } from './crossing'

/* What Möbius golf, Pinball workshop and Night crossing keep, read the way each toy reads it. The
   parsers lived inside the components until the share card needed them (src/lab/shares/arcade.ts)
   and moved here unchanged; these pin what they always did. */
describe('what the three arcade toys keep', () => {
  it('möbius golf round-trips its hole and fewest strokes per hole with the space played in', () => {
    const space = Object.keys(SPACES)[1] as keyof typeof SPACES
    const s = { hole: HOLES.length - 1, best: { [HOLES[2].name]: { strokes: 3, space } } }
    expect(readMobius(JSON.stringify(s))).toEqual(s)
    expect(
      readMobius(
        JSON.stringify({
          hole: 99,
          best: { [HOLES[0].name]: { strokes: 2.5, space }, nope: { strokes: 1, space } },
        }),
      ),
    ).toEqual({ hole: 0, best: {} })
    expect(readMobius('{')).toEqual({ hole: 0, best: {} })
  })
  it('pinball round-trips its best per table and falls back to the default table', () => {
    const back = readPinball(
      JSON.stringify({ table: null, best: { 'My table': 12340, Bumpers: 0, bad: -4, frac: 1.5 } }),
    )
    expect(back.best).toEqual({ 'My table': 12340, Bumpers: 0 })
    expect(back.table).toEqual(DEFAULT_TABLE)
    expect(readPinball(null)).toEqual({ table: DEFAULT_TABLE, best: {} })
  })
  it('night crossing round-trips its course and fastest time per course', () => {
    const s = {
      course: COURSES.length - 1,
      best: { [COURSES[1].name]: 41.5, [COURSES[0].name]: 12 },
    }
    expect(readCrossing(JSON.stringify(s))).toEqual(s)
    expect(readCrossing(JSON.stringify({ course: -1, best: { [COURSES[0].name]: 0 } }))).toEqual({
      course: 0,
      best: {},
    })
  })
})
