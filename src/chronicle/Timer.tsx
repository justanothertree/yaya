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
import { WeekGrid } from './WeekGrid'
import { weekOf } from './week'
import { Routines } from './Routines'
import {
  CATS,
  clockText,
  COLOURS,
  dayBounds,
  gapSince,
  sitting,
  localMidnight,
  minutesByActivity,
  minutesByCat,
  amountIn,
  metSession,
  moodWord,
  MOODS,
  overlapMs,
  straddles,
  countText,
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

/**
 * The weekday alone — the shortest thing that names the OTHER day a sitting touched.
 *
 * ⚠️ `new Date` RATHER THAN `localMidnight`, which is what the rest of this room's day
 * arithmetic uses. That one splits a `YYYY-MM-DD` on its hyphens; this is asked about a
 * session's own start or end, which is an instant, and would hand it a day of `NaN`.
 */
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })

/**
 * The wall clock, in its own component for one reason: it re-renders every second.
 *
 * ⚠️ IF IT LIVED IN `Timer` THE WHOLE ROOM WOULD REDRAW ONCE A SECOND — the day's log, the week
 * grid, the plans, the routines, the activity fold — all to move a colon. React would reconcile
 * every one of them, and the grid alone is seven columns of absolutely positioned blocks. A
 * component that owns its own tick redraws eleven characters.
 *
 * ⚠️ AND IT IS `aria-live="off"` LIKE THE RUNNING COUNTER BESIDE IT: a clock that announces itself
 * every second to a screen reader is a room nobody can use.
 */
