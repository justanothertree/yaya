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
 * The next moment the card can appear or has to go: eight tonight, or midnight once it is eight.
 *
 * ⚠️ AN IDLE ROOM DOES NOT RENDER, so "after eight" was only true the next time something else
 * moved. The clock ticks once a second while a timer runs and not at all otherwise, which is
 * exactly the evening somebody sits down at the end of. The room sets a timer for this moment.
 * Built from the local date's own parts, so a day with a clock change still lands on eight and on
 * midnight rather than an hour either side.
 */
export function nextEdge(nowMs: number): number {
  const d = new Date(nowMs)
  return d.getHours() < EVENING
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), EVENING).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** what the card remembers about one evening, in this browser */
export type WrapMemory = { off: boolean; skip: ReadonlySet<string> }

/** the most skipped sittings one evening keeps; a day with more is not a day anybody rates */
const SKIP_CAP = 200

/**
 * The evening's memory, read back from what was stored — Not tonight, and the sittings skipped.
 *
 * ⚠️ KEYED ON THE DATE, so it is gone by the next evening without anybody undoing it, and a page
 * left open overnight reads tomorrow's empty memory rather than tonight's. Anything unreadable is
 * an evening with nothing remembered, never an error: this is a preference about a card.
 */
export function readWrap(raw: string | null, day: string): WrapMemory {
  const none: WrapMemory = { off: false, skip: new Set() }
  if (!raw) return none
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return none
  }
  if (!v || typeof v !== 'object') return none
  const o = v as { on?: unknown; off?: unknown; skip?: unknown }
  if (o.on !== day) return none
  const skip = Array.isArray(o.skip)
    ? o.skip.filter((x): x is string => typeof x === 'string').slice(0, SKIP_CAP)
    : []
  return { off: o.off === true, skip: new Set(skip) }
}

/** the same memory with one more thing in it, ready to store; a new day starts it again */
export function writeWrap(
  raw: string | null,
  day: string,
  change: { off: true } | { skip: string },
): string {
  const was = readWrap(raw, day)
  const skip = new Set(was.skip)
  if ('skip' in change) skip.add(change.skip)
  return JSON.stringify({
    on: day,
    off: was.off || 'off' in change,
    skip: [...skip].slice(-SKIP_CAP),
  })
}

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
