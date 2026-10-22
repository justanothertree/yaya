import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  entriesBetween,
  myActivities,
  noteRunning,
  saveActivity,
  startTimer,
  stopTimer,
} from './cloud'
import { clockText, dayBounds, type Activity, type Entry } from './record'
import { tilesFor } from './nowTiles'
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
  const [adding, setAdding] = useState(false)
  const [fresh, setFresh] = useState('')
  const [say, setSay] = useState<string | null>(null)
  /* the clock's own heartbeat — see the effect below, and `tiles` */
  const [beat, setBeat] = useState(0)

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
   * ⚠️ THE RULE LIVES IN `tilesFor`, not here. It has a unit in it and three claims about what a
   * tile is — archived out, auto out, most-used first — and none of them could be checked from a
   * component. `beat` is in the dependencies so the running sitting's length keeps counting:
   * reading the clock inside a memo that only watches the data froze it between loads.
   *
   * ⚠️ AND THE DAY IS WORKED OUT HERE, EVERY TIME, rather than held. `todayISO()` inside a memo
   * with a fixed dependency list is a value that is right until midnight and then quietly is not
   * — and this room is the one somebody leaves open. It is two `Date` constructions a second
   * while something runs, and nothing at all while nothing does.
   */
  const tiles = useMemo(() => {
    const day = dayBounds(todayISO())
    return tilesFor(acts ?? [], log, day.fromMs, day.toMs, Date.now())
  }, [acts, log, beat])

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
    /**
     * ⚠️ TAPPING WHAT IS ALREADY RUNNING DOES NOTHING, because `chronicle_start` would close the
     * sitting and open a second one on the same activity — splitting one stretch into two for no
     * reason. Measured before this line: the clock went from 7:09 back to 0:01. And it is the
     * likeliest mis-tap in the room, because the running tile is the only one that stands out,
     * so it is the one a thumb goes to when somebody means "yes, this".
     *
     * Doing nothing is the honest answer: you asked for what you already have, and the room is
     * already saying so — the tile is marked and the clock is counting.
     */
    if (id === running?.activity) return
    setBusy(true)
    await flushNote()
    const bad = await startTimer(id)
    setBusy(false)
    if (bad) return moan(bad.why)
    await load()
  }

  /**
   * Name something that is not on the screen yet, and be doing it.
   *
   * ⚠️ NAMING IT AND STARTING IT ARE ONE ACTION HERE, which is the difference between this and
   * the Chronicle's own add form. There, a new activity is pre-selected because "a new activity
   * is almost always one you are about to do" — its words. On a platform that is not almost, it
   * is the reason you are typing: nobody opens this room to curate a list.
   *
   * ⚠️ A NAME YOU ALREADY HAVE IS A MATCH, NOT A MISTAKE. `chronicle_activities` is
   * UNIQUE (owner, name), so typing "Gym" when Gym exists is a refusal — and it is the single
   * likeliest thing to type, because the activities you do often are the ones you remember the
   * names of. Starting the one you have is what was meant, and it saves a round trip that could
   * only fail.
   *
   * ⚠️ MATCHED WITHOUT CASE, which is deliberately more forgiving than the index. The server
   * compares exactly, so "gym" beside "Gym" is two activities as far as it is concerned; on a
   * phone that is autocapitalisation rather than intent. This only ever CHOOSES an existing
   * activity, never creates or renames one, so the worst it can do is start a name that differs
   * in case from the one typed — and the headline says which, immediately.
   *
   * ⚠️ ARCHIVED ONES ARE NOT MATCHED, because `chronicle_start` refuses them. Falling through to
   * the server is right there: it answers "Gym is archived — bring it back in Chronicle", which
   * is the only sentence that helps.
   */
  const addAndGo = async () => {
    const name = fresh.trim()
    if (!name || busy) return
    setBusy(true)
    await flushNote()
    const had = (acts ?? []).find((a) => !a.archived && a.name.toLowerCase() === name.toLowerCase())
    let id = had?.id ?? ''
    if (!id) {
      /* ⚠️ Free Time, matching the Chronicle's own default for a new activity rather than
         guessing differently in one room — the category is a thing to set later, there, where
         there is room to explain what the three of them mean. */
      const made = await saveActivity(name, 'free', null, undefined, '', null)
      if ('why' in made) {
        setBusy(false)
        return moan(made.why)
      }
      id = made.id
    }
    const bad = await startTimer(id)
    setBusy(false)
    if (bad) return moan(bad.why)
    setFresh('')
    setAdding(false)
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
            {/* ⚠️ ITS OWN ELEMENT so it can be clamped — `.now-on-name` is the flex row that
                holds the dot beside it, and a line clamp needs a box of its own. */}
            <span className="now-on-text">{on?.name ?? 'an activity since deleted'}</span>
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
      ) : tiles.length > 0 ? (
        <p className="muted now-idle">Nothing running. Tap one to start.</p>
      ) : /**
       * ⚠️ NOTHING TO TAP MEANS IT MUST NOT SAY "TAP ONE". With no activities yet the room read
       * "Nothing running. Tap one to start." directly above "No activities yet — name one in
       * Chronicle", which is two sentences disagreeing about whether there is anything to press.
       * The second one is the useful half on that screen, and it says what to do; this one is
       * for when there ARE tiles and none of them is running.
       */
      null}

      {say ? (
        <p className="now-say" role="status">
          {say}
        </p>
      ) : null}

      {acts === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : tiles.length === 0 && !adding ? (
        /* ⚠️ IT NO LONGER SENDS A NEW MEMBER AWAY. This said "name one in Chronicle and it
           appears here as a button", which was the only honest thing to say while this room
           could not make one — and is now a detour past the button underneath it. */
        <p className="muted">Nothing here yet. Name what you are doing and it starts.</p>
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

      {/**
       * ⚠️ THE ADD IS A TILE, not a form above the grid, so it keeps the rhythm a thumb has
       * already learnt — same row, same height, same place. Opening it swaps the tile for the
       * field in situ rather than pushing the grid down the screen.
       */}
      {acts !== null &&
        (adding ? (
          <div className="now-new">
            <label>
              <span className="sr-only">What are you doing?</span>
              <input
                value={fresh}
                onChange={(e) => setFresh(e.target.value)}
                /* ⚠️ Enter submits, because the on-screen keyboard's own key is the nearest
                   button to a thumb that is already typing — "go" is what it will read */
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addAndGo()
                  if (e.key === 'Escape') setAdding(false)
                }}
                placeholder="what are you doing?"
                enterKeyHint="go"
                autoFocus
                maxLength={60}
              />
            </label>
            <button
              className="btn"
              onClick={() => void addAndGo()}
              disabled={busy || !fresh.trim()}
            >
              Start
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false)
                setFresh('')
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost now-add" onClick={() => setAdding(true)} disabled={busy}>
            + Something else
          </button>
        ))}
    </div>
  )
}
