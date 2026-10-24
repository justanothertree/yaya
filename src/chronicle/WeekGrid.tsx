import { useMemo } from 'react'
import { columns, hours, weekOf } from './week'
import { blockAt, spanText, type Activity, type Entry } from './record'
import { todayISO } from '../circuit/dates'

/**
 * The week as a grid: hours down, days across, every session a block where it happened.
 *
 * ⚠️ THE ROOM COULD NOT SHOW THE SHAPE OF A DAY. It listed "Drawing 35m, Gym 45m" and threw the
 * placement away, so the one thing you could not see was that your mornings are empty and
 * everything happens after nine at night. That is the same data read instead of discarded — the
 * day strip already did it for one day, and this is seven of them.
 *
 * ⚠️ IT IS `WeekGrid` RATHER THAN `Week` because the maths beside it is `week.ts`, and on a
 * case-insensitive filesystem those two are the same name — the compiler refuses the pair
 * outright. `Plans.tsx` beside `plan.ts` dodges it by number; this dodges it by saying what the
 * component actually draws, which is the better half of the accident.
 *
 * ⚠️ IT IS THE PART OF THE HTML APP THE PARITY LIST MISSED, and the reason is worth remembering:
 * that list was checked against the app's STORE, and a store cannot tell you the shape of the
 * thing built on it. Every field was present and the room still read like a settings page.
 */
