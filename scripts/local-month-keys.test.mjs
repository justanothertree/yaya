import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `src/circuit/dates.ts` opens with a rule, and prose cannot be run.
 *
 * > IMPORTANT: do NOT use new Date().toISOString() for "today" — that's UTC, so in the evening
 * > (timezones behind UTC) it returns tomorrow's date, which then mismatches the local dates the
 * > user logs against.
 *
 * ⚠️ IT WAS BROKEN IN TWO PLACES AT ONCE, AND THEY AGREED WITH EACH OTHER. `voiceSession.ts`
 * filed this device's call usage under `new Date().toISOString().slice(0, 7)` and `UsagePanel`
 * read it back with the same expression — so the pair was CONSISTENT and both wrong, which is
 * why nothing on screen ever looked odd. For every timezone behind UTC the last evening of a
 * month is already the next month there, so a call at 8pm on 30 November was filed under
 * December, and the panel that answers "am I about to be charged this month" answered about a
 * month the person is not in yet. Two agreeing call sites is the shape no amount of reading
 * catches.
 *
 * ⚠️ IT LIVES IN `scripts/`, NOT `src/`, AND THAT IS NOT A PREFERENCE. It walks the repository,
 * so it needs `node:fs` and `node:child_process` — and `src/` is compiled by the BROWSER
 * tsconfig, which has no Node types. Put here first, it failed CI with `Cannot find module
 * 'node:fs'` while `npm run typecheck` had passed locally, because `tsc -b` is incremental and
 * reused a cached build. `scripts/*.test.mjs` is where `migration-md5` and `case-collisions`
 * already live, and eslint gives that directory Node globals on purpose.
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
 * ⚠️ MONTHS ONLY, AND THE DAY SLICE IS DELIBERATELY NOT HERE. The first version also caught
 * `.slice(0, 10)` and named FIFTEEN files, nearly all of them right: `finance/timeline.ts` and
 * `PortfolioChart` slice dates that ARE UTC because the server sent them that way, and the rest
 * are fixtures building a date from a fixed instant. A checker that cries wolf about a room's
 * whole toolbar is one nobody runs twice, so this asks the narrower question it can answer
 * cleanly. The day case is real but wants judging file by file, which is a different job.
 */
const UTC_MONTH_SLICE = /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*7\s*\)/

/**
 * Excused only by being named here — never by a comment near the line. An allow-list somebody
 * has to add to is the point: it makes the next one a decision rather than a habit.
 *
 * `dates.test.ts` is on it because it DEMONSTRATES the trap — it asserts that at 20:00 on
 * 30 November the UTC slice reads `2026-12` while the local one reads `2026-11`. Quoting the
 * wrong spelling in order to prove it is wrong is the one honest reason to carry it.
 */
const ALLOWED = new Set(['src/circuit/dates.test.ts'])

describe('a calendar month is the LOCAL one', () => {
  const files = tracked()

  it('has something to check, so a pass is about files rather than an empty list', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('src/circuit/dates.ts')
  })

  it('has no UTC month slice in src', () => {
    const found = files
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => UTC_MONTH_SLICE.test(readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })

  it('catches the spelling that shipped, including its whitespace variants', () => {
    for (const s of [
      'new Date().toISOString().slice(0, 7)',
      'new Date().toISOString().slice(0,7)',
      'new Date() .toISOString() . slice( 0 , 7 )',
    ])
      expect(UTC_MONTH_SLICE.test(s)).toBe(true)
  })

  it('does not flag a slice that is not a month', () => {
    /* the cry-wolf direction: an id, a hash, or the UTC DAY slice that is often correct */
    for (const s of [
      'sha.slice(0, 7)',
      'id.slice(0, 10)',
      't.toISOString()',
      'd.toISOString().slice(0, 10)',
    ])
      expect(UTC_MONTH_SLICE.test(s)).toBe(false)
  })
})
