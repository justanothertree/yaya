import type { Activity, Entry, Span } from './record'

/**
 * The evening wrap-up's questions, asked without a browser (see the card in Timer.tsx).
 *
 * After about eight, the Day's headline becomes a card with three small things to close the day:
 * a rating for a sitting nobody rated, the biggest stretch of the day with nothing written down
 * between two sittings, and one line about the day. Each is something the room could already do
 * from a dialog, a sheet or the Journal; the card only asks at the time of day you would answer.
 */

/** the hour the Day starts offering to wrap up, local time */
export const EVENING = 20

/** a stretch shorter than this between two sittings is a pause, not something to log */
export const STRETCH_MIN_MS = 30 * 60_000

/** whether it is the evening, on the local clock */
export const isEvening = (nowMs: number): boolean => new Date(nowMs).getHours() >= EVENING

/**
 * The sittings that ended and were never rated, oldest first.
 *
 * ⚠️ ONLY THOSE THAT BEGAN IN THE WINDOW. A sitting from last night that ran past midnight belongs
 * to the day it started, the same rule an amount follows (see `amountIn`), so this evening does
 * not ask about yesterday's. And never one the site wrote: a visit is not something you did, so
 * "how did it go" has no answer.
 */
export function unrated(
  log: readonly Entry[],
  acts: readonly Pick<Activity, 'id' | 'auto'>[],
  fromMs: number,
  toMs: number,
  skip: ReadonlySet<string> = new Set(),
): Entry[] {
  const site = new Set(acts.filter((a) => a.auto).map((a) => a.id))
  return log
    .filter((e) => {
      const t = Date.parse(e.start)
      return (
        e.end != null &&
        e.quality == null &&
        Number.isFinite(t) &&
        t >= fromMs &&
        t < toMs &&
        !site.has(e.activity) &&
        !skip.has(e.id)
      )
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/**
 * The longest stretch BETWEEN two sittings with nothing written down, or null.
 *
 * ⚠️ BETWEEN, NOT BEFORE THE FIRST OR AFTER THE LAST. Before the first sitting is usually sleep,
 * and after the last one is already said: the room's "Xh unaccounted since …" line reports it,
 * and Log a past session opens on exactly that stretch. A gap in the middle of the day is the one
 * nothing pointed at.
 *
 * ⚠️ THE UNION OF THE SITTINGS, not the sittings one by one, because they may overlap — a call
 * inside a work block, music over both. Measuring from each sitting's own end would find a "gap"
 * inside a span another sitting covers.
 */
export function biggestStretch(
  log: readonly Span[],
  fromMs: number,
  toMs: number,
  nowMs: number,
  minMs: number = STRETCH_MIN_MS,
): { fromMs: number; toMs: number } | null {
  const edge = Math.min(toMs, nowMs)
  const spans = log
    .map((s) => {
      const a = Date.parse(s.start)
      const b = s.end == null ? nowMs : Date.parse(s.end)
      return [Math.max(a, fromMs), Math.min(b, edge)] as const
    })
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0])

  let best: { fromMs: number; toMs: number } | null = null
  let reach = -Infinity
  for (const [a, b] of spans) {
    if (reach > -Infinity && a > reach && a - reach >= minMs) {
      if (!best || a - reach > best.toMs - best.fromMs) best = { fromMs: reach, toMs: a }
    }
    reach = Math.max(reach, b)
  }
  return best
}
