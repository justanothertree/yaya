import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEntry,
  archiveActivity,
  dropEntry,
  entriesBetween,
  myActivities,
  saveActivity,
  startTimer,
  stopTimer,
} from './cloud'
import {
  CATS,
  clockText,
  dayBounds,
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
export function Timer({ day, onChange }: { day: string; onChange?: () => void }) {
  const [acts, setActs] = useState<Activity[] | null>(null)
  const [log, setLog] = useState<Entry[]>([])
  const [pick, setPick] = useState('')
  const [say, setSay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState<Activity['cat']>('free')
  const [gap, setGap] = useState(false)
  const [gapFrom, setGapFrom] = useState('')
  const [gapTo, setGapTo] = useState('')
  /* a tick purely so the clock face moves — see the note above */
  const [, setBeat] = useState(0)
  const live = useRef(false)

  const bounds = useMemo(() => dayBounds(day), [day])

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
    const bad = await stopTimer(null)
    setBusy(false)
    if (bad) return moan(bad.why)
    await after()
  }

  const makeActivity = async () => {
    const n = newName.trim()
    if (!n || busy) return
    setBusy(true)
    const r = await saveActivity(n, newCat, null)
    setBusy(false)
    if ('why' in r) return moan(r.why)
    setNewName('')
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
      <div className="chron-timer">
        {running ? (
          <>
            <span className="chron-run" aria-live="off">
              {clockText(Date.now() - Date.parse(running.start))}
            </span>
            <span className="chron-run-name">
              {byId.get(running.activity)?.name ?? 'something'}
            </span>
            <button className="btn" disabled={busy} onClick={() => void halt()}>
              ■ Stop
            </button>
          </>
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
                <span className="muted chron-ent-when">
                  {new Date(e.start).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {e.end
                    ? ` – ${new Date(e.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                    : ' – now'}
                </span>
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

      {/* archiving lives with the totals rather than in a settings screen: the moment you notice
          an activity is finished with is the moment you are looking at a day without it in */}
      {open.length > 0 && (
        <details className="chron-tidy">
          <summary>Activities</summary>
          <ul className="chron-acts">
            {(acts ?? []).map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <span className="muted">{CATS.find(([c]) => c === a.cat)?.[1]}</span>
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
            ))}
          </ul>
        </details>
      )}

      {say && <p className="chron-say">{say}</p>}
    </div>
  )
}
