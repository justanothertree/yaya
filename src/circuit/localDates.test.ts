import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { todayMonth } from './dates'

/**
 * `dates.ts` opens with a rule, and prose cannot be run.
 *
 * > IMPORTANT: do NOT use new Date().toISOString() for "today" — that's UTC, so in the evening
 * > (timezones behind UTC) it returns tomorrow's date, which then mismatches the local dates the
 * > user logs against.
 *
 * ⚠️ IT WAS BROKEN IN TWO PLACES AT ONCE, AND THEY AGREED WITH EACH OTHER. `voiceSession.ts`
 * filed this device's call usage under `new Date().toISOString().slice(0, 7)` and `UsagePanel`
 * read it back with the same expression — so the pair was CONSISTENT and both wrong, which is
 * why nothing on screen ever looked odd. For every timezone behind UTC the last evening of a
 * month is already the next month in UTC, so a call at 8pm on 30 November was filed under
 * December, and the panel that answers "am I about to be charged this month" answered about a
 * month the person is not in yet.
 *
 * Two agreeing call sites is the shape no amount of reading catches, so the rule is a test now.
 */

const MODULE_EXT = /\.(?:[cm]?[jt]sx?)$/

const tracked = () =>
  execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => MODULE_EXT.test(f))

/**
 * `toISOString()` sliced to a MONTH — the UTC spelling of "this month".
 *
 * ⚠️ MONTHS ONLY, AND THE DAY SLICE IS DELIBERATELY NOT HERE. The first version of this also
 * caught `.slice(0, 10)` and named FIFTEEN files, nearly all of them right: `finance/timeline.ts`
 * and `PortfolioChart` slice dates that ARE UTC because the server sent them that way, and the
 * rest are fixtures building a date from a fixed instant. A checker that cries wolf about a
 * room's whole toolbar is one nobody runs twice, so this asks the narrower question it can
 * answer cleanly. The day case is real but needs judging file by file, which is a different job.
 */
const UTC_MONTH_SLICE = /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*7\s*\)/

/**
 * Where a UTC slice is legitimate: this file (it quotes the pattern), and `dates.ts` itself has
 * none. Anything else naming a CALENDAR day or month for a person must go through `localISO`,
 * `todayISO` or `todayMonth`.
 *
 * ⚠️ A FILE IS ONLY EXCUSED BY BEING NAMED HERE, never by a comment near the line. An allow-list
 * somebody has to add to is the point: it makes the next one a decision rather than a habit.
 */
const ALLOWED = new Set(['src/circuit/localDates.test.ts'])

describe('a calendar day or month is the LOCAL one', () => {
  const files = tracked()

  it('has something to check, so a pass is about files rather than an empty list', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('src/circuit/dates.ts')
  })

  it('has no UTC month slice outside the allow-list', () => {
    const found = files
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => UTC_MONTH_SLICE.test(readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })

  it('catches the spelling that shipped, including its whitespace variants', () => {
    /* the fault this exists for, so a zero above is believable */
    for (const s of [
      'new Date().toISOString().slice(0, 7)',
      'new Date().toISOString().slice(0,7)',
      'new Date() .toISOString() . slice( 0 , 7 )',
    ])
      expect(UTC_MONTH_SLICE.test(s)).toBe(true)
  })

  it('does not flag a slice that is not a date', () => {
    /* the cry-wolf direction: slicing an id or a hash is nobody's calendar */
    for (const s of [
      'sha.slice(0, 7)',
      'id.slice(0, 10)',
      't.toISOString()',
      'd.toISOString().slice(0, 10)',
    ])
      expect(UTC_MONTH_SLICE.test(s)).toBe(false)
  })

  it('todayMonth is the local month, which is the whole point', () => {
    /* asked from the world's shape: whatever the clock says locally, that is the answer */
    const now = new Date()
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(todayMonth()).toBe(local)
  })
})
