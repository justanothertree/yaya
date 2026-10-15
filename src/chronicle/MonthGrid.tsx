import { useCallback, useEffect, useMemo, useState } from 'react'
import { entriesBetween } from './cloud'
import { monthCells, monthOf } from './month'
import { dayBounds, spanText, type Entry } from './record'
import { todayISO } from '../circuit/dates'

/**
 * The month as a calendar: which days you recorded anything, and how much.
 *
 * ⚠️ IT ANSWERS A DIFFERENT QUESTION FROM THE WEEK GRID, which is why both exist. The week shows
 * WHEN inside a day — that the mornings are empty. A month cannot: twenty-four hours in a cell an
 * inch wide is four pixels an hour, and a block in it would be a speck. What a month shows is
 * WHICH DAYS, and how full each was — the shape of a habit rather than the shape of a day.
 *
 * ⚠️ AND IT ONLY APPEARS IN THE MONTH VIEW. A calendar on the day's own screen would be a third
 * grid under the other two, and the horizon tabs already say which question is being asked. This
 * is what "This month" should have been showing all along beside its bars.
 *
 * ⚠️ THE CELLS DO NOT CLICK, AND THAT IS DELIBERATE RATHER THAN UNFINISHED. The day this half of
 * the room is about comes from the horizon view itself — `v.when()` — so there is no cursor here
 * to move, where the week grid above sits beside a stopwatch that owns one. A cell that looked
 * pressable and did nothing would be worse than a cell that does not: the week grid is four inches
 * up and picks days properly. Each cell still carries the full reading in its title and label, so
 * the facts are not hover-only.
 */
export function MonthGrid({ on, beat }: { on: string; beat: number }) {
  const [log, setLog] = useState<Entry[]>([])
  const days = useMemo(() => monthOf(on), [on])

  const load = useCallback(async () => {
    if (!days.length) return
    const from = dayBounds(days[0].on).fromMs
    const to = dayBounds(days[days.length - 1].on).toMs
    setLog(await entriesBetween(new Date(from).toISOString(), new Date(to).toISOString()))
  }, [days])

  /* ⚠️ `beat` for the same reason as Looking beside it: this fetches its own month, and nothing it
     is handed changes when a timer stops — so the calendar kept yesterday's fills while the day's
     log two inches above it had the new ones */
  useEffect(() => {
    void load()
  }, [load, beat])

  const cells = useMemo(() => monthCells(days, log, Date.now()), [days, log])
  /**
   * ⚠️ A SHARE OF THE BUSIEST DAY, NOT OF TWENTY-FOUR HOURS, which is the answer this room already
   * reached once: `Looking`'s bars say "a share of the BIGGEST rather than of the total, so the
   * longest bar fills the row — against the total, a day with twelve activities in it is twelve
   * slivers". A calendar has it worse. Nobody records sixteen hours, so against a whole day every
   * cell is a 2px hairline and the month reads as empty whatever is in it — measured here at 4–8%
   * of a 34px cell.
   *
   * ⚠️ THE ABSOLUTE NUMBER IS STILL THE ONE IT SAYS. The fill is a comparison between days; the
   * label and the title give the real hours, because "tallest" is not a quantity.
   */
  const busiest = useMemo(() => Math.max(...cells.map((c) => c.covered), 0), [cells])
  /**
   * ⚠️ THE LOCAL DATE, NEVER `toISOString().slice(0, 10)`. That is UTC, and dates.ts carries a
   * warning against it at the top of the file for this exact reason: in any zone behind UTC it
   * returns TOMORROW from the evening onwards. Measured in America/New_York — at 19:30 both agree
   * on the 15th, at 20:30 this said the 16th while every date the room logs against still said the
   * 15th. So the ring marking today sat on tomorrow's cell all evening, and on the last day of a
   * month it sat on a cell outside the month or on none at all.
   */
  const today = todayISO()
  const dows = useMemo(() => {
    /* ⚠️ built from a known Sunday rather than hard-coded, so the names follow the reader's locale
       the way every other date in this room does */
    const base = new Date(2026, 0, 4) /* a Sunday */
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
      return d.toLocaleDateString(undefined, { weekday: 'narrow' })
    })
  }, [])

  return (
    <div className="chron-month">
      <div className="chron-month-dows" aria-hidden>
        {dows.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="chron-month-grid">
        {cells.map((c) => {
          const d = new Date(c.on + 'T12:00:00')
          const mins = Math.round((c.covered / 100) * 24 * 60)
          return (
            <span
              key={c.on}
              className={
                'chron-month-cell' +
                (c.inMonth ? '' : ' is-outside') +
                (c.on === today ? ' is-today' : '')
              }
              title={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} — ${mins > 0 ? spanText(mins * 60_000) : 'nothing'}`}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} — ${mins > 0 ? spanText(mins * 60_000) + ' recorded' : 'nothing recorded'}`}
            >
              <span className="chron-month-num">{c.day}</span>
              {/**
               * ⚠️ A FILL FROM THE BOTTOM, not a shade of the whole cell. A cell tinted by how full
               * it is reads as a colour code — five greys nobody has a legend for — where a bar
               * rising out of the floor is a quantity you can compare down a column without one.
               */}
              {c.covered > 0 && (
                <i
                  className="chron-month-fill"
                  /* a floor of 10%, so a day with twenty minutes in it is still visibly a day with
                     something in it rather than a line indistinguishable from an empty cell */
                  style={{ height: `${Math.max((c.covered / (busiest || 1)) * 100, 10)}%` }}
                />
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
