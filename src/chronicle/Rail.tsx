import { useCallback, useEffect, useMemo, useState } from 'react'
import { plansBetween, totalsBetween } from './cloud'
import { dayBounds, spanText, type Activity } from './record'
import { scoreOf } from './score'
import type { Plan } from './plan'

/**
 * The day in four numbers and what is coming, beside the room rather than inside it.
 *
 * ⚠️ IT IS THE SECOND HALF OF WHAT THE HTML APP HAD AND THIS DID NOT — the first being the week
 * grid. Its sidebar carries a daily score, goals today, alarms, a to-do queue and upcoming events.
 * Two of those five are things chronicle already knows and was throwing away; the other three are
 * not, and inventing them is covered below.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT HAVE, and why, because an empty section headed "Alarms" is
 * worse than no section:
 *  · ALARMS would be a new table, a new permission and a delivery mechanism — a notification is
 *    not a thing a page can promise while it is closed. It is a feature, not a panel.
 *  · A TO-DO QUEUE is what the goals half already is. A second list of things to do, beside a list
 *    of things to do, is two places for the same item to be finished in.
 *  · GOALS TODAY is the Today tab, which is four inches below this and already counts itself.
 * What is left is the score and what is coming up, and both are read from rows that exist.
 */
export function Rail({ day, acts, tick }: { day: string; acts: Activity[]; tick: number }) {
  const [rows, setRows] = useState<Array<{ cat: Activity['cat']; mins: number }>>([])
  const [ahead, setAhead] = useState<Plan[]>([])
  const byId = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts])

  const load = useCallback(async () => {
    const { fromMs, toMs } = dayBounds(day)
    /**
     * ⚠️ THE DAY'S TOTALS, NOT THE DAY'S ENTRIES. The sum is the server's own — the same one the
     * room's bars and goals are drawn from — so the rail cannot disagree with the list beside it
     * about how long something took. Two queries for one day's record is two chances to say
     * different numbers on one screen.
     */
    const [t, p] = await Promise.all([
      totalsBetween(new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
      /* what is still ahead: from now to the end of tomorrow, which is as far as a plan is useful */
      plansBetween(new Date().toISOString(), new Date(toMs + 86_400_000).toISOString()),
    ])
    setRows(t.map((x) => ({ cat: x.cat, mins: x.mins })))
    setAhead(p.filter((x) => Date.parse(x.start) > Date.now()).slice(0, 4))
  }, [day])

  useEffect(() => {
    void load()
  }, [load, tick])

  const s = useMemo(() => scoreOf(rows), [rows])

  return (
    <aside className="chron-rail" aria-label="Today at a glance">
      <h3 className="chron-rail-head">Today</h3>

      {/**
       * ⚠️ THE BIG NUMBER IS THE SHARE, AND THE WORD UNDER IT SAYS WHICH SHARE. A percentage with
       * no noun is the thing a dashboard does that nobody can read: 62% of what. It is the part of
       * what you wrote down that was Locked In, so the label is the category's own name.
       */}
      {/* ⚠️ an em dash when there is under a minute to take a share of — see `share` in score.ts,
          which withholds the proportion rather than printing one made of noise */}
      <p className="chron-rail-big">
        {s.share == null ? '—' : `${Math.round(s.share)}%`}
        <span className="chron-rail-of">{s.share == null ? 'nothing yet' : 'Locked In'}</span>
      </p>

      <dl className="chron-rail-nums">
        <div>
          <dt>Focused</dt>
          <dd>{spanText(s.focused * 60_000)}</dd>
        </div>
        <div>
          <dt>Written down</dt>
          <dd>{spanText(s.logged * 60_000)}</dd>
        </div>
      </dl>

      {/* the same question the week grid asks of seven days, asked of this one */}
      <p className="chron-rail-cov">
        <span>{Math.round(s.covered)}% of the day</span>
        <i aria-hidden>
          <b style={{ width: `${s.covered}%` }} />
        </i>
      </p>

      <h3 className="chron-rail-head">Coming up</h3>
      {ahead.length === 0 ? (
        /* ⚠️ it says what the section is for, not that it is empty — "nothing" twice over is how a
           new member learns a panel is decoration */
        <p className="muted chron-rail-none">Nothing planned yet. Plan a span below.</p>
      ) : (
        <ul className="chron-rail-next">
          {ahead.map((p) => {
            const a = byId.get(p.activity)
            return (
              <li key={p.id}>
                {/**
                 * ⚠️ THE DAY, WHEN IT IS NOT THIS ONE. "7:00 AM" read at nine at night is a time
                 * that has already gone — the list looks ahead to the end of tomorrow, so most of
                 * what it shows in an evening is tomorrow's, and a bare clock time says the
                 * opposite of what it means. Today's keep the bare time, because that is the
                 * commonest case and a "Today" on every row is noise.
                 */}
                <span className="chron-rail-when">
                  {new Date(p.start).toDateString() !== new Date().toDateString()
                    ? new Date(p.start).toLocaleDateString(undefined, { weekday: 'short' }) + ' '
                    : ''}
                  {new Date(p.start).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                {a?.colour ? (
                  <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                ) : null}
                <span className="chron-rail-what">{a?.name ?? 'something'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
