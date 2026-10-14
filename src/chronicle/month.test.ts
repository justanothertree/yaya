import { describe, expect, it } from 'vitest'
import { monthCells, monthOf } from './month'
import { localMidnight } from './record'

const at = (iso: string, h: number) =>
  new Date(localMidnight(iso).getTime() + h * 3_600_000).toISOString()

describe('the month a day falls in', () => {
  /** October 2026 begins on a Thursday and has 31 days */
  const OCT = '2026-10-13'

  it('is always whole weeks, starting on Sunday and ending on Saturday', () => {
    const m = monthOf(OCT)
    expect(m.length % 7).toBe(0)
    expect(new Date(m[0].on + 'T12:00:00').getDay()).toBe(0)
    expect(new Date(m[m.length - 1].on + 'T12:00:00').getDay()).toBe(6)
  })

  it('holds every day of the month, once each', () => {
    const m = monthOf(OCT).filter((d) => d.inMonth)
    expect(m).toHaveLength(31)
    expect(m[0].day).toBe(1)
    expect(m[30].day).toBe(31)
    expect(new Set(m.map((d) => d.on)).size).toBe(31)
  })

  /**
   * ⚠️ THE DAYS EITHER SIDE ARE REAL DAYS. A month starting on a Thursday has the Sunday to
   * Wednesday before it in its first row, and those days have time in them — a calendar that drew
   * them blank would be lying about them to keep its own edges tidy.
   */
  it('pads with the real days either side, marked as outside', () => {
    const m = monthOf(OCT)
    const before = m.filter((d) => !d.inMonth && d.day > 20)
    const after = m.filter((d) => !d.inMonth && d.day < 20)
    /* October 2026 starts on a Thursday, so four days of September lead it */
    expect(before.map((d) => d.day)).toEqual([27, 28, 29, 30])
    /* and it ends on a Saturday, so nothing follows */
    expect(after).toEqual([])
  })

  /**
   * ⚠️ A MONTH THAT DOES NOT END ON A SATURDAY, because October 2026 does — and the test above,
   * which asserts that nothing follows it, is therefore true whether or not the code pads the last
   * row at all. Deleting the trailing-padding line left all twelve tests green until this one
   * existed. November 2026 runs Sunday the 1st to Monday the 30th, so its last row needs five days
   * of December or it is ragged.
   */
  it('pads the last row too, for a month that does not end on a Saturday', () => {
    const nov = monthOf('2026-11-15')
    expect(nov.length % 7).toBe(0)
    expect(nov[nov.length - 1].on).toBe('2026-12-05')
    const trailing = nov.filter((d) => !d.inMonth && d.day < 10)
    expect(trailing.map((d) => d.day)).toEqual([1, 2, 3, 4, 5])
    /* and the month itself is all there */
    expect(nov.filter((d) => d.inMonth)).toHaveLength(30)
  })

  it('runs consecutively, with no gap or repeat', () => {
    const m = monthOf(OCT)
    for (let i = 1; i < m.length; i++) {
      const a = new Date(m[i - 1].on + 'T12:00:00')
      const b = new Date(m[i].on + 'T12:00:00')
      expect(Math.round((b.getTime() - a.getTime()) / 86_400_000)).toBe(1)
    }
  })

  it('is the same grid asked from any day in the month', () => {
    const m = monthOf(OCT)
    expect(monthOf('2026-10-01')).toEqual(m)
    expect(monthOf('2026-10-31')).toEqual(m)
  })

  /** February 2026 starts on a Sunday and has 28 days — exactly four weeks, no padding at all */
  it('needs no padding for a month that is four whole weeks', () => {
    const feb = monthOf('2026-02-15')
    expect(feb).toHaveLength(28)
    expect(feb.every((d) => d.inMonth)).toBe(true)
  })

  it('crosses a year end without losing a day', () => {
    const dec = monthOf('2026-12-15').filter((d) => d.inMonth)
    expect(dec).toHaveLength(31)
    const jan = monthOf('2027-01-15').filter((d) => d.inMonth)
    expect(jan).toHaveLength(31)
    expect(jan[0].on).toBe('2027-01-01')
  })
})

describe('how full each day of the month was', () => {
  const OCT = '2026-10-13'
  const nowMs = localMidnight('2026-10-31').getTime()

  it('reports a day with six hours in it as a quarter full', () => {
    const cells = monthCells(
      monthOf(OCT),
      [{ activity: 'a1', start: at(OCT, 9), end: at(OCT, 15) }],
      nowMs,
    )
    const day = cells.find((c) => c.on === OCT)!
    /* six of twenty-four hours */
    expect(day.covered).toBeCloseTo((6 / 24) * 100, 6)
  })

  it('leaves every other day at nothing', () => {
    const cells = monthCells(
      monthOf(OCT),
      [{ activity: 'a1', start: at(OCT, 9), end: at(OCT, 15) }],
      nowMs,
    )
    expect(cells.filter((c) => c.covered > 0)).toHaveLength(1)
  })

  /** the padding days are measured like any other — that is the whole point of including them */
  it('fills in a day from the month before, if it has time in it', () => {
    const grid = monthOf(OCT)
    const padded = grid.find((d) => !d.inMonth)!
    const cells = monthCells(
      grid,
      [{ activity: 'a1', start: at(padded.on, 8), end: at(padded.on, 12) }],
      nowMs,
    )
    const cell = cells.find((c) => c.on === padded.on)!
    expect(cell.inMonth).toBe(false)
    expect(cell.covered).toBeCloseTo((4 / 24) * 100, 6)
  })

  it('never claims a day was more than full', () => {
    const cells = monthCells(
      monthOf(OCT),
      [
        { activity: 'a1', start: at(OCT, 0), end: at(OCT, 24) },
        { activity: 'a2', start: at(OCT, 9), end: at(OCT, 17) },
      ],
      nowMs,
    )
    expect(cells.find((c) => c.on === OCT)!.covered).toBe(100)
  })

  it('splits a session across midnight between the two days it touches', () => {
    const cells = monthCells(
      monthOf(OCT),
      [{ activity: 'a1', start: at(OCT, 23), end: at(OCT, 25) }],
      nowMs,
    )
    const first = cells.find((c) => c.on === OCT)!
    const second = cells[cells.indexOf(first) + 1]
    expect(first.covered).toBeCloseTo((1 / 24) * 100, 6)
    expect(second.covered).toBeCloseTo((1 / 24) * 100, 6)
  })
})
