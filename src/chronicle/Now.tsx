import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { entriesBetween, myActivities, noteRunning, startTimer, stopTimer } from './cloud'
import { clockText, dayBounds, type Activity, type Entry } from './record'
import { today as todayISO } from './goal'

/**
 * What you are doing, right now, on a phone.
 *
 * ⚠️ THIS ROOM EXISTS BECAUSE SWITCHING WAS THE SLOWEST THING IN THE OTHER ONE. `chronicle_start`
 * has always closed the open sitting before opening the next — one call, and the record stays
 * continuous — but the Chronicle's own Quick start row is wrapped in `!running`, so the fastest
 * way to change what you are doing vanished at the exact moment you were doing something. What
 * was left was a select and a button, several taps down a long page.
 *
 * ⚠️ AND IT IS A SEPARATE PLACE RATHER THAN A FIX TO THAT ROW, asked for that way: the Chronicle
 * is two halves and eight folds, which is right for sitting down with and wrong for standing on
 * a platform. This holds four things — what is running, for how long, what it is about, and
 * every activity as a button — and nothing else. The totals, the log, the plans, the goals and
 * the grids all stay where they are.
 *
 * ⚠️ ONE TAP IS THE WHOLE POINT, so there is no confirm and no picker. A tap on a tile IS the
 * switch, because the server makes that safe: a sitting under a second is deleted rather than
 * recorded, so a mis-tap you correct immediately leaves no trace to tidy up.
 */
