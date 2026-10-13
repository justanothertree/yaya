import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEntry,
  archiveActivity,
  dropEntry,
  editEntry,
  setAmount,
  entriesBetween,
  myActivities,
  saveActivity,
  startTimer,
  stopTimer,
} from './cloud'
import { today as todayISO } from './goal'
import { Routines } from './Routines'
import {
  CATS,
  clockText,
  dayBounds,
  localMidnight,
  minutesByActivity,
  minutesByCat,
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
  const [gap, setGap] = useState(false)
  /** what you were doing, written down as you stop — the field the table has always had */
  const [stopNote, setStopNote] = useState('')
  const [gapFrom, setGapFrom] = useState('')
  const [gapTo, setGapTo] = useState('')
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
  /** the amount being typed against a span, keyed by entry id */
  const [entAmount, setEntAmount] = useState('')
  const [fixEnt, setFixEnt] = useState<string | null>(null)
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

  const halt = async () => {
    if (busy) return
    setBusy(true)
    /**
     * ⚠️ THE NOTE GOES IN ON THE WAY OUT, which is the only moment anybody knows what to write.
     * `chronicle_stop` has taken one since step 2 and this passed null — so the column existed,
     * the function stored it, the log rendered it, and there was no way to put anything in it.
     */
    const bad = await stopTimer(stopNote.trim() || null)
    setBusy(false)
    if (bad) return moan(bad.why)
    setStopNote('')
    await after()
  }

  const makeActivity = async () => {
    const n = newName.trim()
    if (!n || busy) return
    setBusy(true)
    const r = await saveActivity(n, newCat, null, undefined, newMetric)
    setBusy(false)
    if ('why' in r) return moan(r.why)
    setNewName('')
    setNewMetric('')
    setAdding(false)
    await load()
    /* ⚠️ a new activity is almost always one you are about to do, so it is pre-selected rather
       than leaving somebody to find it in a list they just added to */
    setPick(r.id)
  }

  const fillGap = async () => {
    if (!pick) return moan('pick an activity first')
    if (!gapFrom || !gapTo) return moan('both ends of the span, please')
    setBusy(true)
    const bad = await addEntry(
      pick,
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
    const r = await saveActivity(n, actCat, null, fixAct, actMetric)
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
    if (!fixEnt || !entFrom || !entTo || busy) return
    setBusy(true)
    const bad = await editEntry(
      fixEnt,
      new Date(entFrom).toISOString(),
      new Date(entTo).toISOString(),
      null,
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

  const forget = async (e: Entry) => {
    const name = byId.get(e.activity)?.name ?? 'that'
    if (
      !window.confirm(
        `Delete the ${spanText(overlapMs(e, bounds.fromMs, bounds.toMs, Date.now()))} of ${name}?`,
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
        <button className="btn btn-ghost" onClick={() => setGap((v) => !v)}>
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
          <button className="btn" disabled={busy} onClick={() => void fillGap()}>
            Add to {byId.get(pick)?.name ?? 'the picked activity'}
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
            return (
              <li key={e.id} className={'chron-ent' + (e.end == null ? ' is-live' : '')}>
                <span className="chron-ent-name">{a?.name ?? 'an activity since deleted'}</span>
                <span className="chron-ent-span">{spanText(ms)}</span>
                {/* ⚠️ the amount sits with the length because they are the same fact measured two
                    ways — "40m, 4 pages" is one session, and separating them would invite reading
                    the number as a second entry */}
                {e.amount != null && a?.metric ? (
                  <span className="chron-amount">
                    {e.amount} {a.metric}
                  </span>
                ) : null}
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
                    <label className="chron-gap">
                      <span className="sr-only">Started</span>
                      <input
                        type="datetime-local"
                        value={entFrom}
                        onChange={(ev) => setEntFrom(ev.target.value)}
                      />
                    </label>
                    <label className="chron-gap">
                      <span className="sr-only">Ended</span>
                      <input
                        type="datetime-local"
                        value={entTo}
                        onChange={(ev) => setEntTo(ev.target.value)}
                      />
                    </label>
                    {/* ⚠️ only for an activity that has a metric: a box asking for a number with
                        no unit is a box nobody can answer */}
                    {a?.metric && (
                      <label className="chron-qty">
                        <span className="sr-only">How many {a.metric}</span>
                        <input
                          value={entAmount}
                          inputMode="decimal"
                          placeholder={a.metric}
                          onChange={(ev) => setEntAmount(ev.target.value)}
                        />
                      </label>
                    )}
                    <button className="btn" disabled={busy} onClick={() => void saveEnt(a?.metric)}>
                      Save
                    </button>
                    <button className="btn btn-ghost" onClick={() => setFixEnt(null)}>
                      Cancel
                    </button>
                  </span>
                )}
                {/* ⚠️ only a finished span can be edited: the editor needs both ends, and the
                    running one is closed with Stop rather than by typing a time into it */}
                {e.end && (
                  <button
                    className="btn btn-ghost chron-x"
                    onClick={() => {
                      setFixEnt(fixEnt === e.id ? null : e.id)
                      setEntFrom(forInput(e.start))
                      setEntTo(forInput(e.end!))
                      setEntAmount(e.amount == null ? '' : String(e.amount))
                    }}
                    aria-label="Change when this was"
                    title="Change when this was"
                  >
                    ✎
                  </button>
                )}
                <button
                  className="btn btn-ghost chron-x"
                  onClick={() => void forget(e)}
                  aria-label="Delete this span"
                  title="Delete this span"
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!log.length && <p className="muted">Nothing recorded for this day yet.</p>}

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
                    }}
                    title={`Rename ${a.name}, or change what kind it is`}
                  >
                    {a.name}
                    <span className="muted">{CATS.find(([c]) => c === a.cat)?.[1]}</span>
                    {a.metric ? <span className="muted">· {a.metric}</span> : null}
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
