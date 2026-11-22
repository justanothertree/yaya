import { describe, expect, it } from 'vitest'
import { LIMIT } from './limits'
import schema from '../../supabase/migrations/00000000000000_baseline.sql?raw'

/*
 * Each limit asked of the schema itself rather than typed in beside it: the baseline holds every
 * one of these CHECK constraints, and a number here that disagrees with the table is the box
 * letting through what the server refuses, or refusing what it would keep.
 */

/** the upper bound a named constraint puts on `char_length(…(column))` */
const ceilingOf = (constraint: string, column: string): number => {
  const line = schema.split('\n').find((l: string) => l.includes(`CONSTRAINT "${constraint}"`))
  expect(line, constraint).toBeDefined()
  const m = line!.match(
    new RegExp(String.raw`"char_length"\((?:"btrim"\()?"${column}"\)?\) <= (\d+)`),
  )
  expect(m, `${constraint} bounds ${column}`).not.toBeNull()
  return Number(m![1])
}

describe('the Chronicle boxes stop where the table does', () => {
  it('an activity name and a routine name', () => {
    expect(LIMIT.name).toBe(ceilingOf('chronicle_activities_name_check', 'name'))
    expect(LIMIT.name).toBe(ceilingOf('chronicle_routines_name_check', 'name'))
  })

  it("an activity's unit and a goal's unit", () => {
    expect(LIMIT.unit).toBe(ceilingOf('chronicle_activity_metric_short', 'metric'))
    expect(LIMIT.unit).toBe(ceilingOf('chronicle_goals_unit_check', 'unit'))
  })

  it("a goal's title and its note", () => {
    expect(LIMIT.goalTitle).toBe(ceilingOf('chronicle_goals_title_check', 'title'))
    expect(LIMIT.goalNote).toBe(ceilingOf('chronicle_goals_note_check', 'note'))
  })

  it('no number of minutes typed into a step can overflow an integer', () => {
    expect(Number('9'.repeat(LIMIT.stepMinsDigits))).toBeLessThan(2 ** 31)
    /* and a step of 600, the most the server keeps, still fits */
    expect(String(600).length).toBeLessThanOrEqual(LIMIT.stepMinsDigits)
  })
})
