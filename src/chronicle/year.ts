import { localISO } from '../circuit/dates'

/**
 * How many year-windows `chronicle_spans` will answer about in one call.
 *
 * ⚠️ THE SERVER'S OWN NUMBER, and the client had none. `chronicle_spans` raises "too many at
 * once" above 120 — "a hundred and twenty years is more than anybody will ask for", which is
 * true of years somebody LIVED and not of years a date can name. `yearsBetween` emits one window
 * per calendar year from the first thing recorded, unbounded, and `spanTotals` sent the lot; the
 * refusal was then swallowed into `{}` and the Years view drew every year with nothing in it.
 * Silently, and for ever, because the figure it needs is the one it cannot get.
 *
 * One mistyped year reaches it: `chronicle_entry_add` bounds a span's length and refuses the
 * future, and deliberately has no lower bound — so "0025-10-16" in ⏱ Fill a gap is accepted, and
 * two thousand windows are asked for the next time the Years view loads.
 */
export const SPANS_AT_ONCE = 120

/**
 * The years somebody has recorded in, as windows the server can be asked about.
 *
 * ⚠️ THE WINDOWS ARE COMPUTED HERE AND SENT, rather than derived on the server, and that is the
 * whole reason this module exists. A year begins at local midnight on the 1st of January, and the
 * server does not know the member's zone — deriving it from a UTC offset is an hour wrong either
 * side of a daylight-saving change, which is the sort of quiet error this room is built to avoid.
 * `chronicle_tally` takes its windows from the caller for exactly the same reason, and
 * `chronicle_spans` is its sibling.
 *
 * ⚠️ NEWEST FIRST, because a list of years is read downwards from the one you are in. Every other
 * list in this room that spans time runs the same way.
 */
export type Span = { key: string; from: string; to: string }

/**
 * Every local year from the one containing `firstMs` to the one containing `nowMs`, inclusive.
 *
 * ⚠️ INCLUSIVE AT BOTH ENDS AND TILING EXACTLY: each window ends where the next begins, so the
 * sum over all of them is the whole record and no sitting is counted twice or dropped. That is
 * the property the test asserts, rather than any particular boundary — the same shape as
 * `overlapMs`, whose test says a span's overlaps with a set of tiling windows add up to its length.
 *
 * ⚠️ AND `new Date(y, 0, 1)` IS LOCAL BY CONSTRUCTION. Writing the boundary as a UTC instant and
 * converting would put the new year in the wrong place for everybody west of Greenwich.
 */
export function yearsBetween(firstMs: number | null, nowMs: number): Span[] {
  if (firstMs == null || !Number.isFinite(firstMs)) return []
  const first = new Date(firstMs)
  const now = new Date(nowMs)
  const from = first.getFullYear()
  const to = now.getFullYear()
  if (to < from) return []
  const out: Span[] = []
  for (let y = to; y >= from; y--) {
    out.push({
      key: String(y),
      from: new Date(y, 0, 1).toISOString(),
      to: new Date(y + 1, 0, 1).toISOString(),
    })
  }
  return out
}

/** The local date somebody first recorded anything, for the sentence under the list. */
export const firstDay = (firstMs: number | null): string | null =>
  firstMs == null || !Number.isFinite(firstMs) ? null : localISO(new Date(firstMs))

/**
 * How many whole days a record covers, counting both ends.
 *
 * ⚠️ DAYS RATHER THAN A DURATION, because "since 13 October" is a date and the useful companion
 * to it is how long that has been — and a record two hours old covering one day should say one,
 * not zero. Measured between local midnights so it cannot disagree with the dates either side.
 */
export function daysCovered(firstMs: number | null, nowMs: number): number {
  if (firstMs == null || !Number.isFinite(firstMs)) return 0
  const a = new Date(firstMs)
  const b = new Date(nowMs)
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(b) - midnight(a)) / 86_400_000) + 1
  return days < 1 ? 0 : days
}
