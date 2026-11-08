import { useEffect, useMemo, useRef, useState } from 'react'
import { localISO } from '../circuit/dates'
import { entriesBetween } from './cloud'
import { byDay, journalRows, matching, type JournalRow } from './journal'
import { dayBounds, type Activity, type Entry } from './record'

/** how far back the list reaches at first, and how much each "further back" adds */
const STEP_DAYS = 30
/**
 * The furthest it will reach.
 *
 * ⚠️ UNDER 400 DAYS, AND THE REASON IS A REFUSAL RATHER THAN A CLAMP. `chronicle_entries_between`
 * raises "that is too long a range" past 400 days, and `entriesBetween` turns an error into an
 * empty list — so one step too far would not show a shorter journal, it would show "Nothing
 * written", which is the most confident wrong answer this list could give. 360 is the last whole
 * step of thirty under the line.
 */
const MAX_DAYS = 360

const dayName = (iso: string, today: string): string => {
  if (iso === today) return 'Today'
  const d = new Date(dayBounds(today).fromMs)
  d.setDate(d.getDate() - 1)
  if (iso === localISO(d)) return 'Yesterday'
  return new Date(dayBounds(iso).fromMs).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * The journal, read across sittings — everything you wrote, newest first, by the day you wrote it.
 *
 * ⚠️ A DOOR TO EACH SITTING, NOT A SECOND EDITOR. A row opens the sitting it was written about, in
 * the same dialog ✎ opens everywhere else, so there is still exactly one place a note is changed
 * or deleted. A list that could edit would be the third write path for a journal entry, and the
 * first two both lost one.
 *
 * ⚠️ AND IT TEACHES WHERE NOTES COME FROM WHEN THERE ARE NONE. The empty list is the one moment
 * somebody is looking for their notes and finding nothing, which is exactly when they need telling
 * that a note hangs off a session, and which two buttons write one.
 */
export function JournalList({
  acts,
  beat,
  onOpen,
}: {
  acts: readonly Activity[]
  /** bumped by the room when the record changed elsewhere — see `beat` on Timer */
  beat?: number
  onOpen: (row: JournalRow, sitting: Entry) => void
}) {
  const [days, setDays] = useState(STEP_DAYS)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [q, setQ] = useState('')
  /* the window, re-derived each render from the day it is — a tab left open overnight moves on */
  const today = localISO(new Date())
  const toMs = dayBounds(today).toMs
  const fromMs = useMemo(() => {
    const d = new Date(dayBounds(today).fromMs)
    d.setDate(d.getDate() - (days - 1))
    return d.getTime()
  }, [today, days])

  /* ⚠️ A LATE ANSWER FOR A NARROWER WINDOW IS DROPPED — the same guard `Looking` keeps. Pressing
     "further back" twice quickly would otherwise let the 30-day reply land after the 90-day one
     and quietly shrink the list. */
  const seq = useRef(0)
  useEffect(() => {
    const mark = ++seq.current
    void entriesBetween(new Date(fromMs).toISOString(), new Date(toMs).toISOString()).then((e) => {
      if (mark === seq.current) setEntries(e)
    })
  }, [fromMs, toMs, beat])

  const rows = useMemo(
    () => (entries ? journalRows(entries, fromMs, toMs) : []),
    [entries, fromMs, toMs],
  )
  const shown = useMemo(() => matching(rows, q, acts), [rows, q, acts])
  const name = useMemo(() => new Map(acts.map((a) => [a.id, a.name])), [acts])
  const sittingOf = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  /* the preposition travels with the phrase, so every sentence that uses it reads */
  const span = `in the last ${days} days`

  return (
    <section className="chron-journal-list" aria-labelledby="chron-journal-h">
      <div className="chron-journal-top">
        <h3 id="chron-journal-h">What you wrote {span}</h3>
        {rows.length > 0 && (
          <input
            type="search"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            placeholder="search, or an activity's name"
            aria-label="Search what you wrote"
          />
        )}
      </div>

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          Nothing written {span}. A note belongs to a session: <strong>✎ Note</strong> beside Stop
          writes about the one running now, and <strong>✎</strong> on any session in{' '}
          <strong>Day</strong> writes about that one.
        </p>
      ) : shown.length === 0 ? (
        <p className="muted">
          Nothing written {span} mentions “{q.trim()}”.
        </p>
      ) : (
        byDay(shown).map(([day, list]) => (
          <div key={day} className="chron-journal-day">
            <h4>{dayName(day, today)}</h4>
            <ul>
              {list.map((r) => {
                const e = sittingOf.get(r.entry)
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="chron-journal-row"
                      disabled={!e}
                      onClick={() => e && onOpen(r, e)}
                    >
                      <span className="chron-journal-meta">
                        <time dateTime={r.at}>{clock(r.at)}</time>
                        {' · '}
                        {name.get(r.activity) ?? 'something'}
                        {/* ⚠️ WHEN THE SITTING WAS ANOTHER DAY, SAY WHICH — the row opens there,
                            and a tap that jumps to Monday from a heading that says Thursday
                            should not be a surprise */}
                        {r.sat !== r.day ? ` · from ${dayName(r.sat, today)}` : ''}
                      </span>
                      <span className="chron-journal-body">{r.body}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}

      {entries !== null && days < MAX_DAYS && (
        <button
          type="button"
          className="btn btn-ghost chron-journal-more"
          onClick={() => setDays((d) => Math.min(MAX_DAYS, d + STEP_DAYS))}
        >
          Look further back
        </button>
      )}
    </section>
  )
}
