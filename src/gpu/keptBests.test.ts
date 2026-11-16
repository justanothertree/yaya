import { describe, expect, it } from 'vitest'
import { readSaved as readFold, PUZZLES as FOLDS, COLOURS as FOLD_COLOURS } from './fold'
import { readSaved as readShadow, PUZZLES as BOXES } from './shadowbox'
import { readSaved as readTopple, PUZZLES as TOPPLES } from './topple'
import { readSaved as readSeedling, LEVELS as GARDENS } from './seedling'

/* What Fold, Shadow box, Topple and Seedling keep, read the way each toy reads it. The parsers lived
   inside the components until the share card needed them (src/lab/shares/puzzles.ts) and moved here
   unchanged; these pin what they always did. */
describe('what the four puzzles keep', () => {
  it('fold round-trips its puzzle, colour and fewest folds, and drops what no puzzle has', () => {
    const s = {
      puzzle: FOLDS.length - 1,
      colour: FOLD_COLOURS.length - 1,
      best: { [FOLDS[1].name]: 3, [FOLDS[0].name]: 5 },
    }
    expect(readFold(JSON.stringify(s))).toEqual(s)
    const odd = readFold(
      JSON.stringify({
        puzzle: 99,
        colour: -1,
        best: { [FOLDS[0].name]: 0, nope: 4, [FOLDS[1].name]: 2.5 },
      }),
    )
    expect(odd).toEqual({ puzzle: 0, colour: 0, best: {} })
    expect(readFold('not json')).toEqual({ puzzle: 0, best: {}, colour: 0 })
    expect(readFold(null)).toEqual({ puzzle: 0, best: {}, colour: 0 })
  })
  it('shadow box round-trips its puzzle and fewest blocks', () => {
    const s = { puzzle: BOXES.length - 1, best: { [BOXES[2].name]: 7 } }
    expect(readShadow(JSON.stringify(s))).toEqual(s)
    expect(readShadow(JSON.stringify({ puzzle: -2, best: { [BOXES[2].name]: -1 } }))).toEqual({
      puzzle: 0,
      best: {},
    })
    expect(readShadow('{')).toEqual({ puzzle: 0, best: {} })
  })
  it('topple round-trips its puzzle, fewest dominoes and free layout', () => {
    const free = { dominoes: [{ x: 1, z: 2, a: 0.5, c: 3 }], bells: [{ x: 4, z: 5 }], walls: [] }
    const s = { puzzle: TOPPLES.length - 1, best: { [TOPPLES[0].name]: 9 }, free }
    const back = readTopple(JSON.stringify(s))
    expect(back.puzzle).toBe(s.puzzle)
    expect(back.best).toEqual(s.best)
    expect(back.free).toEqual(free)
    expect(readTopple(JSON.stringify({ puzzle: 'x', best: [] }))).toEqual({
      puzzle: 0,
      best: {},
      free: { dominoes: [], bells: [], walls: [] },
    })
  })
  it('seedling round-trips its garden, fewest seeds and generations, and level', () => {
    const best = {
      [GARDENS[1].name]: { seeds: 4, gen: 31 },
      [GARDENS[0].name]: { seeds: 2, gen: 9 },
    }
    const back = readSeedling(JSON.stringify({ best, level: -1 }))
    expect(back.best).toEqual(best)
    expect(back.level).toBe(-1)
    const odd = readSeedling(JSON.stringify({ best: { a: { seeds: 1.5, gen: 2 } }, level: 999 }))
    expect(odd.best).toEqual({})
    expect(odd.level).toBe(0)
    expect(readSeedling(null).best).toEqual({})
  })
})
