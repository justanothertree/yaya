import { useEffect, useMemo, useState } from 'react'
import { moodsBetween, totalsBetween, type Total } from './cloud'
import { CATS, localMidnight, moodOf, spanText, type Moods } from './record'
import { likeForLike, type Scope, type Window } from './goal'

/**
 * What a window actually held — the looking-back half.
 *
 * ⚠️ THE HOLE THIS FILLS WAS THE BIGGEST ONE. Chronicle recorded a life and could not show it
 * back: the log listed today and nothing summed a week, a month or a year, which for a thing
 * asked for as "an all time tracking tool" is most of the point missing. The windows were already
 * there — the plan half has been using them since step 1 — so looking back is the same windows
 * pointed at the record instead of at the intentions.
 *
 * ⚠️ AND ONLY FOR WINDOWS LONGER THAN A DAY. Today and Tomorrow already have the Timer's own log
 * above, entry by entry with the times on them, which is strictly more than a total — showing both
 * would be the same day said twice in two shapes.
 */
/** "this week" → "last week", for the only four scopes this block is rendered for */
const BEFORE: Partial<Record<Scope, string>> = {
  week: 'last week',
  month: 'last month',
  quarter: 'last quarter',
  year: 'last year',
}

export function Looking({
  win,
  label,
  scope,
  on,
}: {
  win: Window
  label: string
  /* ⚠️ the scope and the day, not just the window, because the comparison needs to step BACK one
     window of the same kind — and a month back from 31 March is not thirty-one days. That is
     calendar arithmetic and it lives in goal.ts, where it is tested. */
  scope: Scope
  on: string
}) {
  const [rows, setRows] = useState<Total[] | null>(null)
  /** the same window's minutes, divided by how the sessions went — see moodOf */
  const [moods, setMoods] = useState<Moods | null>(null)
  /**
   * The same stretch of the window before this one, in minutes — or null while it loads, and
   * undefined when there is nothing to compare with.
   *
   * ⚠️ ONLY THE DIFFERENCE IS EVER SHOWN, never the earlier total beside the headline. The
   * headline is the WHOLE window and the comparison is over the ELAPSED stretch — two honest
   * numbers that are not the same number, and putting both on screen would be one block
   * disagreeing with itself. See likeForLike.
   */
  const [was, setWas] = useState<number | null>(null)
  /**
   * The same stretch of the previous window, per activity.
   *
   * ⚠️ IT WAS ALREADY BEING FETCHED AND THROWN AWAY. The comparison call returns a full `Total[]`
   * — one row per activity — and this block kept only the sum of it. The bars below can say which
   * activity moved for nothing, which is the question somebody actually has when the headline says
   * "1h 37m more than this point last week": more of WHAT.
   */
  const [wasEach, setWasEach] = useState<Record<string, number>>({})
  /** whether the window on screen is still running, so the comparison can say "this point" */
  const [part, setPart] = useState(false)

  useEffect(() => {
    let alive = true
    /* ⚠️ a guard rather than an abort: the request cannot be cancelled, so the answer to a window
       somebody has already clicked away from is dropped instead of being rendered late over the
       one they are now looking at */
    void (async () => {
      /* ⚠️ ONE PAIR OF BOUNDS FOR BOTH, worked out once. Two calls each converting the window
         themselves is two chances for a total and its ratings to be about slightly different
         stretches of time, which is exactly the disagreement this block exists to avoid. */
      const from = localMidnight(win.from).toISOString()
      const to = localMidnight(win.to).toISOString()
      /* ⚠️ the clock is read ONCE, here, rather than in the render: a comparison whose "now"
         moved between two renders would quietly change the number on screen */
      const pair = likeForLike(scope, on, Date.now())
      const [got, how, before] = await Promise.all([
        totalsBetween(from, to),
        moodsBetween(from, to),
        pair
          ? totalsBetween(
              new Date(pair.before.fromMs).toISOString(),
              new Date(pair.before.toMs).toISOString(),
            )
          : Promise.resolve(null),
      ])
      if (alive) {
        setRows(got)
        setMoods(how)
        setWas(before === null ? null : before.reduce((n, r) => n + r.mins, 0))
        setWasEach(
          before === null ? {} : Object.fromEntries(before.map((r) => [r.activity, r.mins])),
        )
        setPart(pair?.part ?? false)
      }
    })()
    return () => {
      alive = false
    }
  }, [win.from, win.to, scope, on])

  const done = useMemo(() => (rows ?? []).filter((r) => r.mins > 0), [rows])
  const most = useMemo(() => Math.max(1, ...done.map((r) => r.mins)), [done])
  const cats = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of done) out[r.cat] = (out[r.cat] ?? 0) + r.mins
    return out
  }, [done])
  const all = useMemo(() => done.reduce((n, r) => n + r.mins, 0), [done])
  const mood = useMemo(() => moodOf(moods), [moods])

  if (rows === null) {
    return (
      <p className="muted" aria-busy>
        Adding up {label.toLowerCase()}…
      </p>
    )
  }

  /* ⚠️ no preposition: every label already begins with "this", so "recorded in this week" is one
     word too many and "recorded this week" is what anybody would say out loud */
  if (!done.length) {
    return <p className="muted">Nothing recorded {label.toLowerCase()} yet.</p>
  }

  return (
    <div className="chron-look">
      <p className="chron-look-top">
        <strong>{spanText(all * 60_000)}</strong> recorded {label.toLowerCase()}
        {/* the three categories, from the rows already in hand rather than a second call */}
        {CATS.map(([c, name]) =>
          cats[c] ? (
            <span key={c} className={'chron-cat is-' + c}>
              {name} {spanText(cats[c] * 60_000)}
            </span>
          ) : null,
        )}
      </p>
      {/**
       * ⚠️ IT SAYS THE UNRATED TIME OUT LOUD, and that is the only way this figure is honest.
       * Nearly all time goes unrated, so "2h good" over a month with thirty unrated hours in it
       * reads as a verdict on the month and is a verdict on two hours of it. The same shape as an
       * estimate on a goal, answered the same way: show the gap beside the figure, never instead
       * of it.
       *
       * ⚠️ AND NOTHING AT ALL WHEN NOTHING IS RATED. A line reading "32h unrated" on a window
       * nobody has ever rated is a reproach for not using a feature, which is not what a record of
       * your own life is for. It appears once there is an opinion in it.
       */}
      {/**
       * ⚠️ THE SAME POINT, NOT THE WHOLE OF LAST WEEK. On Tuesday morning this week is two days
       * old and last week was seven, so comparing them reports the calendar as a collapse in
       * effort and every Monday would open with bad news. likeForLike gives two stretches of
       * equal length; this says which one it used.
       *
       * ⚠️ AND NOTHING WHEN NEITHER SIDE HAS ANYTHING. "0m more than last week" on a fresh account
       * is a line about nothing, and a difference under a minute is not news either.
       */}
      {was != null && BEFORE[scope] && (all > 0 || was > 0) && Math.abs(all - was) >= 1 && (
        <p className="muted chron-shift">
          <span className={all >= was ? 'is-up' : 'is-down'}>
            {spanText(Math.abs(all - was) * 60_000)} {all >= was ? 'more' : 'less'}
          </span>{' '}
          than {part ? 'this point ' : ''}
          {BEFORE[scope]}
        </p>
      )}
      {mood.rated > 0 && (
        <p className="muted chron-mood-line">
          {mood.good > 0 && (
            <span className="chron-mood is-good">{spanText(mood.good * 60_000)} good</span>
          )}
          {mood.fine > 0 && (
            <span className="chron-mood is-fine">{spanText(mood.fine * 60_000)} fine</span>
          )}
          {mood.rough > 0 && (
            <span className="chron-mood is-rough">{spanText(mood.rough * 60_000)} rough</span>
          )}
          {mood.unrated > 0 && <span>{spanText(mood.unrated * 60_000)} unrated</span>}
        </p>
      )}
      {/**
       * ⚠️ ONE LINE FOR THE WHOLE LIST, not a label on every bar. A tick on a bar is the least
       * self-explanatory thing in the room — the headline above gives the window's own total, but
       * nothing connects a grey mark to it, and the `title` that explains each one does not exist
       * on a phone (CLAUDE.md §6). It appears only when there is at least one tick to explain.
       */}
      {done.some((r) => {
        const then = wasEach[r.activity]
        return then != null && then > 0 && Math.abs(then - r.mins) >= 1
      }) && (
        <p className="muted chron-key">
          The tick on a bar is where that one stood at this point {BEFORE[scope] ?? 'before'}.
        </p>
      )}
      <ul className="chron-bars">
        {done.map((r) => (
          <li key={r.activity}>
            <span className="chron-bar-name">
              {/* ⚠️ ITS OWN ELEMENT, because the parent is a flex container and text-overflow does not
                  apply to an anonymous flex item — the name had the ellipsis properties on it and
                  still came out cut mid-word, "Chronicle (on the", which reads as a rendering
                  fault rather than as a long name. */}
              <span className="chron-bar-label">{r.name}</span>
            </span>
            <span className="chron-bar">
              {/* ⚠️ a share of the BIGGEST rather than of the total, so the longest bar fills the
                  row — against the total, a day with twelve activities in it is twelve slivers */}
              <i
                className={'is-' + r.cat}
                style={{ width: `${Math.round((r.mins / most) * 100)}%` }}
              />
              {/**
               * ⚠️ WHERE IT STOOD AT THIS POINT LAST TIME, drawn on the bar rather than written
               * beside it. A row at 375px already carries a name with a 130px floor, a bar, a
               * length, a metric total and a rating; a sixth thing in text is the crowding this
               * room keeps relearning. A tick costs no horizontal space and says the same thing.
               *
               * ⚠️ THE SAME DENOMINATOR AS THE BAR, or the two would be on different scales and the
               * mark would be a lie about its own row. And CLAMPED, because `most` is the biggest
               * of THIS window — an activity that was busier last time would otherwise put its
               * marker past the end of the bar.
               */}
              {(() => {
                const then = wasEach[r.activity]
                if (then == null || then <= 0 || Math.abs(then - r.mins) < 1) return null
                const at = Math.min(100, Math.round((then / most) * 100))
                return (
                  <b
                    className={'chron-then' + (r.mins >= then ? ' is-up' : ' is-down')}
                    style={{ left: `${at}%` }}
                    title={`${spanText(then * 60_000)} at this point ${BEFORE[scope] ?? 'before'}`}
                  />
                )
              })()}
            </span>
            <span className="chron-ent-span">{spanText(r.mins * 60_000)}</span>
            {/**
             * ⚠️ the ones the site wrote are marked, because "Paint 4h" meaning "the Paint room was
             * open" is a different claim from "I painted for four hours", and the difference
             * matters when you are reading your own week back.
             *
             * ⚠️ AFTER THE LENGTH RATHER THAN BESIDE THE NAME, which is where it was. The name
             * column is a fixed width so that every bar in the list starts at the same place — a
             * bar chart whose bars do not line up is a worse chart — and a chip sharing that column
             * with "Chronicle (on the site)" left the name ellipsed to "C.". First it wrapped to
             * three lines, then it ate the name; the column was never big enough for both. Out
             * here it competes with nothing.
             */}
            {r.auto ? <span className="chron-chip">on the site</span> : null}
            {/* ⚠️ the metric total beside the time, because for anything with one the quantity is
                usually the point and the hours are the cost of it */}
            {r.amount != null && r.metric ? (
              <span className="chron-amount">
                {Math.round(r.amount * 100) / 100} {r.metric}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