function WallClock() {
  const [, beat] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => beat((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <span className="chron-wall" aria-live="off">
      {/* ⚠️ `numeric` hours, `2-digit` the rest: "09:37:05 PM" is a 24-hour habit worn by a
          12-hour clock, and the leading zero is the giveaway. A 24-hour locale pads it anyway. */}
      {new Date().toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  )
}

export function Timer({
  day,
  beat,
  onChange,
  show,
}: {
  day: string
  /**
   * Which half of the room is on screen. This component renders six separate things, and all six
   * at once is most of what made Chronicle unreadable: **73 controls on one screen**, answering
   * nine different questions. The room is 38 and 37 now, and the note on `half` in
   * sections/Chronicle.tsx says why that figure is not the 86 I first wrote down.
   *
   * ⚠️ THE STOPWATCH IS IN NEITHER HALF. Everything from the running clock down to the gap form
   * renders whatever `show` says, because a session you forgot to stop must not be able to hide
   * behind a tab — the same reason the timer sits above the horizon strip rather than inside it.
   * What `show` gates is the DAY (its stepper, totals, log, plans, routines and activity list)
   * against the AIMS half, which lives in the room above.
   */
  show: 'day' | 'aims'
  /**
   * Bumped by the room when something OUTSIDE this half changed the record — today only a
   * put-back, which rewrites everything at once.
   *
   * ⚠️ THE SAME SIGNAL `Looking` AND `MonthGrid` TAKE, and for the third time the same reason:
   * this half fetches its own activities and its own day, so nothing it is handed changes when a
   * file is restored. Measured — a put-back into an empty account restored seven activities and
   * eleven goals, the goals half filled in, and the stopwatch beside it went on saying "Name an
   * activity with ＋ Activity first" with an empty picker and no log, for as long as you left it.
   * The bigger half of the room, still showing a blank account over a full one.
   */
  beat?: number
  onChange?: () => void
}) {
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
  /**
   * ⚠️ THE DAY BEING READ BELONGS TO THE DAY HALF, and the stopwatch above it does not travel
   * with it. Two controls in the permanent header — the switch row and the "you have an unlogged
   * gap" prompt — gate on `seeing === todayISO()`, correctly, because switching into something is
   * a thing you do now and not a thing you do to last Tuesday. So a day stepped back here and
   * then left behind would quietly empty the header of two controls that have nothing to do with
   * the day being read, and nothing on screen would say why. Leaving this half puts it on today.
   */
  useEffect(() => {
    if (show !== 'day') setSeeing(todayISO())
  }, [show])
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
  const [actColour, setActColour] = useState<string | null>(null)
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
  /**
   * ⚠️ THE WEEK IS A SECOND FETCH, NOT A WIDER FIRST ONE. Widening the day's range would have made
   * every reader of `log` — the day list, the running session, the category chips, the strip —
   * filter a week down to a day for themselves, which is six places to get the midnight rule
   * wrong. One more call over a seven-day range is cheaper than that, and it only moves when the
   * week does rather than when the day does.
   */
  const weekDays = useMemo(() => weekOf(seeing), [seeing])
  const [weekLog, setWeekLog] = useState<Entry[]>([])

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

  /* ⚠️ `beat` as well as `load`: an import changes the record without changing the day or the
     bounds, so `load` itself is unchanged and the effect would never re-run */
  useEffect(() => {
    void load()
  }, [load, beat])

  const loadWeek = useCallback(async () => {
    if (!weekDays.length) return
    const from = dayBounds(weekDays[0]).fromMs
    const to = dayBounds(weekDays[weekDays.length - 1]).toMs
    setWeekLog(await entriesBetween(new Date(from).toISOString(), new Date(to).toISOString()))
  }, [weekDays])

  useEffect(() => {
    void loadWeek()
  }, [loadWeek])

  /* ⚠️ the grid follows the day's own writes: starting, stopping, filling a gap and every edit
     all end in `after()`, which reloads `log` — so one effect on it keeps the week honest without
     every call site having to remember a second reload */
  useEffect(() => {
    void loadWeek()
  }, [log, loadWeek])

  const running = log.find((e) => e.end == null) ?? null
  /* ⚠️ it follows `beat`, which already ticks once a second while something runs — and when
     nothing runs the log itself is the only thing that can change it, so the memo is honest
     either way rather than a clock the component does not own. */
  /**
   * ⚠️ `hole`, NOT `gap` — this file already has four `gap` names for the Fill a gap form, and the
   * two mean opposite things: that one is the repair, this is the damage.
   *
   * ⚠️ AND IT RECOMPUTES ON `log` ALONE. The per-second tick is a `const [, setBeat]` with no
   * reader, so it cannot be a dependency — it exists to force a render, and this memo is
   * re-evaluated by that render anyway. A dependency on a value nobody can read would not compile
   * and would not be honest if it did.
   */
  const hole = useMemo(() => gapSince(log, Date.now()), [log])
  live.current = !!running

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setBeat((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [running])

  const byId = useMemo(() => new Map((acts ?? []).map((a) => [a.id, a])), [acts])
  const open = useMemo(() => (acts ?? []).filter((a) => !a.archived), [acts])
  /**
   * The ones you can START or ADD TIME TO, which is not the same list.
   *
   * ⚠️ AN AUTO ACTIVITY IS NOT A THING YOU START. The room writes it itself — "Chronicle" means
   * this room was open — so putting your own time on it records what the site is already
   * recording, twice over. The Quick start row has said exactly that since it was built and
   * filtered them out; the dropdown beside it and ⏱ Fill a gap did not, so the rule held for the
   * shortcut and not for either real way in.
   *
   * ⚠️ AND IT DOUBLE COUNTS, which is the part that makes it more than untidy. Measured in the
   * room: a running sitting on the auto activity from 1:12, a visit written against the same one
   * from 1:19 to 1:21, and Free Time reading 56m where the day held 55 — the overlapping minute
   * counted in both rows, because nothing dedupes two entries on one activity.
   *
   * ⚠️ THE ENTRY EDITOR KEEPS THEM, deliberately: moving a session OFF an auto activity has to
   * stay possible, and a picker that cannot show its own current value is the lie about state
   * that the archived-source note below is about.
   */
  const yours = useMemo(() => open.filter((a) => !a.auto), [open])
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
      [...yours]
        .sort((x, y) => (mins[y.id] ?? 0) - (mins[x.id] ?? 0) || x.name.localeCompare(y.name))
        .slice(0, 6),
    [yours, mins],
  )
  /* what the row offers: the handful worth a button, minus whatever is running — see the row */
  const switchable = useMemo(
    () => quick.filter((a) => a.id !== running?.activity),
    [quick, running?.activity],
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
    /**
     * ⚠️ STARTING WHAT IS ALREADY RUNNING DOES NOTHING. `chronicle_start` has no idea you meant
     * "yes, this" — it closes the open sitting and opens a second one on the same activity, so
     * one stretch becomes two. Measured through a routine step while that activity ran:
     * "Drawing 7m 9:04–9:12" and "Drawing 2s 9:12–now" where there had been one sitting, the
     * fragment duly marked SHORT because two seconds is under the target.
     *
     * ⚠️ HERE RATHER THAN AT THE THREE CALL SITES, because everything on this half of the room
     * funnels through it: the picker's Start, the switch row, and the routine steps, which reach
     * it through `onStart`. A routine step is the likeliest tap of the three — it wears a ✓ when
     * the activity has had its minutes today, so it reads as a thing you confirm.
     */
    if (id === running?.activity) return
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
    /**
     * ⚠️ `after`, NOT `load` — the goals half reads the activity list too, and this path told only
     * itself. The symptom was invisible until a rail appeared that depends on the same list: after
     * naming your FIRST activity, the goal form still offered no "from Drawing" source, because
     * that picker is hidden when the list is empty and the list was a stale empty. The edit path
     * beside this one has always called `after`; this one and Archive below had not.
     */
    await after()
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
    /**
     * ⚠️ RENAMING WHAT AN ACTIVITY COUNTS RELABELS EVERY NUMBER ALREADY RECORDED AGAINST IT, and
     * it does it silently. An entry's `amount` is a bare number; the word beside it is the
     * activity's metric, read live. Change "reps" to "pages" and a 45-minute gym session that
     * said "60 reps" says "60 pages", and a goal counting it reads "FROM GYM · PAGES · 180 /
     * 20000 reps" — the chip and the meter disagreeing in one row.
     *
     * ⚠️ SO IT ASKS, RATHER THAN REPAIRING. Putting those numbers right means deleting
     * quantities out of sessions somebody recorded, which is not a thing to do on their behalf —
     * see the design doc, where it is left open deliberately. What IS right is to say what this
     * will do at the moment somebody is choosing, which is the same lesson as the delete
     * confirmation that used to understate what it removed.
     *
     * ⚠️ ONLY WORD → DIFFERENT WORD. Naming a metric for the first time cannot relabel anything
     * that was recorded without one, and clearing a metric hides the numbers rather than
     * reinterpreting them — measured, both. The one that rewrites meaning is the swap.
     */
    const was = (acts ?? []).find((a) => a.id === fixAct)?.metric?.trim() || ''
    const now = actMetric.trim()
    if (
      was &&
      now &&
      was !== now &&
      !window.confirm(
        `Anything already recorded against ${n} was counted in ${was}. Changing this to ${now} makes every one of those numbers read as ${now} instead. Change it?`,
      )
    )
      return
    setBusy(true)
    /* ⚠️ the same function that creates one, given an id — chronicle_activity_save has taken an
       id since step 2 and nothing had ever passed one, which is why a category was permanent */
    /* ⚠️ '' rather than null when there is no colour: null means "leave it alone" on the way in —
       see chronicle_activity_save — so clearing one has to be asked for. */
    const r = await saveActivity(n, actCat, actColour ?? '', fixAct, actMetric, asMins(actSession))
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
    /**
     * ⚠️ THE SECOND AND THIRD CALLS CAN FAIL ON THEIR OWN, and this editor is the one place where
     * that is not self-evident. `setAmount` and `setQuality` answer true or false, and both
     * answers were dropped — so a span that saved while its amount did not closed the editor,
     * which is a success signal, and the row came back carrying the old number. Everywhere else
     * in this room a failed write leaves the thing visibly unchanged and says nothing, which at
     * least does not claim to have worked.
     *
     * It is still a generic sentence, because a boolean carries no reason. Saying WHICH part did
     * not take is the useful half: the span is saved either way, so nobody needs to type the
     * timestamps again.
     */
    let partly: string | null = null
    if (!bad) {
      const had = log.find((e) => e.id === fixEnt)?.amount ?? null
      if (metric) {
        const n = Number(entAmount)
        const ok = await setAmount(
          fixEnt,
          entAmount.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n,
        )
        if (!ok) partly = 'Saved — but the amount did not change.'
      } else if (had != null) {
        /**
         * ⚠️ AND A SESSION MOVED ONTO SOMETHING THAT COUNTS NOTHING LOSES ITS NUMBER, rather
         * than keeping one nothing can show. The box is gone by then, so skipping the write left
         * the old amount in the row — invisible, and waiting: moving the session back onto an
         * activity with a metric brought "60 reps" out again. Hidden state that reappears is
         * worse than a cleared field, because nobody chose it and nobody can see it to undo it.
         *
         * ⚠️ ONLY WHEN THERE IS ONE TO CLEAR, so the ordinary edit of an activity that counts
         * nothing still costs two round trips rather than three — the economy the note above is
         * about.
         */
        if (!(await setAmount(fixEnt, null))) partly = 'Saved — but the amount did not change.'
      }
    }
    /* ⚠️ a third call on an edit, for the same reason the amount is a second one — see setQuality.
       Only when it CHANGED, so the common case of nudging a timestamp stays two round trips. */
    if (!bad) {
      const was = log.find((e) => e.id === fixEnt)?.quality ?? null
      const now = entMood === '' ? null : Number(entMood)
      if (was !== now && !(await setQuality(fixEnt, now))) {
        partly = 'Saved — but the rating did not change.'
      }
    }
    setBusy(false)
    if (bad) return moan(bad.why)
    setFixEnt(null)
    await after()
    /* after the reload, so the row beside the message already shows what did save */
    if (partly) moan(partly)
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
      {show === 'day' && (
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
          {/* ⚠️ only on today: a wall clock beside a day you are reading back is the time somewhere
            else, and the one thing the header must be unambiguous about is which day it means */}
          {seeing === todayISO() && <WallClock />}
        </div>
      )}
      <div className="chron-timer">
        {running ? (
          <>
            <span className="chron-run" aria-live="off">
              {clockText(Date.now() - Date.parse(running.start))}
            </span>
            <span className="chron-run-name">
              {byId.get(running.activity)?.name ?? 'something'}
            </span>
            {/**
             * ⚠️ THE TARGET, WHILE IT STILL MATTERS. `session_mins` has been read only by
             * `metSession`, which marks a FINISHED sitting short — so the room could tell you that
             * you stopped early and never that you were about to. "Seven minutes left" is a reason
             * to keep going; "short" is a verdict on something already over.
             *
             * ⚠️ AND IT SAYS THE MINUTES, NOT ONLY THE BAR. A bar with no number is a shape; the
             * one thing you want at a glance is how much longer, so the bar carries the sentence
             * rather than replacing it.
             */}
            {(() => {
              const aim = byId.get(running.activity)?.session ?? null
              const far = sitting((Date.now() - Date.parse(running.start)) / 60_000, aim)
              if (!far) return null
              return (
                <span className={'chron-aim' + (far.over ? ' is-met' : '')}>
                  <i aria-hidden>
                    <b style={{ width: `${far.pct}%` }} />
                  </i>
                  <span>
                    {far.over ? `${aim}m done` : `${Math.ceil(far.left)}m left of ${aim}m`}
                  </span>
                </span>
              )
            })()}
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
            {/**
             * ⚠️ A DAY THAT HAS NOT HAPPENED GETS ITS OWN SENTENCE. The condition here is "not
             * today", which is true in both directions, and the copy was written for one of them:
             * stepping forward to Saturday said "Looking back. Use ⏱ Fill a gap to add time",
             * which is wrong twice — you are looking forward, and you cannot have spent time on a
             * day you have not lived. Pointing somebody at Fill a gap there invites them to record
             * work they have not done.
             *
             * ⚠️ AND IT POINTS AT THE THING THAT IS ACTUALLY FOR THIS. A future day is what the
             * planner is for, and the plan list is a few inches further down the same column.
             */}
            {seeing > todayISO()
              ? 'Not here yet. Plan a span below, or go back to today to start a timer.'
              : 'Looking back. Use ⏱ Fill a gap to add time, or go back to today to start a timer.'}
          </span>
        ) : (
          <>
            <label className="chron-pickrow">
              <span className="sr-only">What are you doing?</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Pick an activity…</option>
                {CATS.map(([cat, label]) => {
                  const inCat = yours.filter((a) => a.cat === cat)
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
            <button
              className="btn"
              disabled={!pick || busy}
              /* the sentence below is what a phone reads; this is for a pointer hovering it */
              title={yours.length ? undefined : 'Name an activity first'}
              onClick={() => void go(pick)}
            >
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
       * ⚠️ A DEAD CONTROL HAS TO SAY SO IN WORDS, and until now this row said it three different
       * ways, none of which a phone can show. Start, Fill a gap and Plan a span are all correctly
       * disabled on a fresh account — there is nothing to time yet — but the only explanations
       * were a `cursor: not-allowed`, which no touch screen has, and a `title` on one of the
       * three, which is a tooltip and does not exist on a phone either. So the first screen every
       * member passes through exactly once showed a picker with nothing in it and a Start that
       * does nothing, and said why to nobody holding a phone.
       *
       * ⚠️ THE ROOM ALREADY KNEW HOW TO SAY IT, one section down: the Planned details reads "Name
       * an activity with ＋ Activity first — a plan is a stretch of a day set aside for one of
       * them." This is that sentence, where the dead buttons actually are, and in the same shape
       * so the two do not read as different rules.
       */}
      {acts !== null && !acts.some((a) => !a.archived) && (
        <p className="muted chron-firstly">
          Name an activity with ＋ Activity first — the stopwatch times one of them.
        </p>
      )}

      {/**
       * ⚠️ THE HOLE, NOT THE STATUS. The HTML app's banner says "Timer stopped", which is a fact
       * the Start button two inches away already carries. What it cannot tell you is that it is
       * nine in the evening and nothing has been written down since lunch — and that is the number
       * `⏱ Fill a gap` exists to close.
       *
       * ⚠️ TEN MINUTES BEFORE IT SAYS ANYTHING. A gap of two minutes is the pause between stopping
       * one thing and starting the next, and a line reporting it on every stop is a room that
       * nags. See gapSince, which has the arithmetic and the tests.
       */}
      {!running && seeing === todayISO() && hole && hole.ms > 10 * 60_000 && (
        <p className="muted chron-gapline">
          <strong>{spanText(hole.ms)}</strong> unaccounted since{' '}
          {byId.get(hole.activity)?.name ?? 'the last thing'}.
        </p>
      )}

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
      {/**
       * ⚠️ AND IT STAYS WHILE SOMETHING IS RUNNING, which it did not. `!running` sat here
       * unexplained, almost certainly copied from the gap line directly above — where it means
       * something, because "two hours unaccounted" is only a sentence when nothing is going on.
       * Here it took the fastest way to change what you are doing and hid it at the exact moment
       * you were doing something. Switching is the most repeated action in this room and it was
       * left costing a dropdown and a button.
       *
       * `chronicle_start` closes the open sitting before opening the next, so one tap is the
       * whole switch and the record stays continuous — the same call the Now room is built on.
       *
       * ⚠️ AND THE RUNNING ONE IS NOT IN THE ROW. Tapping it would close the sitting and open a
       * second on the same activity, splitting one stretch in two — measured in the Now room as
       * a clock going from 7:09 back to 0:01.
       */}
      {seeing === todayISO() && switchable.length > 0 && (
        <div className="chron-quick">
          <span className="muted chron-quick-label">{running ? 'Switch to' : 'Quick start'}</span>
          {switchable.map((a) => (
            <button
              key={a.id}
              className="btn btn-ghost chron-chip-start"
              disabled={busy}
              onClick={() => void go(a.id)}
            >
              {/* ⚠️ the dot rather than ▶, where the activity has a colour: the triangle says
                  "this starts something", which the row's own label already says, and the colour
                  says WHICH thing — the same dot the day log and the week grid draw. */}
              {a.colour ? (
                <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
              ) : (
                <span aria-hidden>▶</span>
              )}
              {a.name}
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
                .filter((a) => (!a.archived && !a.auto) || a.id === gapAct)
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
      {show === 'day' && Object.keys(cats).length > 0 && (
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

      {show === 'day' && log.length > 0 && (
        <ul className="chron-log">
          {log.map((e) => {
            const a = byId.get(e.activity)
            const ms = overlapMs(e, bounds.fromMs, bounds.toMs, Date.now())
            const amt = amountIn(e, bounds.fromMs, bounds.toMs)
            /* ⚠️ ONE CALL, TWO RENDERINGS — the clock range below, and the marker that stands in
               for it where the range is hidden. Both are the same question about the same row, so
               a row cannot say it crossed midnight at one width and not at another. */
            const out = straddles(e, bounds.fromMs, bounds.toMs, Date.now())
            return (
              <li key={e.id} className={'chron-ent' + (e.end == null ? ' is-live' : '')}>
                {/* the same dot as the Activities list, where the day is actually read */}
                {a?.colour ? (
                  <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                ) : null}
                <span className="chron-ent-name">{a?.name ?? 'an activity since deleted'}</span>
                {/**
                 * ⚠️ THE FACTS ARE ONE GROUP SO THAT ✎ AND ✕ CANNOT BE PUSHED OFF THE LINE. As
                 * direct children of a wrapping row they competed with the buttons for it, and
                 * the row lost by two pixels: measured at 375, `dot 9 + name 100 + 35m 25 +
                 * good 30 + buttons 100 + five 8px gaps` is 304 against a 302px row, so the
                 * buttons dropped to a line of their own under an empty space. The standing
                 * comment on `.chron-ent` budgeted four gaps and no rating, which is why it read
                 * as sufficient and was not.
                 *
                 * ⚠️ AND NO AMOUNT OF TUNING FIXES IT, which is why this is a group rather than
                 * a smaller floor: a long sitting with a rough rating needs `9 + 50 + 38 + 100`
                 * of rigid width before the name gets a pixel. Grouped, the row is four items —
                 * dot, name, facts, buttons — the facts wrap among THEMSELVES, and the buttons
                 * keep their place however many facts a sitting has.
                 */}
                <span className="chron-ent-facts">
                  <span className="chron-ent-span">{spanText(ms)}</span>
                  {/* ⚠️ the amount sits with the length because they are the same fact measured two
                    ways — "40m, 4 pages" is one session, and separating them would invite reading
                    the number as a second entry.
                    ⚠️ AND `amountIn` RATHER THAN `e.amount != null`, which showed it on both of
                    the days a session straddles. See amountIn — the minutes split at midnight and
                    the quantity does not. */}
                  {amt != null && a?.metric ? (
                    <span className="chron-amount">
                      {countText(amt)} {a.metric}
                    </span>
                  ) : null}
                  {/**
                   * ⚠️ THE SAME FACT AS THE WEEKDAY BELOW, FOR THE SCREEN THAT CANNOT SHOW IT.
                   * `.chron-ent-when` is `display: none` under `max-width: 700px` or
                   * `pointer: coarse` on purpose — a timestamp range is the first thing worth
                   * dropping when a row will not fit a thumb — and it took the straddle marker
                   * down with it. So a phone showed one sitting on two consecutive days with two
                   * different lengths, the note on both, the quantity on one, and nothing at all
                   * saying why. That fact is worth MORE there than the times it was bundled with:
                   * it is the one that explains the apparent duplicate.
                   *
                   * ⚠️ TWO SPANS RATHER THAN ONE STRING. A sitting long enough to swallow a whole
                   * day has both ends outside it, and "from Wed · into Fri" in a single
                   * `white-space: nowrap` run is 19 characters the row cannot break — which is
                   * the min-content that pushes a flex row past its own list. Separate, they wrap
                   * between themselves and the row keeps its buttons.
                   *
                   * ⚠️ AND "still going" WHERE AN END WOULD GO, because a running sitting read on
                   * an earlier day has no end to name a day with. It is `straddles`' own answer
                   * — a timer still going reaches to now — said in the words the range uses for
                   * it, which are " – now".
                   */}
                  {out.before ? (
                    <span className="muted chron-ent-cross">from {shortDay(e.start)}</span>
                  ) : null}
                  {out.after ? (
                    <span className="muted chron-ent-cross">
                      {e.end ? `into ${shortDay(e.end)}` : 'still going'}
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
                  {/**
                   * ⚠️ AN END OUTSIDE THIS DAY SAYS WHICH DAY IT IS IN. See `straddles`: the
                   * minutes beside this are only the share that falls here, so a bare
                   * "11:00 PM – 1:00 AM" next to "1h" is a row disagreeing with itself — and on
                   * today it names a time that has not happened yet. The weekday is enough to
                   * resolve it and short enough not to crowd a row that already carries five
                   * facts.
                   *
                   * ⚠️ AND IT IS NOT THE ONLY PLACE THAT ASKS. This whole span is hidden on a
                   * phone or a tablet, so `.chron-ent-cross` above carries the straddle on its
                   * own there. Both read the one `out` the row computed.
                   */}
                  <span className="muted chron-ent-when">
                    {(() => {
                      const day = (iso: string) => shortDay(iso) + ' '
                      const clock = (iso: string) =>
                        new Date(iso).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      const from = (out.before ? day(e.start) : '') + clock(e.start)
                      if (!e.end) return from + ' – now'
                      return from + ' – ' + (out.after ? day(e.end) : '') + clock(e.end)
                    })()}
                  </span>
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
                    <label className="chron-choice">
                      <span className="sr-only">What this was</span>
                      <select
                        value={entAct}
                        onChange={(ev) => {
                          /**
                           * ⚠️ A QUANTITY BELONGS TO A METRIC, AND MOVING A SESSION CHANGES THE
                           * METRIC UNDER IT. The box follows the activity SELECTED rather than the
                           * one the session used to be — which is right — but the NUMBER in it
                           * stayed put, so moving a 60-rep gym session onto Writing rewrote it as
                           * "60 pages". Measured in the room: the placeholder flipped to "pages"
                           * the instant the activity changed, so the form knew the unit had
                           * changed and kept the number anyway.
                           *
                           * Sixty reps is not sixty pages. When the unit changes the number stops
                           * meaning anything, so it goes, visibly, while somebody is looking at
                           * it. Moving between two activities that count the SAME thing keeps it.
                           */
                          const was = byId.get(entAct)?.metric ?? null
                          const now = byId.get(ev.target.value)?.metric ?? null
                          if (was !== now) setEntAmount('')
                          setEntAct(ev.target.value)
                        }}
                      >
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
                      <label className="chron-choice">
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
      {/**
       * ⚠️ THE WEEK, ABOVE THE FOLDS AND BELOW THE DAY, which is where the thing it answers sits.
       * The list above says what today held; this says what the WEEK looks like, and the one
       * question neither could answer before is the shape — that the mornings are empty, that
       * Sunday is solid and Thursday is a single block at midnight.
       *
       * ⚠️ IT PICKS THE DAY the rest of the card is about, so the grid and the log are one control
       * rather than two views of different days.
       */}
      {/**
       * ⚠️ NOT UNTIL THERE IS SOMETHING IT COULD HOLD. On a fresh account this drew seven empty
       * columns with an hour scale beside them and the sentence "0% of these 4 days is written
       * down" underneath — furniture pretending to be information, on the one screen where
       * somebody has the least idea what to do, and a reproach about days they had not yet been a
       * member for.
       *
       * ⚠️ THE CONDITION IS ACTIVITIES, NOT ENTRIES, and the difference matters. An empty week for
       * somebody who HAS activities is a real and useful answer — "you did nothing this week" is
       * worth seeing. An empty week for somebody with no activities cannot be anything else: an
       * entry needs an activity to point at, so there is provably nothing being hidden.
       */}
      {show === 'day' && acts !== null && acts.length > 0 && (
        <WeekGrid on={seeing} log={weekLog} acts={acts} onPick={setSeeing} />
      )}

      {show === 'day' && acts !== null && (
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
      {show === 'day' && seeing === todayISO() && (
        <details className="chron-tidy">
          <summary>Routines</summary>
          <Routines acts={acts ?? []} mins={mins} onStart={(id) => void go(id)} busy={busy} />
        </details>
      )}
      {/* archiving lives with the totals rather than in a settings screen: the moment you notice
          an activity is finished with is the moment you are looking at a day without it in */}
      {show === 'day' && open.length > 0 && (
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
                  {/**
                   * ⚠️ A COLOUR IS DECORATION BESIDE A NAME, never the only thing carrying it.
                   * The dot sits next to the word everywhere it is drawn, so somebody who cannot
                   * tell the colours apart loses nothing — which is the only reason a row of
                   * swatches is allowed to be the control.
                   */}
                  <span className="chron-swatches" role="group" aria-label="A colour for this">
                    {COLOURS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={'chron-swatch' + (actColour === c ? ' is-on' : '')}
                        style={{ background: c }}
                        aria-pressed={actColour === c}
                        aria-label={`Colour ${COLOURS.indexOf(c) + 1} of ${COLOURS.length}`}
                        onClick={() => setActColour(c)}
                      />
                    ))}
                    <button
                      type="button"
                      className={'chron-swatch is-none' + (actColour == null ? ' is-on' : '')}
                      aria-pressed={actColour == null}
                      aria-label="No colour"
                      onClick={() => setActColour(null)}
                    >
                      ✕
                    </button>
                  </span>
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
                      setActColour(a.colour)
                      setActMetric(a.metric ?? '')
                      setActSession(a.session == null ? '' : String(a.session))
                    }}
                    title={`Rename ${a.name}, or change what kind it is`}
                  >
                    {a.colour ? (
                      <span className="chron-dot" style={{ background: a.colour }} aria-hidden />
                    ) : null}
                    {a.name}
                    <span className="muted">{CATS.find(([c]) => c === a.cat)?.[1]}</span>
                    {/**
                     * ⚠️ THE TWO OPTIONAL FACTS ARE MARKED, so a phone can drop them. The row
                     * carries a name, a category, a metric, a sitting length, today's minutes and
                     * an Archive button; at 375 the name button gets about 178px of that and was
                     * wrapping to three ragged lines with "· 30m a sitting" spilling past its own
                     * rounded background. Same answer as `.chron-plan-note` and `.chron-ent-when`:
                     * the first things to go when a row will not fit a thumb are the ones the
                     * editor shows anyway — and this button IS the editor's door.
                     */}
                    {a.metric ? <span className="muted chron-act-extra">· {a.metric}</span> : null}
                    {a.session ? (
                      <span className="muted chron-act-extra">
                        · {spanText(a.session * 60_000)} a sitting
                      </span>
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
                      /* ⚠️ `after` for the same reason as makeActivity: archiving the last
                         activity leaves the goals half still offering it as a source */
                      await after()
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
