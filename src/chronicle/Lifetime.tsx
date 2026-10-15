import { useCallback, useEffect, useMemo, useState } from 'react'
import { recordedSince, spanTotals } from './cloud'
import { CATS, spanText } from './record'
import { daysCovered, firstDay, yearsBetween } from './year'

/**
 * The whole record, a year at a time — the Years view's own answer to "what have I done".
 *
 * ⚠️ IT EXISTS BECAUSE THIS WAS THE ONE HORIZON THAT SHOWED NOTHING. Week, month and year each get
 * `Looking`; Today and Tomorrow have the day's own totals two inches above them; Years had its
 * life-scope goals and not one word about the record. The note on Looking's call site said why —
 * "Years has no window to add up", because `chronicle_totals` caps a range at 400 days — and that
 * is true of THAT function. It is not a reason to show nothing; it is a reason to ask a different
 * question, which is what `chronicle_spans` is.
 *
 * ⚠️ THE WINDOWS ARE COMPUTED HERE. A year starts at local midnight and the server does not know
 * the zone — see yearsBetween, and chronicle_tally, which is asked its questions the same way.
 *
 * ⚠️ AND IT ASKS FOR THE YEARS SOMEBODY ACTUALLY HAS, from their first sitting to now, rather than
 * a fixed ten. A list padded with empty years is a worse answer than a short one, and a fixed
 * window would quietly cut off anybody who has been at this longer.
 */
export function Lifetime({ beat }: { beat: number }) {
  const [since, setSince] = useState<number | null>(null)
  const [totals, setTotals] = useState<Record<
    string,
    Partial<Record<'locked' | 'free' | 'life', number>>
  > | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const first = await recordedSince()
    setSince(first)
    if (first == null) {
      setTotals({})
      setLoaded(true)
      return
    }
    setTotals(await spanTotals(yearsBetween(first, Date.now())))
    setLoaded(true)
  }, [])

  /* ⚠️ `beat` for the same reason Looking and MonthGrid take it: this fetches its own figures and
     nothing it is handed changes when a sitting stops */
  useEffect(() => {
    setLoaded(false)
    void load()
  }, [load, beat])

  const rows = useMemo(() => {
    if (!totals) return []
    return yearsBetween(since, Date.now())
      .map((s) => {
        const got = totals[s.key] ?? {}
        const mins = CATS.reduce((n, [c]) => n + (got[c] ?? 0), 0)
        return { year: s.key, mins, by: got }
      })
      .filter((r) => r.mins >= 1)
  }, [totals, since])

  const all = useMemo(() => rows.reduce((n, r) => n + r.mins, 0), [rows])
  /* a share of the BIGGEST year, the same rule every other bar in this room uses — against the
     total, somebody with six years of records gets six slivers */
  const widest = useMemo(() => Math.max(...rows.map((r) => r.mins), 1), [rows])
  const days = daysCovered(since, Date.now())
  const began = firstDay(since)

  if (!loaded) return null
  if (!rows.length)
    return (
      <p className="muted chron-life-none">
        Nothing recorded yet. Once there is, this is where the whole of it adds up.
      </p>
    )

  return (
    <section className="chron-life" aria-label="Every year you have recorded">
      <p className="chron-life-top">
        <strong>{spanText(all * 60_000)}</strong>{' '}
        <span className="muted">
          recorded in all
          {began ? (
            <>
              {' '}
              · since{' '}
              {new Date(began + 'T12:00:00').toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </>
          ) : null}
          {days > 1 ? ` · ${days} days` : null}
        </span>
      </p>
      <ul className="chron-life-years">
        {rows.map((r) => (
          <li key={r.year}>
            <span className="chron-life-year">{r.year}</span>
            <i className="chron-life-track" aria-hidden>
              {/* ⚠️ one segment per category, in the room's own order, so a year reads as what it
                  was made of rather than as one undifferentiated bar */}
              {CATS.map(([c]) =>
                (r.by[c] ?? 0) >= 1 ? (
                  <i
                    key={c}
                    className={'chron-life-part is-' + c}
                    style={{ width: `${((r.by[c] ?? 0) / widest) * 100}%` }}
                  />
                ) : null,
              )}
            </i>
            <span className="muted chron-life-mins">{spanText(r.mins * 60_000)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