export function Now({ authed = false }: { authed?: boolean } = {}) {
  const [acts, setActs] = useState<Activity[] | null>(null)
  const [log, setLog] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [say, setSay] = useState<string | null>(null)
  /* the clock's own heartbeat — see the effect below */
  const [, setBeat] = useState(0)

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const load = useCallback(async () => {
    if (!authed) return
    const b = dayBounds(todayISO())
    const [a, l] = await Promise.all([
      myActivities(),
      entriesBetween(new Date(b.fromMs).toISOString(), new Date(b.toMs).toISOString()),
    ])
    setActs(a)
    setLog(l)
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  const running = log.find((e) => e.end == null) ?? null
  const runId = running?.id ?? null

  /**
   * ⚠️ A `setInterval` RATHER THAN requestAnimationFrame, and only while something runs. The
   * clock is the one thing on this screen that changes without being touched, and rAF would both
   * cost a frame a second for a figure that moves once a second and never fire at all in the
   * Browser pane — see CLAUDE.md. Nothing is scheduled when nothing is running.
   */
  useEffect(() => {
    if (!runId) return
    const id = window.setInterval(() => setBeat((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [runId])

  /**
   * ⚠️ THE BOX FOLLOWS THE SITTING, NOT THE RELOAD. Syncing on the note itself would overwrite
   * what somebody is halfway through typing every time `load()` came back — so this watches the
   * sitting's ID, which changes exactly when the thing being described changes.
   */
  const saved = useRef('')
  const forId = useRef<string | null>(null)
  useEffect(() => {
    if (forId.current === runId) return
    forId.current = runId
    const had = running?.note ?? ''
    setNote(had)
    saved.current = had
  }, [runId, running?.note])

  /**
   * ⚠️ SAVED WHILE YOU TYPE, because a Save button on this screen would be a fifth thing and the
   * one tap it costs is the thing the room is for. `chronicle_running_note` writes one column on
   * the open sitting and does not end it.
   *
   * ⚠️ AND A FAILURE IS SAID OUT LOUD. An autosave that quietly does nothing is the worst of the
   * failure shapes in this project — the room would show the box exactly as you left it while
   * the account held something else.
   */
  useEffect(() => {
    if (!runId || note === saved.current) return
    const t = window.setTimeout(() => {
      void (async () => {
        const bad = await noteRunning(note)
        if (bad) moan(bad.why)
        else saved.current = note
      })()
    }, 700)
    return () => window.clearTimeout(t)
  }, [note, runId])

  /**
   * Every activity you could switch to, the ones you use most first.
   *
   * ⚠️ ARCHIVED AND `auto` ARE BOTH OUT, for the two reasons the Chronicle's own list gives:
   * `chronicle_start` refuses an archived activity, so a tile for one would be a tile that
   * answers with an error, and an `auto` activity is written by the room rather than started by
   * a person.
   */
  const tiles = useMemo(() => {
    const live = (acts ?? []).filter((a) => !a.archived && !a.auto)
    const mins = new Map<string, number>()
    for (const e of log) {
      const end = e.end ? Date.parse(e.end) : Date.now()
      mins.set(e.activity, (mins.get(e.activity) ?? 0) + Math.max(0, end - Date.parse(e.start)))
    }
    return live.sort(
      (x, y) => (mins.get(y.id) ?? 0) - (mins.get(x.id) ?? 0) || x.name.localeCompare(y.name),
    )
  }, [acts, log])

  /**
   * ⚠️ THE NOTE GOES FIRST, ONTO THE SITTING IT WAS TYPED ABOUT. Switching is the whole point of
   * this room and the autosave waits 700ms, so the natural rhythm — write a word, tap the next
   * thing — beat the timer and threw the word away. Measured before this existed: typed "the
   * hands again, finally", tapped the next tile, and the closed sitting read
   * "Drawing 7m 5:57 PM – 6:04 PM" with no note at all.
   *
   * ⚠️ A FAILED NOTE DOES NOT BLOCK THE SWITCH. Refusing to change what you are doing because a
   * sentence would not save is the wrong way round — the sitting closes either way, so the note
   * is gone either way, and the thing that matters is being TOLD rather than being stuck.
   */
  const flushNote = async () => {
    if (!runId || note === saved.current) return
    const bad = await noteRunning(note)
    if (bad) moan(bad.why)
    else saved.current = note
  }

  const go = async (id: string) => {
    if (busy) return
    setBusy(true)
    await flushNote()
    const bad = await startTimer(id)
    setBusy(false)
    if (bad) return moan(bad.why)
    await load()
  }

  /**
   * ⚠️ AND LEAVING THE ROOM FLUSHES IT TOO. Tapping Chronicle in the nav within the debounce lost
   * the note exactly as switching did, and this is the one path that cannot report a failure —
   * the component is going. Fire and forget beats certain loss.
   */
  const latest = useRef({ note: '', was: '', id: null as string | null })
  latest.current = { note, was: saved.current, id: runId }
  useEffect(
    () => () => {
      const l = latest.current
      if (l.id && l.note !== l.was) void noteRunning(l.note)
    },
    [],
  )

  const stop = async () => {
    if (busy) return
    setBusy(true)
    /* ⚠️ the box goes with it, so a note typed in the last second before Stop is not lost to the
       autosave's own delay — the server reads the same column either way */
    const bad = await stopTimer(note.trim() || null)
    setBusy(false)
    if (bad) return moan(bad.why)
    setNote('')
    saved.current = ''
    await load()
  }

  if (!authed) {
    return (
      <div className="now">
        <h2 className="section-title">Now</h2>
        <p className="muted">
          One tap to say what you are doing. Sign in to use it — this is your own record of your own
          time.
        </p>
      </div>
    )
  }

  const on = running ? (acts ?? []).find((a) => a.id === running.activity) : null
  const since = running ? Date.now() - Date.parse(running.start) : 0

  return (
    <div className="now">
      <h2 className="sr-only">Now</h2>

      {/**
       * ⚠️ THE HEADLINE IS WHAT IS RUNNING, not the name of the room. On a phone the first thing
       * on the screen should be the answer to the question you opened it with.
       */}
      {running ? (
        <div className="now-on">
          <span className="now-on-name">
            {on?.colour ? (
              <span className="now-dot" style={{ background: on.colour }} aria-hidden />
            ) : null}
            {on?.name ?? 'an activity since deleted'}
          </span>
          <span className="now-clock">{clockText(since)}</span>
          <button className="btn now-stop" onClick={() => void stop()} disabled={busy}>
            ■ Stop
          </button>
          <label className="now-note">
            <span className="sr-only">What is this about?</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="what this is about"
              enterKeyHint="done"
            />
          </label>
        </div>
      ) : (
        <p className="muted now-idle">Nothing running. Tap one to start.</p>
      )}

      {say ? (
        <p className="now-say" role="status">
          {say}
        </p>
      ) : null}

      {acts === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : tiles.length === 0 ? (
        <p className="muted">
          No activities yet — name one in Chronicle and it appears here as a button.
        </p>
      ) : (
        <div className="now-grid">
          {tiles.map((a) => (
            <button
              key={a.id}
              /* ⚠️ GHOST, NOT THE ACCENT. Every tile carried `btn` at first and the screen came
                 back a wall of solid green — with every figure in the 375 audit reading zero,
                 because nothing was the wrong SIZE. The one that is running has to be the one
                 that stands out, which it cannot be when all five shout. The Chronicle's own
                 quick-start chips are ghost for the same reason. */
              className={'btn btn-ghost now-tile' + (running?.activity === a.id ? ' is-on' : '')}
              onClick={() => void go(a.id)}
              disabled={busy}
              aria-pressed={running?.activity === a.id}
            >
              {a.colour ? (
                <span className="now-dot" style={{ background: a.colour }} aria-hidden />
              ) : null}
              <span className="now-tile-name">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
