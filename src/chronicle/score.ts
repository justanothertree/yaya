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
  /**
   * Focused as a share of logged, 0–100 — or **null when there is under a minute to take a share
   * of**.
   *
   * ⚠️ A PROPORTION OF NOTHING IS A CLAIM OUT OF NOISE. Two seconds after pressing Start the rail
   * read "100% Locked In" directly above "Focused 0s" and "Written down 0s" — four statements that
   * contradict each other on their face, and the kind of thing that makes a reader stop trusting
   * every other number beside it. The arithmetic was right; 2s of Locked In is 100% of 2s.
   *
   * ⚠️ A MINUTE, BECAUSE THAT IS THE ROOM'S UNIT. Targets, totals, goals and estimates are all
   * minutes, so "under a minute recorded" is honestly "nothing yet" in the only unit this room
   * speaks. It also covers the other end of the same problem: a day with activities and nothing
   * recorded would otherwise headline "0% Locked In", which is equally a verdict on an empty day.
   */
  share: number | null
  /**
   * How much of the day has any session on it, 0–100.
   *
   * ⚠️ IT IS HANDED IN RATHER THAN WORKED OUT HERE, and that is the shape of the bug it fixes.
   * This was `Math.min(100, (logged / DAY_MINS) * 100)` — the sum of the minutes over a constant
   * — and a sum is the wrong question twice over. Sessions may overlap, so the numerator
   * double-counted every minute two of them shared; and a day is not always 1440 minutes, so on a
   * spring-forward day the denominator was wrong too (New York, 2026-03-08: **1380**). The right
   * answer is a union over the window's own width, which `coveredPct` in record.ts computes — and
   * it needs the SPANS, which a `{cat, mins}` row does not carry. So the caller measures it.
   *
   * ⚠️ A REQUIRED PARAMETER, not an optional one with a fallback to the old sum. A default here
   * would be a second answer to the same question, silently taken by whichever caller forgot.
   */
  covered: number
}

/**
 * ⚠️ NULL RATHER THAN NaN ON AN EMPTY DAY, which is the whole reason this is a function and not an
 * expression in the JSX. `focused / logged` on a day nothing has been recorded in is 0/0, and
 * `NaN%` on the first screen a new member sees is worse than any number could be. It is null and
 * not 0 for the reason on `share` above: zero is a verdict, and an empty day has not earned one.
 *
 * ⚠️ AND `covered` IS CARRIED, NOT COMPUTED — see the field's own note above. Everything else
 * here is a sum and is right as one: "Written down 9h" on a day covering eight hours is honest,
 * because that is how much attention the day took. Only the figure with "of the day" after it has
 * to be a union.
 */
export function scoreOf(rows: readonly Counted[], covered: number): Score {
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
    share: logged >= 1 ? (focused / logged) * 100 : null,
    covered,
  }
}