export function WeekGrid({
  on,
  log,
  acts,
  onPick,
  onOpen,
  onEmpty,
}: {
  /** any day in the week to draw */
  on: string
  /** every session that might touch it — the caller fetches the week, this only lays it out */
  log: Entry[]
  acts: Activity[]
  /** focus a day: the room's own date picker, driven from the grid */
  onPick: (day: string) => void
  /**
   * Open a session from its block.
   *
   * ⚠️ THE GRID WAS A PICTURE AND NOTHING ELSE. Seven columns of coloured marks, each naming its
   * session in a `title` — which is a tooltip, and a phone has none. So the only way to find out
   * what a block was, or to fix it, was to pick its day and then count rows in the log until you
   * found the one at that hour. Reported as wanting the times to be easier to click; they were
   * not clickable at all.
   */
  onOpen?: (day: string, entry: string) => void
  /** tap a bare patch of a day: somewhere nothing was recorded, at roughly that hour */
  onEmpty?: (day: string, hour: number) => void
}) {
  const days = useMemo(() => weekOf(on), [on])
  const byId = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts])
  /**
   * ⚠️ `Date.now()` ONCE PER RENDER, NOT PER COLUMN. Seven calls would put the clock line at seven
   * slightly different times, which is invisible at a minute's resolution and wrong at a second's
   * — and the room ticks once a second while a timer runs.
   */
  const cols = useMemo(() => columns(days, log, Date.now()), [days, log])
  const rows = useMemo(() => hours(), [])
  /* ⚠️ the LOCAL date — see the note on the same line in MonthGrid, and the warning at the top of
     dates.ts. `toISOString()` is UTC and reads as tomorrow all evening for anybody behind it, so
     the column ringed as today was tomorrow's from 20:00 onwards. */
  const today = todayISO()
  /* only the days that have begun — a week you are three days into is not 60% empty */
  const started = cols.filter((c) => c.fromMs <= Date.now())

  return (
    <div className="chron-week">
      <div className="chron-week-grid">
        {/* the hour labels, once down the left rather than once per column */}
        <div className="chron-week-hours" aria-hidden>
          {rows.map((h) => (
            <span
              key={h.hour}
              className={'chron-week-hour' + (h.strong ? ' is-strong' : '')}
              style={{ top: `${h.top}%` }}
            >
              {h.label}
            </span>
          ))}
        </div>

        {cols.map((c) => {
          const d = new Date(c.on + 'T12:00:00')
          const isToday = c.on === today
          const isOn = c.on === on
          return (
            <div key={c.on} className="chron-week-col">
              {/**
               * ⚠️ THE HEADING IS THE BUTTON, like the activity rows. "Click any day to focus it"
               * is the whole interaction, and a separate control beside the date would be a second
               * small target on a column that is already only a seventh of the width.
               */}
              <button
                type="button"
                className={
                  'btn btn-ghost chron-week-day' +
                  (isToday ? ' is-today' : '') +
                  (isOn ? ' is-on' : '')
                }
                onClick={() => onPick(c.on)}
                aria-current={isOn ? 'date' : undefined}
                aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} — ${Math.round(c.covered)}% of the day recorded`}
              >
                <span className="chron-week-dow">
                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
                <span className="chron-week-num">{d.getDate()}</span>
              </button>

              <div
                className={'chron-week-lane' + (onOpen || onEmpty ? ' is-tappable' : '')}
                /**
                 * ⚠️ THE EMPTY SPACE IS THE CONTROL HERE, which is why this is a handler on the
                 * lane rather than a grid of hour buttons: twenty-four targets per column times
                 * seven columns is 168 controls in the accessibility tree for one gesture. The
                 * blocks inside it are real buttons and stop the event, so a tap only reaches
                 * this when it landed on nothing.
                 *
                 * ⚠️ AND IT IS NOT KEYBOARD-REACHABLE ON PURPOSE. A div you can click is a trap
                 * if it is the ONLY way to do the thing — this is a shortcut to ⏱ Fill a gap,
                 * which is a real button a few inches above with a real form behind it. The day
                 * header is the keyboard route into a day and it always was.
                 */
                onClick={
                  onOpen || onEmpty
                    ? (ev) => {
                        const r = ev.currentTarget.getBoundingClientRect()
                        if (!(r.height > 0)) return
                        const pct = ((ev.clientY - r.top) / r.height) * 100
                        /**
                         * ⚠️ THE TOLERANCE IS IN PIXELS, CONVERTED, BECAUSE A PERCENT OF A DAY IS
                         * NOT A FINGER. It was `blockAt`'s default of 1% — about fourteen minutes,
                         * which sounds generous and is **2.4px** on a 240px lane. So the forgiving
                         * near-miss forgave almost nothing and the blocks stayed "very thin and
                         * short to click". A finger is roughly 10mm; 14px of lane is the honest
                         * version of that, and expressed this way it stays right at any height
                         * the grid is ever drawn at.
                         */
                        const hit = blockAt(c.blocks, pct, (14 / r.height) * 100)
                        if (hit?.id && onOpen) return onOpen(c.on, hit.id)
                        if (!hit && onEmpty)
                          onEmpty(c.on, Math.max(0, Math.min(23, Math.floor((pct / 100) * 24))))
                      }
                    : undefined
                }
              >
                {rows.map((h) => (
                  <i
                    key={h.hour}
                    className={'chron-week-line' + (h.strong ? ' is-strong' : '')}
                    style={{ top: `${h.top}%` }}
                  />
                ))}
                {c.blocks.map((b, i) => {
                  const a = byId.get(b.activity)
                  const mins = (b.width / 100) * 24 * 60
                  return (
                    <span
                      key={`${b.activity}-${i}`}
                      className={
                        'chron-week-block is-' + (a?.cat ?? 'free') + (b.cut ? ' is-cut' : '')
                      }
                      style={{
                        top: `${b.left}%`,
                        /* ⚠️ a floor, so a ten-minute sitting is still a mark rather than a
                           sub-pixel line that rounds away to nothing — 1.2% of 240px is 3px */
                        height: `${Math.max(b.width, 1.2)}%`,
                        /* the activity's own colour when it has one, the category's when not */
                        background: a?.colour ?? undefined,
                      }}
                      /* ⚠️ a title is a tooltip and a phone has none — the day below it is the
                         readable version, and this only names what a block already shows */
                      title={`${a?.name ?? 'something'} · ${spanText(mins * 60_000)}`}
                    />
                  )
                })}
                {c.now != null && <i className="chron-week-now" style={{ top: `${c.now}%` }} />}
              </div>
            </div>
          )
        })}
      </div>

      {/**
       * ⚠️ THE NUMBER THE GRID ALREADY KNEW AND ONLY A SCREEN READER HEARD. Each column carries how
       * much of its day is accounted for — it is in every day button's label — and showing it to
       * nobody else would be the same write-without-read that cost this room three bugs in a week.
       *
       * ⚠️ IT IS THE WEEK'S DAYS THAT HAVE STARTED, not seven. A Tuesday afternoon measured against
       * a whole week is 29% at best and reads as failure; against the days that have actually
       * happened it is the honest fraction. The HTML app's sidebar says "Day covered" for the same
       * reason — it asks about a day you are in, not a week you are not finished with.
       */}
      {started.length > 0 && (
        <p className="muted chron-week-covered">
          {Math.round(started.reduce((n, c) => n + c.covered, 0) / started.length)}% of{' '}
          {started.length === 1 ? 'today' : `these ${started.length} days`} is written down.
        </p>
      )}
    </div>
  )
}
