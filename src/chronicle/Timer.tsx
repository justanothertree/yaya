import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEntry,
  archiveActivity,
  dropEntry,
  editEntry,
  fixRunning,
  setAmount,
  setQuality,
  entriesBetween,
  myActivities,
  saveActivity,
  startTimer,
  stopTimer,
} from './cloud'
import { today as todayISO } from './goal'
import { Plans } from './Plans'
import { Routines } from './Routines'
import {
  CATS,
  clockText,
  dayBounds,
  localMidnight,
  minutesByActivity,
  minutesByCat,
  amountIn,
  metSession,
  moodWord,
  MOODS,
  overlapMs,
  spanText,
  type Activity,
  type Entry,
} from './record'

/**
 * The timer, and the day it is writing into.
 *
 * ⚠️ THE RUNNING TIMER IS A ROW, NOT A PIECE OF STATE. There is no local copy: the open entry in
 * the database is the timer, which is what makes it survive a closed tab and turn up on the phone.
 * So this component holds no notion of "started at" of its own — it reads the open entry and
 * counts from its `start`, and a reload mid-session shows the same number it would have shown.
 *
 * ⚠️ WHICH MEANS THE ONE-SECOND TICK IS COSMETIC. It re-renders a clock face off a timestamp the
 * server owns; nothing is accumulated here, so a tab that was asleep for an hour is right the
 * moment it wakes rather than an hour behind.
 */
