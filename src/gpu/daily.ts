/**
 * What the Lab's daily puzzles share — Bridges, Cages, Lamps, Pipes and Tents each had their own
 * copy of all of it: the number of today, the clock a finish is read on, and keeping each day's
 * best for a fortnight. Each puzzle still says what makes two finishes the same board and what makes
 * one better (fewest seconds; fewest presses; fewest seconds then fewest turns).
 */

/** a local day as one whole number, the same from midnight to midnight wherever you are */
export const dayNumber = (d = new Date()) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)

/** seconds as minutes and two-figure seconds: 61 reads 1:01 */
export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** how many days of bests are kept */
export const KEEP_DAYS = 14

/**
 * A finish kept if it beats what is there for the same board that day (or there is nothing), and
 * only the last fortnight of days kept at all.
 */
export function keepBestOf<T extends { day: number }>(
  bests: T[],
  b: T,
  today: number,
  same: (x: T, y: T) => boolean,
  better: (b: T, old: T) => boolean,
): T[] {
  const old = bests.find((x) => same(x, b))
  const kept = !old || better(b, old) ? [...bests.filter((x) => !same(x, b)), b] : bests
  return kept.filter((x) => x.day > today - KEEP_DAYS)
}
