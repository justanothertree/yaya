import { useEffect, useMemo, useRef, useState } from 'react'
import { localISO } from '../circuit/dates'
import { addDayNote, dayNotesBetween, editNote, entriesBetween } from './cloud'
import { aboutDay, byDay, journalRows, matching, type DayNote, type JournalRow } from './journal'
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
 * step of thirty under the line. `chronicle_day_notes_between` refuses past the same 400.
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
 * ⚠️ EXCEPT FOR A NOTE WITH NO SITTING, whose one place is HERE. It has no dialog to open — it
 * belongs to a day — so this list is both where it is written and where it is changed. Still one
 * place per note: a sitting's note in its sitting, a day's note in the journal.
 *
 * ⚠️ AND IT TEACHES WHERE NOTES COME FROM WHEN THERE ARE NONE. The empty list is the one moment
 * somebody is looking for their notes and finding nothing, which is exactly when they need telling
 * how one is written.
 */
export function JournalList({
  acts,
  beat,
  writeNow,
  writeDay,
  onOpen,
}: {
  acts: readonly Activity[]
  /** bumped by the room when the record changed elsewhere — see `beat` on Timer */
  beat?: number
  /** bumped when ✎ Note was pressed with nothing running, so the box below is where the cursor is */
  writeNow?: number
  /**
   * The day the box writes ABOUT when ✎ Note brought you here — a past day from that day's log,
   * or nothing for today. Read when `writeNow` moves, and let go after a save, so the next note
   * is about today unless you come back the same way.
   */
  writeDay?: string
  onOpen: (row: JournalRow & { sat: string }, sitting: Entry) => void
}) {
  const [days, setDays] = useState(STEP_DAYS)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [dayNotes, setDayNotes] = useState<DayNote[]>([])
  const [q, setQ] = useState('')
  /* this list's own writes, which `beat` does not hear about */
  const [mine, setMine] = useState(0)
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* the day note being changed, and what it says so far */
  const [fixing, setFixing] = useState<{ id: string; body: string } | null>(null)
  /* the day the box is writing about, when it is not today */
  const [about, setAbout] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

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
    void Promise.all([
      entriesBetween(new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
      dayNotesBetween(localISO(new Date(fromMs)), localISO(new Date(toMs))),
    ]).then(([e, n]) => {
      if (mark !== seq.current) return
      setEntries(e)
      setDayNotes(n)
    })
  }, [fromMs, toMs, beat, mine])

  useEffect(() => {
    if (!writeNow) return
    setAbout(writeDay && writeDay !== localISO(new Date()) ? writeDay : null)
    box.current?.focus()
    /* ⚠️ ON THE BUMP ALONE: `writeDay` arrives with it, and a later change to it on its own is the
       room moving on, not a request to write about that day */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [writeNow])

  const rows = useMemo(
    () => (entries ? journalRows(entries, fromMs, toMs, dayNotes) : []),
    [entries, fromMs, toMs, dayNotes],
  )
  const shown = useMemo(() => matching(rows, q, acts), [rows, q, acts])
  const name = useMemo(() => new Map(acts.map((a) => [a.id, a.name])), [acts])
  const sittingOf = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  /* the preposition travels with the phrase, so every sentence that uses it reads */
  const span = `in the last ${days} days`

  /**
   * ⚠️ A REFUSAL STAYS ON SCREEN WITH THE WORDS STILL IN THE BOX. What somebody was writing is the
   * one thing here that cannot be got back, so a failed save keeps it and says why, rather than
   * clearing the box and leaving them to wonder whether it went.
   */
  const write = async () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    const bad = await addDayNote(about ?? today, draft)
    setBusy(false)
    if (bad) {
      setSaid(bad.why.charAt(0).toUpperCase() + bad.why.slice(1))
      return
    }
    setDraft('')
    setSaid(null)
    setAbout(null)
    setMine((n) => n + 1)
  }

  /* ⚠️ an emptied note is deleted — chronicle_note_edit's own rule, and the hint says so */
  const keep = async () => {
    if (!fixing || busy) return
    setBusy(true)
    const bad = await editNote(fixing.id, fixing.body)
    setBusy(false)
    if (bad) {
      setSaid(bad.why.charAt(0).toUpperCase() + bad.why.slice(1))
      return
    }
    setFixing(null)
    setSaid(null)
    setMine((n) => n + 1)
  }

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

      {/**
       * ⚠️ NO SESSION NEEDED, AND IT SAYS SO IN WORDS. "Writing a note must not require starting a
       * timer": until now every note hung off a session, so the only way to write something down
       * was to time something first. The line under the box is the privacy rule, said where the
       * words are typed — a journal people are not sure about is a journal people do not write in.
       */}
      <div className="chron-journal-write">
        <label htmlFor="chron-journal-new" className="sr-only">
          {about
            ? `Write something down about ${aboutDay(about, today)}`
            : 'Write something down for today'}
        </label>
        <textarea
          id="chron-journal-new"
          ref={box}
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder={
            about
              ? `Write something down about ${aboutDay(about, today)}…`
              : 'Write something down for today…'
          }
        />
        <div className="chron-journal-write-row">
          {about ? (
            <span className="muted">
              About {aboutDay(about, today)}.{' '}
              <button
                type="button"
                className="btn btn-ghost chron-journal-today"
                onClick={() => setAbout(null)}
              >
                Write about today instead
              </button>
            </span>
          ) : (
            <span className="muted">Only you can read these. No session needed.</span>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy || !draft.trim()}
            onClick={() => void write()}
          >
            Save
          </button>
        </div>
        {said && (
          <p className="chron-journal-said" role="alert">
            {said}
          </p>
        )}
      </div>

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          Nothing written {span}. Write something above, or use <strong>✎ Note</strong> beside Stop
          to write about the session running now.
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
                if (r.entry === null) {
                  /* a day's note: changed here, because it has nowhere else to open */
                  if (fixing?.id === r.id) {
                    return (
                      <li key={r.id} className="chron-journal-fix">
                        <label htmlFor={`chron-fix-${r.id}`} className="sr-only">
                          Change this note
                        </label>
                        <textarea
                          id={`chron-fix-${r.id}`}
                          rows={3}
                          maxLength={4000}
                          autoFocus
                          value={fixing.body}
                          onChange={(ev) => setFixing({ id: r.id, body: ev.target.value })}
                        />
                        <div className="chron-journal-write-row">
                          <span className="muted">Empty it and save to delete it.</span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setFixing(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => void keep()}
                          >
                            Save
                          </button>
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="chron-journal-row"
                        onClick={() => setFixing({ id: r.id, body: r.body })}
                      >
                        <span className="chron-journal-meta">
                          <time dateTime={r.at}>{clock(r.at)}</time>
                          {' · a note'}
                          {/* written on another day than the one it is about — say so */}
                          {localISO(new Date(r.at)) !== r.day
                            ? ` · written ${dayName(localISO(new Date(r.at)), today)}`
                            : ''}
                        </span>
                        <span className="chron-journal-body">{r.body}</span>
                      </button>
                    </li>
                  )
                }
                const e = sittingOf.get(r.entry)
                const sat = r.sat ?? r.day
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="chron-journal-row"
                      disabled={!e}
                      onClick={() => e && onOpen({ ...r, sat }, e)}
                    >
                      <span className="chron-journal-meta">
                        <time dateTime={r.at}>{clock(r.at)}</time>
                        {' · '}
                        {(r.activity && name.get(r.activity)) ?? 'something'}
                        {/* ⚠️ WHEN THE SITTING WAS ANOTHER DAY, SAY WHICH — the row opens there,
                            and a tap that jumps to Monday from a heading that says Thursday
                            should not be a surprise */}
                        {sat !== r.day ? ` · from ${dayName(sat, today)}` : ''}
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
