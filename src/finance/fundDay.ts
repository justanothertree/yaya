/**
 * What day it is, for the fund.
 *
 * ⚠️ A DOLLAR A DAY IS SOMEBODY'S DAY, NOT UTC'S. Every day count in this module used
 * `toISOString()`, which is UTC — so from 8pm Eastern onwards the fund believed tomorrow had
 * already started. Four accounts at $1/day meant the promise jumped $4 every evening and the
 * chart's last point was labelled with a date the reader had not lived through yet: "prices
 * through Mon, Sep 21" at nine o'clock on Sunday night.
 *
 * ⚠️ AND IT WAS UTC ON PURPOSE, WHICH IS WHY THIS IS A ZONE AND NOT A `getDate()`. The note on
 * daysOnPlan records what happened when the two halves disagreed: the card counted local days
 * and the chart counted UTC ones, and with 33 accounts that is $33 between two figures on the
 * same screen for no reason a reader could ever find. Making the client local again would put
 * that straight back, because the server counts in UTC too. So both sides move together, onto
 * one named zone.
 *
 * ⚠️ ONE ZONE FOR EVERYBODY, not the viewer's own. The fund is one family's, and Mom's
 * "promised to date" has to read the same whether Mom is at home or Ava is looking at it from
 * another country. A per-viewer calendar would mean two people seeing different numbers for the
 * same account on the same afternoon, which is worse than being a few hours out.
 *
 * ⚠️ THE SERVER HAS THE SAME FUNCTION, and it has to stay that way: `finance.fund_today()`
 * returns `(now() at time zone 'America/New_York')::date`. See
 * docs/2026-09-20-one-day-for-the-fund.sql.
 */

/** The family's calendar. Changing this changes what "a day" means on both sides — see above. */
export const FUND_ZONE = 'America/New_York'

/**
 * The fund's calendar date at a given instant, as `YYYY-MM-DD`.
 *
 * ⚠️ `en-CA` IS THE POINT, not a stray locale. It is the one widely-supported locale whose
 * short date IS ISO order, so this needs no manual padding and no second format to get wrong.
 */
export function fundToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUND_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
