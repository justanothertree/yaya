import { describe, expect, it } from 'vitest'
import { columns, hours, weekOf } from './week'
import { localMidnight } from './record'

/**
 * The week grid's arithmetic, asked from the world's shape rather than from the code's sum.
 *
 * A block at nine in the morning on a twenty-four hour column sits 9/24 of the way down and is
 * 1/24 tall. Every expectation below is written that way — as a clock reading turned into a
 * fraction of a day — so that none of them would agree with the implementation if it started
 * measuring from somewhere else.
 */

const DAY = '2026-10-14' /* a Wednesday */
const at = (iso: string, h: number, m = 0) =>
  new Date(localMidnight(iso).getTime() + (h * 60 + m) * 60_000).toISOString()

const span = (on: string, from: number, to: number, activity = 'a1') => ({
  activity,
  start: at(on, from),
  end: at(on, to),
})

describe('the week a day falls in', () => {
  it('is seven days and starts on Sunday, like the rest of the site', () => {
    const w = weekOf(DAY)
    expect(w).toHaveLength(7)
    expect(new Date(w[0] + 'T12:00:00').getDay()).toBe(0)
    expect(w).toContain(DAY)
  })

  it('is the same seven days whichever of them you ask from', () => {
    const w = weekOf(DAY)
    for (const d of w) expect(weekOf(d)).toEqual(w)
  })

  it('runs consecutively, with no gap or repeat', () => {
    const w = weekOf(DAY)
    for (let i = 1; i < w.length; i++) {
      const a = new Date(w[i - 1] + 'T12:00:00')
      const b = new Date(w[i] + 'T12:00:00')
      expect(Math.round((b.getTime() - a.getTime()) / 86_400_000)).toBe(1)
    }
  })
})

describe('a day laid out down a column', () => {
  const nowMs = localMidnight(DAY).getTime() + 13 * 3_600_000 /* 1pm on the Wednesday */

  it('puts a nine-to-ten session three eighths down and one twenty-fourth tall', () => {
    const [col] = columns([DAY], [span(DAY, 9, 10)], nowMs)
    expect(col.blocks).toHaveLength(1)
    /* 9 of 24 hours down, 1 of 24 hours tall — the clock reading, not the code's sum */
    expect(col.blocks[0].left).toBeCloseTo((9 / 24) * 100, 6)
    expect(col.blocks[0].width).toBeCloseTo((1 / 24) * 100, 6)
    expect(col.blocks[0].cut).toBe(false)
  })

  it('gives a day with nothing in it no blocks and nothing covered', () => {
    const [col] = columns([DAY], [], nowMs)
    expect(col.blocks).toEqual([])
    expect(col.covered).toBe(0)
  })

  /**
   * ⚠️ THE MIDNIGHT RULE, WHICH IS WHY THIS REUSES `lane`. A session from 23:00 to 01:00 is an
   * hour of one day and an hour of the next, and both halves have to say they continue — a block
   * hard against the end of a column is otherwise indistinguishable from one that really did stop
   * at midnight.
   */
  it('shows a session across midnight in both days, each saying it is cut', () => {
    const before = weekOf(DAY)[2]
    const crossing = { activity: 'a1', start: at(before, 23), end: at(before, 25) }
    const cols = columns(weekOf(DAY), [crossing], nowMs)
    const first = cols.find((c) => c.on === before)!
    const second = cols[cols.indexOf(first) + 1]

    expect(first.blocks).toHaveLength(1)
    expect(second.blocks).toHaveLength(1)
    expect(first.blocks[0].cut).toBe(true)
    expect(second.blocks[0].cut).toBe(true)
    /* the first hour sits at the very bottom, the second at the very top */
    expect(first.blocks[0].left).toBeCloseTo((23 / 24) * 100, 6)
    expect(second.blocks[0].left).toBeCloseTo(0, 6)
    /* an hour each, and an hour is an hour whichever side of midnight it is */
    expect(first.blocks[0].width).toBeCloseTo((1 / 24) * 100, 6)
    expect(second.blocks[0].width).toBeCloseTo((1 / 24) * 100, 6)
  })

  it('marks the clock on today only', () => {
    const cols = columns(weekOf(DAY), [], nowMs)
    const today = cols.find((c) => c.on === DAY)!
    expect(today.now).toBeCloseTo((13 / 24) * 100, 6)
    for (const c of cols) if (c.on !== DAY) expect(c.now).toBe(null)
  })

  /** eight hours of a twenty-four hour day is a third of it, and that is what the sidebar says */
  it('says how much of the day is accounted for', () => {
    const [col] = columns([DAY], [span(DAY, 1, 5), span(DAY, 9, 13)], nowMs)
    expect(col.covered).toBeCloseTo((8 / 24) * 100, 6)
  })

  /**
   * ⚠️ OVERLAPPING SESSIONS ARE ALLOWED and must not produce "137% of your day". The table has
   * never forbidden recording a call during a work block — a podcast while washing up is two
   * activities over the same minutes — so the figure is a UNION of the sessions and not the sum of
   * their widths. It used to be the sum, clamped to 100.
   *
   * ⚠️ AND THIS FIXTURE ALONE CANNOT TELL A UNION FROM A CLAMP, which is why the one below it
   * exists. A day with a 0–24 session in it is 100% covered either way, so this case passed
   * unchanged through the whole of the clamp's life and would pass again if the clamp came back.
   */
  it('never claims more than a whole day', () => {
    const [col] = columns([DAY], [span(DAY, 0, 24), span(DAY, 9, 17), span(DAY, 10, 12)], nowMs)
    expect(col.covered).toBe(100)
  })

  /**
   * ⚠️ THE CASE THAT SEPARATES THEM, and the one the site was getting wrong. Nothing here reaches
   * past one in the afternoon, so no clamp is involved at all: the sum of these four widths is
   * 79.2% of the day and the day holds 29.2% of it. A grid drawn from the sum paints a day as
   * two-thirds spoken for when two-thirds of it has not happened yet.
   */
  it('counts a minute once, however many sessions are over it', () => {
    const [col] = columns(
      [DAY],
      [span(DAY, 6, 13), span(DAY, 9, 10), span(DAY, 9, 17), span(DAY, 0, 2)],
      nowMs,
    )
    /* 00:00-02:00 and 06:00-17:00 — two hours and eleven, of twenty-four */
    expect(col.covered).toBeCloseTo((13 / 24) * 100, 6)
  })
})

describe('the hour lines', () => {
  it('draws one for every hour of the day', () => {
    expect(hours()).toHaveLength(24)
    expect(hours()[0].top).toBe(0)
    /* the last line is one hour short of the bottom, not on it */
    expect(hours()[23].top).toBeCloseTo((23 / 24) * 100, 6)
  })

  it('labels midnight and noon the way a clock does, never "0a" or "12p" for midnight', () => {
    const h = hours(1)
    expect(h[0].label).toBe('12a')
    expect(h[12].label).toBe('12p')
    expect(h[9].label).toBe('9a')
    expect(h[21].label).toBe('9p')
  })

  it('labels only every third hour by default, so a phone is not a column of numbers', () => {
    const labelled = hours().filter((x) => x.label != null)
    expect(labelled).toHaveLength(8)
    expect(hours().filter((x) => x.label == null)).toHaveLength(16)
  })
})
