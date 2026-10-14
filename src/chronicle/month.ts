import { windowOf } from './goal'
import { dayBounds, lane, type Span } from './record'

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
 * ⚠️ `lane` AGAIN, for the third time — the day strip, the week grid and now this. All three ask
 * "how much of this window does this span cover", and the one that gets it wrong at midnight gets
 * it wrong everywhere. Three callers of one tested function beats three copies of one subtraction.
 */
export function monthCells(
  days: Array<{ on: string; day: number; inMonth: boolean }>,
  spans: Array<Span & { activity: string }>,
  nowMs: number,
): Cell[] {
  return days.map((d) => {
    const { fromMs, toMs } = dayBounds(d.on)
    const blocks = lane(spans, fromMs, toMs, nowMs)
    return {
      ...d,
      covered: Math.min(
        100,
        blocks.reduce((n, b) => n + b.width, 0),
      ),
    }
  })
}
