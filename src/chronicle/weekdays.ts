import { localMidnight } from './record'
import type { Mark } from './goal'

/**
 * ⚠️ PROPOSAL — NOTHING IMPORTS THIS YET, AND NO COLUMN EXISTS FOR IT TO READ.
 *
 * Selected-weekday recurrence for a repeating day goal: "swim on Tuesdays", "floss every day but
 * Sunday". It is the logic half of docs/2026-11-08-chronicle-weekdays.DRAFT.sql, written first
 * because it is the half that can be tested without a database, and because the one rule Evan
 * set for it — a schedule change affects FUTURE occurrences, never the completion history
 * already recorded — is a property of this arithmetic rather than of the table.
 *
 * Wiring it in needs the table, and the table needs approving. Until both, this module and its
 * tests are a claim about how the feature WILL behave, kept honest by being runnable.
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

/** A day's verdict, with one more answer than `Mark` has: the goal was not for that day. */
export type DayMark = Mark | 'off'

/**
 * The marks `marksOf` gives a repeating day goal, with the days it was not for set to `off`.
 *
 * `marks` is oldest first and its last entry is `on` — the same shape `marksOf` returns — so the
 * entry `k` places from the end is the day `k` days before `on`.
 *
 * ⚠️ A MET DAY THE GOAL WAS NOT FOR IS STILL `off`. Swimming on a Monday for a Tuesday goal is a
 * real swim and stays in the record — the minutes, the totals and every other goal see it — but
 * this goal was not asking about Monday, so Monday cannot be a day it was met on. Counting it
 * would let one extra session prop up a streak the schedule says was broken.
 */
export function scheduledMarks(marks: readonly Mark[], on: string, s: Schedule): DayMark[] {
  const end = localMidnight(on)
  return marks.map((m, i) => {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (marks.length - 1 - i))
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    return dueOn(s, iso) ? m : 'off'
  })
}

/**
 * The run of met days at the end, stepping over the days the goal was not for.
 *
 * ⚠️ THE SAME RULE AS `streakOf` FOR TODAY: an unfinished current day does not break the run,
 * because the day is not over. And an `off` day neither extends nor breaks it — a Tuesday goal
 * met four Tuesdays running has a streak of four, not of one.
 */
export function scheduledStreak(marks: readonly DayMark[]): number {
  let run = 0
  let i = marks.length - 1
  if (marks[i] === 'now') i--
  for (; i >= 0; i--) {
    if (marks[i] === 'off') continue
    if (marks[i] !== 'met') break
    run++
  }
  return run
}
