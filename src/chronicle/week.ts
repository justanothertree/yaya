import { coveredPct, dayBounds, lane, nowAt, type Block, type Span } from './record'
import { windowOf } from './goal'

/**
 * A week as seven columns of a grid, each a day laid out top to bottom.
 *
 * ⚠️ THIS IS THE THING THE ROOM DID NOT HAVE, and the reason it was missed is worth writing down:
 * the parity list was checked against the HTML app's STORE — its data — and every field in it is
 * built. What a store cannot tell you is the SHAPE of the app around it, and the shape is most of
 * what makes one feel better than another. A list of "Drawing 35m" is the same data as a block
 * sitting at nine in the morning, and only one of them shows you that your mornings are empty.
 *
 * ⚠️ IT REUSES `lane` RATHER THAN MEASURING AGAIN. The day strip already answers "where does this
 * span sit in this window, as percentages" and has tests that say so; a column is that same
 * question turned ninety degrees, so `left` becomes `top` and `width` becomes `height`. Writing a
 * second copy of the arithmetic would be a second place for the midnight rule to be wrong.
 */

/** One day of the grid: where its sessions sit, and how much of it is accounted for. */
export type Column = {
  /** the local ISO date this column stands for */
  on: string
  fromMs: number
  toMs: number
  /** every session that touches this day, as a share of it — `left`/`width` read down the column */
  blocks: Block[]
  /** how far down the column the clock is, 0–100, or null when this is not today */
  now: number | null
  /**
   * How much of the day has any session on it at all, 0–100.
   *
   * ⚠️ THE UNION, NOT THE SUM OF THE BLOCKS, and this used to be the sum clamped to 100. Two
   * sessions may overlap — the table has never forbidden recording a call during a work block —
   * so adding the widths up double-counts the minutes they share: a 9-to-5 with a call inside it
   * and music over the whole lot read **70.8%** of a day holding **33.3%**. The clamp was there to
   * stop "103% of your day" reading as a bug, and it did that by turning a visibly broken figure
   * into a confidently wrong one: four overlapping morning sittings reported a day **100%**
   * recorded with its whole afternoon blank. `coveredMs` cannot exceed its window, so there is
   * nothing left to clamp.
   */
  covered: number
}

/** The seven local ISO dates of the week `on` falls in — Sunday first, like the rest of the site. */
export function weekOf(on: string): string[] {
  const win = windowOf('week', on)
  if (!win) return []
  const out: string[] = []
  const start = new Date(win.from + 'T12:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)
    const p = (n: number) => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
  }
  return out
}

/**
 * Lay a week out.
 *
 * ⚠️ EVERY SESSION IS OFFERED TO EVERY DAY, and `lane` drops the ones that do not touch it. That
 * is what makes a span across midnight appear in both columns, each flagged `cut` — the same rule
 * the day strip keeps, for free, because it is the same function.
 */
export function columns(
  days: string[],
  spans: Array<Span & { activity: string; id?: string }>,
  nowMs: number,
): Column[] {
  return days.map((on) => {
    const { fromMs, toMs } = dayBounds(on)
    const blocks = lane(spans, fromMs, toMs, nowMs)
    return {
      on,
      fromMs,
      toMs,
      blocks,
      now: nowAt(fromMs, toMs, nowMs),
      covered: coveredPct(spans, fromMs, toMs, nowMs),
    }
  })
}

/**
 * The hour lines a column is drawn against.
 *
 * ⚠️ EVERY HOUR HAS A LINE AND ONLY SOME HAVE A LABEL. Twenty-four labels down a phone is a column
 * of numbers taller than the grid they describe; the lines are what make a block readable as "nine
 * in the morning", and the labels only have to be frequent enough to count from.
 */
export function hours(every = 3): Array<{ hour: number; top: number; label: string | null }> {
  const out: Array<{ hour: number; top: number; label: string | null }> = []
  for (let h = 0; h < 24; h++) {
    const am = h < 12
    const twelve = h % 12 === 0 ? 12 : h % 12
    out.push({
      hour: h,
      top: (h / 24) * 100,
      label: h % every === 0 ? `${twelve}${am ? 'a' : 'p'}` : null,
    })
  }
  return out
}