/** a day either side, by local calendar arithmetic rather than by adding hours */
const dayStep = (iso: string, by: number): string => {
  const d = localMidnight(iso)
  d.setDate(d.getDate() + by)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const niceDay = (iso: string) =>
  localMidnight(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

export function Timer({ day, onChange }: { day: string; onChange?: () => void }) {
  /**
   * The day being looked at, which is not always the day the room asked for.
   *
   * ⚠️ YOU COULD NOT LOOK AT YESTERDAY, which for a record is most of the point missing. The views
   * are all "this something" — today, tomorrow, this week — so an ordinary question like "what did
   * I do on Friday" had no way to be asked at all. A stepper here opens every day that was ever
   * recorded without adding a view for each one.
   *
   * ⚠️ AND IT FOLLOWS THE ROOM WHEN THE ROOM MOVES. Switching the tab from Today to Tomorrow has
   * to win over wherever the stepper had wandered to, or the two controls would disagree about
   * which day is on screen and the room would be showing a date nothing had named.
   */
  const [seeing, setSeeing] = useState(day)
  useEffect(() => setSeeing(day), [day])
  const [acts, setActs] = useState<Activity[] | null>(null)
  const [log, setLog] = useState<Entry[]>([])
  const [pick, setPick] = useState('')
  const [say, setSay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState<Activity['cat']>('free')
  const [newMetric, setNewMetric] = useState('')
  const [newSession, setNewSession] = useState('')
  const [gap, setGap] = useState(false)
  /** what you were doing, written down as you stop — the field the table has always had */
  const [stopNote, setStopNote] = useState('')
  const [gapFrom, setGapFrom] = useState('')
  const [gapTo, setGapTo] = useState('')
  /**
   * Which activity the gap is for.
   *
   * ⚠️ ITS OWN, RATHER THAN THE TOP PICKER'S, because the top picker is not always there. While a
   * timer is running the picker is replaced by the name of what you are doing — so Fill a gap read
   * "Add to the picked activity", could not say which, and answered a press with "pick an activity
   * first": an instruction you cannot follow, because the room had removed the means. A form that
   * needs a thing has to carry the control for it.
   */
  const [gapAct, setGapAct] = useState('')
  /**
   * Which activity and which span are being edited, if any.
   *
   * ⚠️ INLINE RATHER THAN IN A DIALOG, and the reason is what they are for. Both of these are
   * repairs made while you are looking at the thing that is wrong — "that says Free Time and it
   * should say Life", "that ran for four hours because I forgot to stop it" — so the fix belongs
   * in the row rather than behind a button that covers it up.
   */
  const [fixAct, setFixAct] = useState<string | null>(null)
  const [actName, setActName] = useState('')
  const [actCat, setActCat] = useState<Activity['cat']>('free')
  /** what this activity counts besides time — "pages", "reps", blank for nothing */
  const [actMetric, setActMetric] = useState('')
  /** how long a sitting of it ought to be, in minutes — blank for no opinion */
  const [actSession, setActSession] = useState('')
  /** the amount being typed against a span, keyed by entry id */
  const [entAmount, setEntAmount] = useState('')
  /** how the span being edited went, '' for unrated — see Entry.quality */
  const [entMood, setEntMood] = useState('')
  const [fixEnt, setFixEnt] = useState<string | null>(null)
  const [entAct, setEntAct] = useState('')
  const [entNote, setEntNote] = useState('')
  const [entFrom, setEntFrom] = useState('')
  const [entTo, setEntTo] = useState('')
  /* a tick purely so the clock face moves — see the note above */
  const [, setBeat] = useState(0)
  const live = useRef(false)

  const bounds = useMemo(() => dayBounds(seeing), [seeing])

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([
      myActivities(),
      /* ⚠️ the day's own bounds, widened by nothing: the server returns anything OVERLAPPING the
         range, so a session that began before midnight is already included */
      entriesBetween(new Date(bounds.fromMs).toISOString(), new Date(bounds.toMs).toISOString()),
    ])
    setActs(a)
    setLog(e)
  }, [bounds.fromMs, bounds.toMs])

  useEffect(() => {
    void load()
  }, [load])

  const running = log.find((e) => e.end == null) ?? null
  live.current = !!running

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setBeat((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [running])

  const byId = useMemo(() => new Map((acts ?? []).map((a) => [a.id, a])), [acts])
  const open = useMemo(() => (acts ?? []).filter((a) => !a.archived), [acts])
  const mins = useMemo(
    () => minutesByActivity(log, bounds.fromMs, bounds.toMs, Date.now()),
    [log, bounds.fromMs, bounds.toMs],
  )
  /**
   * The handful worth a button of their own.
   *
   * ⚠️ ORDERED BY WHAT YOU HAVE DONE TODAY, then by name — so the list settles into your actual
   * habits rather than the order you happened to create things in, and the first button is
   * usually the right one. Six, because a seventh wraps the row on a phone and a row of buttons
   * that wraps has stopped reading as a shortcut.
   */
  const quick = useMemo(
    () =>
      [...open]
        .filter((a) => !a.auto)
        .sort((x, y) => (mins[y.id] ?? 0) - (mins[x.id] ?? 0) || x.name.localeCompare(y.name))
        .slice(0, 6),
    [open, mins],
  )
  const cats = useMemo(
    () => minutesByCat(log, acts ?? [], bounds.fromMs, bounds.toMs, Date.now()),
    [log, acts, bounds.fromMs, bounds.toMs],
  )

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const after = async () => {
    await load()
    onChange?.()
  }

  const go = async (id: string) => {
    if (busy || !id) return
    setBusy(true)
    const bad = await startTimer(id)
    setBusy(false)
    if (bad) return moan(bad.why)
    await after()
  }

  /* ⚠️ blank and nonsense both mean "no opinion", never zero — see Activity.session */
  const asMins = (typed: string): number | null => {
    const n = Number(typed)
    return typed.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }

  const halt = async () => {
    if (busy) return
    setBusy(true)
    /**
     * ⚠️ THE NOTE GOES IN ON THE WAY OUT, which is the only moment anybody knows what to write.
     * `chronicle_stop` has taken one since step 2 and this passed null — so the column existed,
     * the function stored it, the log rendered it, and there was no way to put anything in it.
     */
    /**
     * ⚠️ MEASURED BEFORE THE STOP, because afterwards the running entry is gone and finding it
     * again means guessing which of the day's rows was the one that just ended.
     */
    const was = running
    const target = was ? (byId.get(was.activity)?.session ?? null) : null
    const ran = was ? overlapMs(was, -Infinity, Infinity, Date.now()) : 0
    const bad = await stopTimer(stopNote.trim() || null)
    setBusy(false)
    if (bad) return moan(bad.why)
    setStopNote('')
    await after()
    /* ⚠️ SAID ONCE, AFTER THE FACT, and not a confirmation beforehand: this is a note about what
       happened, not a gate on stopping. Somebody who wants to stop at twelve minutes is allowed
       to, and being asked to justify it would make the feature something to turn off. */
    if (target != null && ran > 0 && ran / 60_000 < target)
      moan(
        `${spanText(ran)} — under the ${spanText(target * 60_000)} you aim for on ${byId.get(was!.activity)?.name ?? 'that'}.`,
      )
  }

  const makeActivity = async () => {
    const n = newName.trim()
    if (!n || busy) return
    setBusy(true)
    const r = await saveActivity(n, newCat, null, undefined, newMetric, asMins(newSession))
    setBusy(false)
    if ('why' in r) return moan(r.why)
    setNewName('')
    setNewMetric('')
    setNewSession('')
    setAdding(false)
    await load()
    /* ⚠️ a new activity is almost always one you are about to do, so it is pre-selected rather
       than leaving somebody to find it in a list they just added to */
    setPick(r.id)
  }

  const fillGap = async () => {
    if (!gapAct) return moan('which activity was it?')
    if (!gapFrom || !gapTo) return moan('both ends of the span, please')
    setBusy(true)
    const bad = await addEntry(
      gapAct,
      new Date(gapFrom).toISOString(),
      new Date(gapTo).toISOString(),
      null,
    )
    setBusy(false)
    if (bad) return moan(bad.why)
    setGap(false)
    setGapFrom('')
    setGapTo('')
    await after()
  }

  const saveAct = async () => {
    const n = actName.trim()
    if (!fixAct || !n || busy) return
    setBusy(true)
    /* ⚠️ the same function that creates one, given an id — chronicle_activity_save has taken an
       id since step 2 and nothing had ever passed one, which is why a category was permanent */
    const r = await saveActivity(n, actCat, null, fixAct, actMetric, asMins(actSession))
    setBusy(false)
    if ('why' in r) return moan(r.why)
    setFixAct(null)
    await after()
  }

  /**
   * ⚠️ LOCAL TIME IN, ISO OUT. A `datetime-local` input gives "2026-10-12T21:30" with no zone,
   * which `new Date()` reads as LOCAL — correct here, and the one case where parsing a date string
   * is right rather than the UTC trap, because the string genuinely has no zone in it.
   */
  const saveEnt = async (metric?: string | null) => {
    if (!fixEnt || !entFrom || busy) return
    /**
     * ⚠️ THE ONE STILL GOING TAKES A DIFFERENT CALL, because it has no end to send and nothing
     * should give it one — that is what Stop is for. Everything else on the row is set after a
     * session finishes, so the running editor offers exactly the two things you notice while you
     * are working: what it is, and when it began. See chronicle_running_fix.
     */
    const running = log.find((e) => e.id === fixEnt)?.end == null
    if (running) {
      setBusy(true)
      const no = await fixRunning(new Date(entFrom).toISOString(), entAct || null)
      setBusy(false)
      if (no) return moan(no.why)
      setFixEnt(null)
      await after()
      return
    }
    if (!entTo) return
    setBusy(true)
    const bad = await editEntry(
      fixEnt,
      new Date(entFrom).toISOString(),
      new Date(entTo).toISOString(),
      /* ⚠️ THE NOTE IT ALREADY HAS, not null. This argument was hard-coded null, and the server
         read null as "clear it" — so opening a session's editor and pressing Save, changing
         nothing, destroyed whatever you had written about it. The server now reads null as "leave
         it alone" so no caller can lose one by forgetting; this sends the box, so you can change
         one or empty it on purpose. */
      entNote.trim(),
      /* ⚠️ which activity it WAS, because pressing Start on the wrong one is the likeliest
         mistake this room allows and the only remedy used to be deleting the session and typing
         it in again — losing the amount, the rating and the day it was recorded. */
      entAct || null,
    )
    /**
     * ⚠️ THE AMOUNT IS A SECOND CALL, and only when the activity has something to count. It is a
     * separate function on the server for a reason the migration records — three signatures would
     * have had to change otherwise — so the UI pays one extra round trip on an edit rather than
     * the whole write path paying for a field most sessions do not have.
     */
    if (!bad && metric) {
      const n = Number(entAmount)
      await setAmount(fixEnt, entAmount.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n)
    }
    /* ⚠️ a third call on an edit, for the same reason the amount is a second one — see setQuality.
       Only when it CHANGED, so the common case of nudging a timestamp stays two round trips. */
    if (!bad) {
      const was = log.find((e) => e.id === fixEnt)?.quality ?? null
      const now = entMood === '' ? null : Number(entMood)
      if (was !== now) await setQuality(fixEnt, now)
    }
    setBusy(false)
    if (bad) return moan(bad.why)
    setFixEnt(null)
    await after()
  }

  /** what a datetime-local input wants: local time, no zone, to the minute */
  const forInput = (iso: string): string => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  /**
   * ⚠️ IT ASKS ABOUT THE WHOLE SESSION, BECAUSE THAT IS WHAT IT DELETES. The day list shows a
   * straddling session's OVERLAP with the day you are looking at, so this read "Delete the 30m of
   * Writing?" for a session that was 1h 30m and then removed all of it, including the hour sitting
   * on yesterday's screen. A confirmation that understates what it does is worse than none: it is
   * the one moment somebody is deciding, and it was answering a different question.
   */
  /**
   * Where the gap form starts, so nobody types four fields on a phone.
   *
   * ⚠️ IT OPENED COMPLETELY EMPTY, which made repairing the commonest hole in any log — "I did
   * that and forgot to press Start" — into two full datetimes typed from scratch on a touch
   * keyboard. The two rules here are the two halves of what a gap actually is:
   *
   * - the END is now, when you are looking at today, because that is when you noticed. On a past
   *   day there is no "now" in it, so it is that day's last session, or midday if the day is bare.
   * - the START is the end of the last session before that — the gap IS the unlogged stretch — and
   *   an hour back when there is nothing to butt against.
   *
   * Both are clamped into the day on screen, so the form can never open describing a span the day
   * you are looking at does not contain.
   */
  const gapOpens = (): { from: string; to: string } => {
    const now = Date.now()
    const onToday = seeing === todayISO()
    /* a minute inside the end, so "the whole of this day" never rounds into the next one */
    const dayEnd = bounds.toMs - 60_000
    const ends = log
      .filter((e) => e.end != null)
      .map((e) => Date.parse(e.end!))
      .filter((t) => Number.isFinite(t) && t > bounds.fromMs && t <= dayEnd)
    /* ⚠️ `ends.length ?` rather than `Math.max(...ends, -Infinity)`, which returns -Infinity for
       an empty day — and -Infinity is truthy, so a `||` fallback behind it never fires and
       `new Date(-Infinity).toISOString()` throws. An empty past day would have opened this form
       by crashing the room. */
    const lastEnd = ends.length ? Math.max(...ends) : null
    const to = Math.min(dayEnd, onToday ? now : (lastEnd ?? bounds.fromMs + 12 * 3_600_000))
    const before = ends.filter((t) => t < to)
    const from = Math.max(bounds.fromMs, before.length ? Math.max(...before) : to - 3_600_000)
    /**
     * ⚠️ A MINIMUM LENGTH, NOT MERELY A FORWARD ONE. The first guard here asked `from < to`, which
     * a span of four seconds satisfies — and when the last session ended moments ago that is
     * exactly what came out: the form opened with both ends reading 00:41, a default that is
     * either refused or records nothing. "Butt it against the last session" needs the last session
     * to be a while ago; five minutes is the line below which the gap is not the thing you are
     * describing.
     */
    const safe = to - from >= 5 * 60_000 ? from : Math.max(bounds.fromMs, to - 3_600_000)
    return {
      from: forInput(new Date(safe).toISOString()),
      to: forInput(new Date(to).toISOString()),
    }
  }

  const forget = async (e: Entry) => {
    const name = byId.get(e.activity)?.name ?? 'that'
    const here = overlapMs(e, bounds.fromMs, bounds.toMs, Date.now())
    /* an unbounded window, so the whole span comes back — and a running one still measures to
       the clock, and a backwards or unreadable one still comes back as zero, for free */
    const all = overlapMs(e, -Infinity, Infinity, Date.now())
    /* ⚠️ a minute of slack rather than `!==`: a session can poke a few seconds past midnight and
       "1h 30m of which 1h 30m is on this day" is a sentence about nothing */
    const spans = all - here > 60_000
    if (
      !window.confirm(
        spans
          ? `Delete the whole ${spanText(all)} of ${name}? It runs past this day — only ${spanText(here)} of it is here.`
          : `Delete the ${spanText(here)} of ${name}?`,
      )
    )
      return
    setBusy(true)
    await dropEntry(e.id)
    setBusy(false)
    await after()
  }

  if (acts === null) {
    return (
      <p className="muted" aria-busy>
        Loading the record…
      </p>
    )
  }

  return (
    <div className="chron-rec">
      {/**
       * ⚠️ TODAY IS NAMED RATHER THAN DATED, because "Today" is what anybody calls it and a date
       * where the word should be makes you work out whether it is the word. Every other day gets
       * its date, which is the only thing that identifies it.
       */}
      <div className="chron-day">
        <button
          className="btn btn-ghost"
          onClick={() => setSeeing(dayStep(seeing, -1))}
          aria-label="The day before"
          title="The day before"
        >
          ‹
        </button>
        <strong>
          {seeing === todayISO()
            ? 'Today'
            : seeing === dayStep(todayISO(), 1)
              ? 'Tomorrow'
              : seeing === dayStep(todayISO(), -1)
                ? 'Yesterday'
                : niceDay(seeing)}
        </strong>
        <button
          className="btn btn-ghost"
          onClick={() => setSeeing(dayStep(seeing, 1))}
          aria-label="The day after"
          title="The day after"
        >
          ›
        </button>
        {seeing !== todayISO() && (
          <button className="btn btn-ghost" onClick={() => setSeeing(todayISO())}>
            back to today
          </button>
        )}
      </div>
      <div className="chron-timer">
        {running ? (
          <>
            <span className="chron-run" aria-live="off">
              {clockText(Date.now() - Date.parse(running.start))}
            </span>
            <span className="chron-run-name">
              {byId.get(running.activity)?.name ?? 'something'}
            </span>
            <label className="chron-note">
              <span className="sr-only">What are you doing? (optional)</span>
              <input
                value={stopNote}
                placeholder="a note, if you like"
                onChange={(e) => setStopNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void halt()}
              />
            </label>
            <button className="btn" disabled={busy} onClick={() => void halt()}>
              ■ Stop
            </button>
          </>
        ) : seeing !== todayISO() ? (
          /* ⚠️ a timer runs in the present or not at all. On another day the controls would be a
             lie — there is nothing to time — so the day offers the repair tools instead. */
          <span className="muted">
            Looking back. Use ⏱ Fill a gap to add time, or go back to today to start a timer.
          </span>
        ) : (
          <>
            <label className="chron-pickrow">
              <span className="sr-only">What are you doing?</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Pick an activity…</option>
                {CATS.map(([cat, label]) => {
                  const inCat = open.filter((a) => a.cat === cat)
                  return inCat.length ? (
                    <optgroup key={cat} label={label}>
                      {inCat.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null
                })}
              </select>
            </label>
            <button className="btn" disabled={!pick || busy} onClick={() => void go(pick)}>
              ▶ Start
            </button>
          </>
        )}
        <button className="btn btn-ghost" onClick={() => setAdding((v) => !v)}>
          ＋ Activity
        </button>
        {/**
         * ⚠️ NOTHING TO FILL A GAP WITH UNTIL AN ACTIVITY EXISTS. On a fresh account this opened a
         * form with an empty picker and an "Add it" that could never enable — a dead form that
         * explains nothing, on the one screen where somebody has the least idea what to do. Start
         * beside it has always been disabled for the same reason; this was not, and the first
         * walk through the room as a new member is what found it.
         */}
        <button
          className="btn btn-ghost"
          disabled={!(acts ?? []).some((a) => !a.archived)}
          title={(acts ?? []).some((a) => !a.archived) ? undefined : 'Name an activity first'}
          onClick={() => {
            const next = !gap
            setGap(next)
            if (next) {
              const o = gapOpens()
              setGapFrom(o.from)
              setGapTo(o.to)
              /* ⚠️ the top picker's choice when there is one, and what you are doing otherwise —
                 but never blank, because a select nobody notices is the dead end all over again */
              setGapAct(
                pick || running?.activity || (acts ?? []).find((a) => !a.archived)?.id || '',
              )
            }
          }}
        >
          ⏱ Fill a gap
        </button>
      </div>

      {/**
       * ⚠️ ONE TAP FOR THE THING YOU ACTUALLY DO, because starting a timer is the most repeated
       * action in the room and it cost two: open a dropdown, find the name, press Start. These are
       * the same activities the picker holds, in the order you have used them today, so the one
       * you want is almost always the first.
       *
       * ⚠️ AND NOT THE SITE-WRITTEN ONES. "Paint" as an auto activity means the room was open; a
       * button that started a timer on it would be recording something the site is already
       * recording, twice over.
       */}
      {!running && seeing === todayISO() && quick.length > 0 && (
        <div className="chron-quick">
          <span className="muted">or just</span>
          {quick.map((a) => (
            <button
              key={a.id}
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void go(a.id)}
            >
              ▶ {a.name}
            </button>
          ))}
        </div>
      )}

      {adding && (
        <div className="chron-add">
          <label>
            <span className="sr-only">Name it</span>
            <input
              autoFocus
              value={newName}
              placeholder="Drawing"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void makeActivity()}
            />
          </label>
          <label>
            <span className="sr-only">Which kind</span>
            <select value={newCat} onChange={(e) => setNewCat(e.target.value as Activity['cat'])}>
              {CATS.map(([c, label]) => (
                <option key={c} value={c}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {/* ⚠️ OPTIONAL AND LAST, because most activities are measured in time alone and a
              required field would make everybody answer a question that is usually "nothing" */}
          <label className="chron-qty">
            <span className="sr-only">Also counts (optional)</span>
            <input
              value={newMetric}
              placeholder="pages?"
              onChange={(e) => setNewMetric(e.target.value)}
            />
          </label>
          {/* ⚠️ "a sitting?" rather than "minutes", because the question is how long one GO of this
              ought to be — a box labelled minutes beside a box labelled pages is two optional
              numbers nobody can tell apart */}
          <label className="chron-qty">
            <span className="sr-only">How long should one sitting be, in minutes</span>
            <input
              value={newSession}
              inputMode="numeric"
              placeholder="30m a sitting?"
              onChange={(e) => setNewSession(e.target.value)}
            />
          </label>
          <button
            className="btn"
            disabled={!newName.trim() || busy}
            onClick={() => void makeActivity()}
          >
            Add
          </button>
          <button className="btn btn-ghost" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}

      {gap && (
        <div className="chron-add">
          <label className="chron-gap">
            <span className="sr-only">Which activity</span>
            <select value={gapAct} onChange={(e) => setGapAct(e.target.value)}>
              {(acts ?? [])
                .filter((a) => !a.archived || a.id === gapAct)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="chron-gap">
            <span className="sr-only">From when</span>
            <input
              type="datetime-local"
              value={gapFrom}
              onChange={(e) => setGapFrom(e.target.value)}
            />
          </label>
          <label className="chron-gap">
            <span className="sr-only">Until when</span>
            <input type="datetime-local" value={gapTo} onChange={(e) => setGapTo(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || !gapAct} onClick={() => void fillGap()}>
            Add it
          </button>
          <button className="btn btn-ghost" onClick={() => setGap(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* ⚠️ the three categories, which is the reading the whole thing exists for — and zero is
          shown as nothing rather than as "0m", because a day with no upkeep in it is not news */}
      {Object.keys(cats).length > 0 && (
        <p className="chron-cats">
          {CATS.map(([c, label]) =>
            cats[c] ? (
              <span key={c} className={'chron-cat is-' + c}>
                {label} {spanText(cats[c] * 60_000)}
              </span>
            ) : null,
          )}
        </p>
      )}

      {log.length > 0 && (
        <ul className="chron-log">
          {log.map((e) => {
            const a = byId.get(e.activity)
            const ms = overlapMs(e, bounds.fromMs, bounds.toMs, Date.now())
            const amt = amountIn(e, bounds.fromMs, bounds.toMs)
            return (
              <li key={e.id} className={'chron-ent' + (e.end == null ? ' is-live' : '')}>
                <span className="chron-ent-name">{a?.name ?? 'an activity since deleted'}</span>
                <span className="chron-ent-span">{spanText(ms)}</span>
                {/* ⚠️ the amount sits with the length because they are the same fact measured two
                    ways — "40m, 4 pages" is one session, and separating them would invite reading
                    the number as a second entry.
                    ⚠️ AND `amountIn` RATHER THAN `e.amount != null`, which showed it on both of
                    the days a session straddles. See amountIn — the minutes split at midnight and
                    the quantity does not. */}
                {amt != null && a?.metric ? (
                  <span className="chron-amount">
                    {amt} {a.metric}
                  </span>
                ) : null}
                {/* ⚠️ THE WORD, NOT THE NUMBER. "good" is readable without a legend; "4" needs one,
                    and a log is skimmed. The exact rating is kept where it is set — see moodWord,
                    whose test asserts this word and the month's buckets are the same rule. */}
                {/**
                 * ⚠️ ONLY WHEN IT FINISHED SHORT, never while it runs — see metSession, which
                 * returns null rather than false for a sitting still going. A reproach on screen
                 * for the first half of every session is the opposite of what this is for.
                 */}
                {metSession(e, a?.session ?? null, Date.now()) === false ? (
                  <span
                    className="chron-short"
                    title={`Shorter than the ${a?.session}m you aim for`}
                  >
                    short
                  </span>
                ) : null}
                {moodWord(e.quality) ? (
                  <span className={'chron-mood is-' + moodWord(e.quality)}>
                    {moodWord(e.quality)}
                  </span>
                ) : null}
                {/* ⚠️ last of the facts, because it is the only one that can be a sentence — the
                    others are a word or a number and keep their place in the row. A plan's note
                    has been shown beside its plan all along; this is the same thing for a
                    session, which had been written and never read. */}
                {e.note ? <span className="muted chron-ent-note">{e.note}</span> : null}
                <span className="muted chron-ent-when">
                  {new Date(e.start).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {e.end
                    ? ` – ${new Date(e.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                    : ' – now'}
                </span>
                {fixEnt === e.id && (
                  <span className="chron-fix">
                    {/**
                     * ⚠️ WHAT IT WAS COMES BEFORE WHEN IT WAS, which is the order the mistake
                     * happens in: you notice you timed the wrong thing, not that you timed the
                     * wrong hour. The list is the activities you have open, plus this session's
                     * own if it has since been archived — otherwise the control could not show
                     * its own current value, and opening the editor would silently propose
                     * moving the session somewhere else.
                     */}
                    <label className="chron-src">
                      <span className="sr-only">What this was</span>
                      <select value={entAct} onChange={(ev) => setEntAct(ev.target.value)}>
                        {[...open, ...(a && a.archived ? [a] : [])].map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="chron-gap">
                      <span className="sr-only">Started</span>
                      <input
                        type="datetime-local"
                        value={entFrom}
                        onChange={(ev) => setEntFrom(ev.target.value)}
                      />
                    </label>
                    {/* ⚠️ no end, no amount, no rating and no note while it is still going:
                        the end is Stop's to write, and the other three are things you say about a
                        session once you know how it went */}
                    {e.end && (
                      <label className="chron-gap">
                        <span className="sr-only">Ended</span>
                        <input
                          type="datetime-local"
                          value={entTo}
                          onChange={(ev) => setEntTo(ev.target.value)}
                        />
                      </label>
                    )}
                    {/* ⚠️ only for an activity that has a metric: a box asking for a number with
                        no unit is a box nobody can answer — and it follows the activity SELECTED
                        above rather than the one the session used to be, so moving a session onto
                        something that counts nothing takes the box away with it */}
                    {e.end && byId.get(entAct)?.metric && (
                      <label className="chron-qty">
                        <span className="sr-only">How many {byId.get(entAct)?.metric}</span>
                        <input
                          value={entAmount}
                          inputMode="decimal"
                          placeholder={byId.get(entAct)?.metric ?? ''}
                          onChange={(ev) => setEntAmount(ev.target.value)}
                        />
                      </label>
                    )}
                    {/**
                     * ⚠️ ONE CONTROL, NOT FIVE BUTTONS. A row of stars is five targets on a line
                     * that already carries two datetimes and a number, and the room has just been
                     * through what crowding does to it. A select is one tap to open and one to
                     * choose, and it can say the WORD beside the number — "4 good" rather than a
                     * rank nobody has a legend for.
                     */}
                    {e.end && (
                      <label className="chron-src">
                        <span className="sr-only">How did it go?</span>
                        <select value={entMood} onChange={(ev) => setEntMood(ev.target.value)}>
                          <option value="">not rated</option>
                          {MOODS.map(([n, word]) => (
                            <option key={n} value={String(n)}>
                              {n} {word}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {/**
                     * ⚠️ THE NOTE WAS WRITE-ONLY UNTIL NOW. There has been a box for one at Stop
                     * since the room was built, and nothing on the page ever showed it back — a
                     * plan's note is rendered beside the plan, a session's was not. So it could be
                     * written, never read, and then quietly destroyed by the first edit. It is
                     * shown in the row above, and editable here.
                     */}
                    {e.end && (
                      <label className="chron-note-fix">
                        <span className="sr-only">A note about this session</span>
                        <input
                          value={entNote}
                          placeholder="a note, if you like"
                          onChange={(ev) => setEntNote(ev.target.value)}
                        />
                      </label>
                    )}
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => void saveEnt(byId.get(entAct)?.metric)}
                    >
                      Save
                    </button>
                    <button className="btn btn-ghost" onClick={() => setFixEnt(null)}>
                      Cancel
                    </button>
                  </span>
                )}
                {/* ⚠️ THE BUTTONS ARE A GROUP, like the plan row's. As loose siblings of a
                    wrapping row they split across lines — one row dropped its ✕ alone onto the
                    next line while another wrapped part way through its facts, which reads as a
                    broken layout rather than a deliberate one. */}
                <span className="chron-ent-do">
                  {/**
                   * ⚠️ IT USED TO SAY "only a finished span can be edited: the editor needs both
                   * ends, and the running one is closed with Stop rather than by typing a time
                   * into it". The second half still holds and is why there is no end box below
                   * for a running one — but the first half was a consequence of the editor's
                   * shape rather than a decision, and it left the two mistakes you notice WHILE
                   * WORKING with no remedy but pressing Stop.
                   */}
                  <button
                    className="btn btn-ghost chron-x"
                    onClick={() => {
                      setFixEnt(fixEnt === e.id ? null : e.id)
                      setEntAct(e.activity)
                      setEntNote(e.note ?? '')
                      setEntFrom(forInput(e.start))
                      setEntTo(e.end ? forInput(e.end) : '')
                      setEntAmount(e.amount == null ? '' : String(e.amount))
                      setEntMood(e.quality == null ? '' : String(e.quality))
                    }}
                    aria-label="Change this session"
                    title="Change this session"
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-ghost chron-x"
                    onClick={() => void forget(e)}
                    aria-label="Delete this span"
                    title="Delete this span"
                  >
                    ✕
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!log.length && <p className="muted">Nothing recorded for this day yet.</p>}

      {/**
       * ⚠️ EVERY DAY, NOT JUST TODAY — unlike Routines above, which is today-only because running a
       * step means starting a timer. Planning is the opposite: the day it is most wanted for is
       * tomorrow, and the stepper already goes there and already says "Tomorrow".
       *
       * ⚠️ AND IT IS HANDED THE DAY'S ENTRIES rather than fetching them. The comparison has to be
       * about the same list the log above is drawn from — two queries for one day's record is two
       * chances to show a plan beaten by work the list above does not mention.
       */}
      {acts !== null && (
        <Plans acts={acts} log={log} bounds={bounds} onChange={after} busy={busy} />
      )}

      {/**
       * ⚠️ ROUTINES SIT WITH THE ACTIVITIES, not above the timer. A routine is a thing you reach
       * for at the start of a stretch and then forget about, so it earns a fold rather than a
       * permanent row — the same judgement the activity list makes.
       *
       * ⚠️ AND IT IS HANDED TODAY'S MINUTES rather than fetching them. That is what makes a step
       * look done, and the room already has the number: a second query for it would be a second
       * answer to how long you spent on something today.
       */}
      {seeing === todayISO() && (
        <details className="chron-tidy">
          <summary>Routines</summary>
          <Routines acts={acts ?? []} mins={mins} onStart={(id) => void go(id)} busy={busy} />
        </details>
      )}
      {/* archiving lives with the totals rather than in a settings screen: the moment you notice
          an activity is finished with is the moment you are looking at a day without it in */}
      {open.length > 0 && (
        <details className="chron-tidy">
          <summary>Activities</summary>
          <ul className="chron-acts">
            {(acts ?? []).map((a) =>
              fixAct === a.id ? (
                <li key={a.id} className="chron-fix">
                  <label>
                    <span className="sr-only">Name</span>
                    <input value={actName} onChange={(e) => setActName(e.target.value)} />
                  </label>
                  <label>
                    <span className="sr-only">Which kind</span>
                    <select
                      value={actCat}
                      onChange={(e) => setActCat(e.target.value as Activity['cat'])}
                    >
                      {CATS.map(([c, label]) => (
                        <option key={c} value={c}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="chron-qty">
                    <span className="sr-only">Also counts (optional)</span>
                    <input
                      value={actMetric}
                      placeholder="pages?"
                      onChange={(e) => setActMetric(e.target.value)}
                    />
                  </label>
                  <label className="chron-qty">
                    <span className="sr-only">How long should one sitting be, in minutes</span>
                    <input
                      value={actSession}
                      inputMode="numeric"
                      placeholder="30m a sitting?"
                      onChange={(e) => setActSession(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn"
                    disabled={!actName.trim() || busy}
                    onClick={() => void saveAct()}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost" onClick={() => setFixAct(null)}>
                    Cancel
                  </button>
                </li>
              ) : (
                <li key={a.id}>
                  {/**
                   * ⚠️ THE NAME IS THE BUTTON, like the instrument's layer rows: the row already
                   * names the thing and says what kind it is, so it may as well be the control
                   * for changing both. A separate pencil would be a sixth small target in a row.
                   *
                   * ⚠️ AND THE SITE-WRITTEN ONES ARE EDITABLE TOO, which is the point of making
                   * them ordinary activities. They arrive as Free Time because that is the only
                   * honest guess, and reading a week back showed exactly why it matters: time in
                   * the Instrument sitting in the same bucket as actual free time.
                   */}
                  <button
                    className="btn btn-ghost chron-act-name"
                    onClick={() => {
                      setFixAct(a.id)
                      setActName(a.name)
                      setActCat(a.cat)
                      setActMetric(a.metric ?? '')
                      setActSession(a.session == null ? '' : String(a.session))
                    }}
                    title={`Rename ${a.name}, or change what kind it is`}
                  >
                    {a.name}
                    <span className="muted">{CATS.find(([c]) => c === a.cat)?.[1]}</span>
                    {a.metric ? <span className="muted">· {a.metric}</span> : null}
                    {a.session ? (
                      <span className="muted">· {spanText(a.session * 60_000)} a sitting</span>
                    ) : null}
                    {a.auto ? <span className="chron-chip">on the site</span> : null}
                  </button>
                  {mins[a.id] ? (
                    <span className="chron-ent-span">{spanText(mins[a.id] * 60_000)}</span>
                  ) : null}
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      await archiveActivity(a.id, !a.archived)
                      await load()
                    }}
                  >
                    {a.archived ? 'Bring back' : 'Archive'}
                  </button>
                </li>
              ),
            )}
          </ul>
        </details>
      )}

      {say && <p className="chron-say">{say}</p>}
    </div>
  )
}
