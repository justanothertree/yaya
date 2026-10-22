import { windowOf } from './goal'
import { coveredMs, coveredPct, dayBounds, type Span } from './record'

/**
 * A month as the grid a calendar draws: whole weeks, Sunday first, with the days either side of
 * the month included so no row is ragged.
 *
 * ⚠️ IT ANSWERS A DIFFERENT QUESTION FROM THE WEEK GRID, which is why it is worth having beside
 * one rather than instead of it. The week shows WHEN inside a day — that the mornings are empty.
 * A month cannot: twenty-four hours in a cell an inch wide is four pixels an hour. What a month
 * shows is WHICH DAYS, and how much of each — the shape of a habit rather than the shape of a day.
 *
 * ⚠️ AND THE PADDING DAYS ARE REAL DAYS, not blanks. A month starting on a Wednesday has Sunday,
 * Monday and Tuesday of the week before in its first row, and those days have time in them — a
 * calendar that drew them empty would be lying about them to keep its own edges tidy. They are
 * marked `outside` so the room can dim them.
 */

export type Cell = {
  /** the local ISO date */
  on: string
  /** the day of the month, 1-31 */
  day: number
  /** false for the days either side that are only there to square off the weeks */
  inMonth: boolean
  /** how much of the day is accounted for, 0-100 */
  covered: number
  /**
   * The same thing in MINUTES, which is the unit the cell's own label speaks.
   *
   * ⚠️ IT IS CARRIED RATHER THAN RECONSTRUCTED FROM THE PERCENTAGE. The grid used to say
   * `Math.round((c.covered / 100) * 24 * 60)` — a round trip out of minutes into a share of a day
   * and back, through a hard-coded 1440. That was exact only while the denominator was also 1440;
   * `coveredPct` divides by the window's OWN width, and `dayBounds` is correctly 1380 minutes on
   * a spring-forward day, so the trip stopped closing twice a year. A label measured in minutes
   * should be handed minutes.
   */
  mins: number
}

const iso = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Every day the calendar shows for the month `on` falls in — always whole weeks, so the length is
 * 28, 35 or 42 and never anything else.
 */
export function monthOf(on: string): Array<{ on: string; day: number; inMonth: boolean }> {
  const win = windowOf('month', on)
  if (!win) return []
  const first = new Date(win.from + 'T12:00:00')
  const last = new Date(win.to + 'T12:00:00')
  last.setDate(last.getDate() - 1)

  /* back to the Sunday on or before the 1st, forward to the Saturday on or after the last */
  const start = new Date(first)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(last)
  end.setDate(end.getDate() + (6 - end.getDay()))

  const out: Array<{ on: string; day: number; inMonth: boolean }> = []
  const d = new Date(start)
  while (d <= end) {
    out.push({ on: iso(d), day: d.getDate(), inMonth: d.getMonth() === first.getMonth() })
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * Fill those days in from the record.
 *
 * ⚠️ IT ASKS `coveredPct`, WHICH IS A UNION — see the note on it in record.ts. This used to lay
 * the day out with `lane` and add the block widths up, which double-counts every minute two
 * sessions share: this grid turns the figure back into minutes ("1,020 min recorded" of a day that
 * held 480), so the inflation arrived as time nobody had lived. The day strip and the week grid
 * still use `lane`, because they draw the blocks; this one only ever needed the total.
 */
export function monthCells(
  days: Array<{ on: string; day: number; inMonth: boolean }>,
  spans: Array<Span & { activity: string }>,
  nowMs: number,
): Cell[] {
  return days.map((d) => {
    const { fromMs, toMs } = dayBounds(d.on)
    return {
      ...d,
      covered: coveredPct(spans, fromMs, toMs, nowMs),
      mins: coveredMs(spans, fromMs, toMs, nowMs) / 60_000,
    }
  })
}
