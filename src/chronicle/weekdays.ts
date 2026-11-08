import { localMidnight } from './record'

/**
 * Selected-weekday recurrence for a repeating day goal: "swim on Tuesdays", "floss every day but
 * Sunday". It is the logic half of docs/2026-11-08-chronicle-weekdays.DRAFT.sql, and the one rule
 * Evan set for it — a schedule change affects FUTURE occurrences, never the completion history
 * already recorded — is a property of this arithmetic rather than of the table.
 *
 * ⚠️ THE TABLE IS A DRAFT, NOT APPLIED TO PRODUCTION. Until it is, the goals reader sends no
 * `days`, every goal reads as every day, and nothing here changes what anybody sees. How a day's
 * verdict is drawn — and the rule that a met day stays met whatever the schedule says (§16f) — is
 * `rowOf` in goal.ts, beside the record-only `marksOf` it is built on.
 */

/**
 * The weekdays a goal is for, as seven bits: bit 0 is Sunday, bit 6 Saturday.
 *
 * ⚠️ SUNDAY IS ZERO BECAUSE `Date.getDay()` SAYS SO, and so does this project's week, which starts
 * on Sunday in week.ts and in the Circuit's feed. A mask counted from Monday would be the one
 * place in the codebase where day 0 meant something else, and the bug it would make is an
 * off-by-one that only shows on the day it is wrong.
 */
export type DayMask = number

export const EVERY_DAY: DayMask = 0b111_1111

/**
 * A goal's schedule over time: each entry says which days it was for, starting on `from`.
 *
 * ⚠️ A HISTORY, NOT A VALUE, AND THAT IS THE WHOLE OF EVAN'S RULE. One mask on the goal can only
 * say what the schedule IS; judging last month needs what it WAS. With a single column, changing
 * "every day" to "Tuesdays" would re-judge every closed day of the past month under the new rule
 * — un-missing the Mondays, re-missing nothing — and the streak somebody had been keeping would
 * change under them without a word. So a change appends an entry, and every day is judged by the
 * entry in force on that day.
 *
 * No entries means every day — exactly what a repeating day goal means today, so a goal nobody
 * has given a schedule behaves as it always has.
 */
export type Schedule = readonly { from: string; days: DayMask }[]

/** The weekday of a local calendar day, 0 = Sunday. */
export function weekday(iso: string): number {
  /* ⚠️ THROUGH localMidnight, NEVER `new Date(iso)`. A bare date string parses as UTC midnight, so
     everywhere west of Greenwich `new Date('2026-11-03').getDay()` is Monday — the day before. */
  return localMidnight(iso).getDay()
}

/** Seven weekday numbers in, one mask out. Anything outside 0–6 is ignored rather than wrapped. */
export function maskOf(days: readonly number[]): DayMask {
  let m = 0
  for (const d of days) if (Number.isInteger(d) && d >= 0 && d <= 6) m |= 1 << d
  return m
}

/** The weekday numbers a mask holds, Sunday first. */
export function daysOf(mask: DayMask): number[] {
  const out: number[] = []
  for (let d = 0; d <= 6; d++) if (mask & (1 << d)) out.push(d)
  return out
}

/**
 * Whether a mask is one a goal may be saved with.
 *
 * ⚠️ ZERO IS REFUSED, because a goal for no days at all is a goal that can never be due and never
 * be missed — it would sit in no list and count toward nothing, which is the "goal in no list"
 * bug the room already fixed once for quarter goals. Archive it or delete it instead.
 */
export const validMask = (m: DayMask): boolean => Number.isInteger(m) && m >= 1 && m <= EVERY_DAY

/**
 * The mask in force on a day: the latest entry that had started by then.
 *
 * ⚠️ THE ENTRIES ARE SORTED HERE, NOT TRUSTED TO ARRIVE SORTED. They come back from a table, and
 * a table has no order unless a query gives it one — a reader that quietly assumed one would be
 * right until the day the planner chose otherwise.
 */
export function maskOn(s: Schedule, day: string): DayMask {
  let best: { from: string; days: DayMask } | null = null
  for (const e of s) if (e.from <= day && (!best || e.from > best.from)) best = e
  return best ? best.days : EVERY_DAY
}

/** Whether a repeating day goal with this schedule is due on a given day. */
export const dueOn = (s: Schedule, day: string): boolean =>
  (maskOn(s, day) & (1 << weekday(day))) !== 0

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/** The name of a weekday, plural — for a control's label, where a letter alone says nothing. */
export const dayName = (d: number): string => LONG[d] ?? ''

/** The one-letter face of a weekday button. Two days share T and two share S; the label tells them apart. */
export const dayLetter = (d: number): string => SHORT[d]?.[0] ?? ''

/**
 * A mask in the words a row's chip uses: "every day", "weekdays", "weekends", "not Sun", or the
 * days by name.
 *
 * ⚠️ MONDAY FIRST IN THE WORDS, SUNDAY FIRST IN THE BITS. The bits follow `Date.getDay()` (see
 * DayMask); the words follow how a week is said aloud, where "Sun, Tue" reads as a typo for the
 * week starting on the Sunday. Only the order of the words changes, never what they mean.
 */
export function daysText(mask: DayMask): string {
  if ((mask & EVERY_DAY) === EVERY_DAY) return 'every day'
  if (mask === maskOf([1, 2, 3, 4, 5])) return 'weekdays'
  if (mask === maskOf([0, 6])) return 'weekends'
  /* six days are said by the one left out: "not Sun" rather than six names in a row */
  const out = [1, 2, 3, 4, 5, 6, 0].filter((d) => !(mask & (1 << d)))
  if (out.length === 1) return `not ${SHORT[out[0]]}`
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => mask & (1 << d))
    .map((d) => SHORT[d])
    .join(', ')
}
