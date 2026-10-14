/**
 * What a day came to, as the four numbers worth putting at the top of a rail.
 *
 * ⚠️ IT TAKES THE SMALLEST SHAPE IT CAN, `{cat, mins}`, rather than the `Total` rows it will
 * actually be handed. `Total` lives in cloud.ts, cloud.ts imports record.ts, and a scoring module
 * that imported cloud.ts would close that ring — so it asks for the two fields it reads and stays
 * a thing a test can call with a literal.
 */

/** the three categories, as every row of a total already carries them */
export type Counted = { cat: 'locked' | 'free' | 'life'; mins: number }

export type Score = {
  /** every minute written down today */
  logged: number
  /** the Locked In ones */
  focused: number
  /** focused as a share of logged, 0–100 */
  share: number
  /** logged as a share of a whole day, 0–100 */
  covered: number
}

/** a day, in minutes — the denominator for "how much of it is written down" */
export const DAY_MINS = 24 * 60

/**
 * ⚠️ ZERO RATHER THAN NaN ON AN EMPTY DAY, which is the whole reason this is a function and not an
 * expression in the JSX. `focused / logged` on a day nothing has been recorded in is 0/0, and
 * `NaN%` on the first screen a new member sees is worse than any number could be.
 *
 * ⚠️ AND `covered` IS CLAMPED for the reason the week grid's is: two sessions may overlap, because
 * the table has never forbidden recording a call during a work block, so an unclamped day can read
 * "137% written down" — a number that looks like a fault rather than a full day.
 */
export function scoreOf(rows: readonly Counted[]): Score {
  let logged = 0
  let focused = 0
  for (const r of rows) {
    if (!(r.mins > 0)) continue
    logged += r.mins
    if (r.cat === 'locked') focused += r.mins
  }
  return {
    logged,
    focused,
    share: logged > 0 ? (focused / logged) * 100 : 0,
    covered: Math.min(100, (logged / DAY_MINS) * 100),
  }
}
