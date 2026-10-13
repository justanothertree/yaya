import { useEffect, useMemo, useState } from 'react'
import { totalsBetween, type Total } from './cloud'
import { CATS, localMidnight, spanText } from './record'
import type { Window } from './goal'

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
export function Looking({ win, label }: { win: Window; label: string }) {
  const [rows, setRows] = useState<Total[] | null>(null)

  useEffect(() => {
    let alive = true
    /* ⚠️ a guard rather than an abort: the request cannot be cancelled, so the answer to a window
       somebody has already clicked away from is dropped instead of being rendered late over the
       one they are now looking at */
    void (async () => {
      const got = await totalsBetween(
        localMidnight(win.from).toISOString(),
        localMidnight(win.to).toISOString(),
      )
      if (alive) setRows(got)
    })()
    return () => {
      alive = false
    }
  }, [win.from, win.to])

  const done = useMemo(() => (rows ?? []).filter((r) => r.mins > 0), [rows])
  const most = useMemo(() => Math.max(1, ...done.map((r) => r.mins)), [done])
  const cats = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of done) out[r.cat] = (out[r.cat] ?? 0) + r.mins
    return out
  }, [done])
  const all = useMemo(() => done.reduce((n, r) => n + r.mins, 0), [done])

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
      <ul className="chron-bars">
        {done.map((r) => (
          <li key={r.activity}>
            <span className="chron-bar-name">
              {r.name}
              {/* ⚠️ the ones the site wrote are marked, because "Paint 4h" meaning "the Paint room
                  was open" is a different claim from "I painted for four hours" and the difference
                  matters when you are reading your own week back */}
              {r.auto ? <span className="chron-chip">on the site</span> : null}
            </span>
            <span className="chron-bar">
              {/* ⚠️ a share of the BIGGEST rather than of the total, so the longest bar fills the
                  row — against the total, a day with twelve activities in it is twelve slivers */}
              <i
                className={'is-' + r.cat}
                style={{ width: `${Math.round((r.mins / most) * 100)}%` }}
              />
            </span>
            <span className="chron-ent-span">{spanText(r.mins * 60_000)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
