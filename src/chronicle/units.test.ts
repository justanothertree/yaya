import { describe, expect, it } from 'vitest'
import { fit, fitText, unitOf, UNIT_WORDS } from './units'
import draft from '../../docs/2026-11-09-chronicle-sets-links.DRAFT.sql?raw'

/**
 * ⚠️ THE TWO TABLES ARE ONE TABLE, AND THIS IS WHAT MAKES THEM SO. The server decides whether a
 * link may be made and whether it still counts; the room decides which exercises to offer. If the
 * two disagreed, the room would offer a link the server refuses, or hide one it would take. So the
 * SQL's `when 'word' then 'unit'` pairs are read out of the draft and compared, both ways.
 */
const sqlTable = (): Record<string, string> => {
  const body = draft.slice(draft.indexOf('create or replace function public.chronicle_unit'))
  const end = body.indexOf('$$;')
  const out: Record<string, string> = {}
  for (const m of body.slice(0, end).matchAll(/when '([^']+)' then '([^']+)'/g)) out[m[1]] = m[2]
  return out
}

describe('the unit table', () => {
  it('is the same table as chronicle_unit() in the draft, word for word', () => {
    const sql = sqlTable()
    expect(Object.keys(sql).length).toBeGreaterThan(20)
    expect(sql).toEqual({ ...UNIT_WORDS })
  })

  it('normalises case and spacing, and nothing else', () => {
    expect([unitOf(' Reps '), unitOf('MINUTES'), unitOf('kilometres'), unitOf('rep s')]).toEqual([
      'reps',
      'min',
      'km',
      null,
    ])
  })

  /* ⚠️ a word that is a property every object has must not come back as a unit */
  it('knows nothing of words that are only properties of every object', () => {
    expect(['constructor', 'toString', '__proto__', 'hasOwnProperty'].map(unitOf)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('maps "other", laps, pages, empty and missing to nothing', () => {
    expect(['other', 'laps', 'pages', '', null, undefined].map(unitOf)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('whether an exercise can count toward an activity', () => {
  it('fits only where both normalise and agree', () => {
    expect([fit('reps', 'Reps').ok, fit('min', 'minutes').ok, fit('sec', 'reps').ok]).toEqual([
      true,
      true,
      false,
    ])
  })

  /* ⚠️ "nothing matches nothing": two words the table does not know are not the same unit */
  it('never fits two units nobody can compare, even when they are spelled the same', () => {
    expect([fit('other', 'other').ok, fit('laps', 'laps').ok]).toEqual([false, false])
  })

  it('says which of three things is wrong, in the server words', () => {
    expect([
      fitText(fit('reps', null)),
      fitText(fit('other', 'Reps')),
      fitText(fit('', 'Reps')),
      fitText(fit('sec', 'Reps')),
      fitText(fit('reps', 'reps')),
    ]).toEqual([
      'that activity does not count anything',
      'those units cannot be compared (other and Reps)',
      'those units cannot be compared (none and Reps)',
      'they count different things (sec and Reps)',
      null,
    ])
  })
})
