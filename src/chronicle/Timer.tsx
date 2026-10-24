import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  addEntry,
  addNote,
  archiveActivity,
  dropEntry,
  editEntry,
  editNote,
  fixRunning,
  setAmount,
  setQuality,
  entriesBetween,
  myActivities,
  myMoments,
  saveActivity,
  startTimer,
  stopTimer,
  type Moment,
} from './cloud'
import { today as todayISO } from './goal'
import { Plans } from './Plans'
import { WeekGrid } from './WeekGrid'
import { weekOf } from './week'
import { Routines } from './Routines'
import { Modal } from '../circuit/ui/Modal'
import { tilesFor } from './nowTiles'
import {
  CATS,
  clockOfLocal,
  clockText,
  COLOURS,
  dayBounds,
  gapSince,
  sitting,
  localMidnight,
  minutesByActivity,
  minsBetweenLocal,
  minutesByCat,
  amountIn,
  metSession,
  moodWord,
  nudgeLocal,
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
/**
 * How far a handle moves an end of a session.
 *
 * ⚠️ FOUR, SYMMETRICAL, AND IN MINUTES PEOPLE THINK IN. Five is "I started a bit late"; fifteen
 * is "I forgot to press Stop for a quarter of an hour". Anything finer than five is a job for
 * the exact form underneath, and anything coarser than fifteen is faster by repeating a tap than
 * by having a third size on the row.
 */
const NUDGES = [-15, -5, 5, 15] as const

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
  show: 'day' | 'aims' | 'friends'
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
  const [actShared, setActShared] = useState(false)
  /* ⚠️ false, and it resets on every load rather than being remembered: the site's own minutes
     are a thing you look up, not a thing you read every day */
  const [seeSite, setSeeSite] = useState(false)
  /** what is in the box — see the note on the combobox for why it is not an id */
  const [typed, setTyped] = useState('')
  const actsListId = useId()
  /**
   * The sitting that has just ended, if its dialog is still open.
   *
   * ⚠️ IT IS A SEPARATE PIECE OF STATE FROM `fixEnt` THOUGH BOTH OPEN THE SAME EDITOR. Stopping
   * something and going back to fix it are different moments — one is offered, the other is
   * asked for — and a single flag would make "cancel" on a finish mean the same thing as
   * abandoning an edit, which it does not: there is nothing to abandon, the sitting is already
   * recorded.
   */
  const [justDid, setJustDid] = useState<string | null>(null)
  /** the amount being typed against a span, keyed by entry id */
  const [entAmount, setEntAmount] = useState('')
  /** how the span being edited went, '' for unrated — see Entry.quality */
  const [entMood, setEntMood] = useState('')
  const [fixEnt, setFixEnt] = useState<string | null>(null)
  const [entAct, setEntAct] = useState('')
  const [entNote, setEntNote] = useState('')
  /**
   * What the session really held, to the second.
   *
   * ⚠️ A `datetime-local` INPUT IS MINUTE-RESOLUTION AND THE RECORD IS NOT. `forInput` drops the
   * seconds to fill the box, so opening the editor on a 33-second sitting showed 3:43 PM in both
   * ends and `0m` between them — while the row above it read `33s`. Pressing Save would then
   * write both ends at :00 and destroy the 33 seconds, and every longer session loses up to 59
   * of them the same way, quietly, on an edit that changed nothing else.
   *
   * ⚠️ SO AN UNTOUCHED END SENDS WHAT IT ALWAYS HELD. The input is compared against what it was
   * seeded with; equal means nobody typed in it, and the original ISO goes back unchanged. Only
   * an end somebody actually moved is re-read from the box, where minute resolution is what they
   * chose and the truncation is theirs.
   */
  const entWas = useRef<{ from: string; to: string | null } | null>(null)
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
   *
   * ⚠️ AND THE RANKING IS `tilesFor` RATHER THAN A SECOND COPY OF IT. This row and the Now
   * room's tiles were the same three rules written twice — drop archived and `auto`, weigh each
   * activity by what it holds in the window, sort by that and then by name — and when Now moved
   * in here one of the two had to go. The one that went is the one with no test: `tilesFor` is
   * pure and `nowTiles.test.ts` asks it the midnight-straddle question, which a `useMemo` in a
   * component cannot be asked at all. The cap stays here because it is about this row's width.
   */
  const quick = useMemo(
    () => tilesFor(acts ?? [], log, bounds.fromMs, bounds.toMs, Date.now()).slice(0, 6),
    [acts, log, bounds.fromMs, bounds.toMs],
  )
  /* what the row offers: the handful worth a button, minus whatever is running — see the row */
  const switchable = useMemo(
    () => quick.filter((a) => a.id !== running?.activity),
    [quick, running?.activity],
  )
  /**
   * The day's rows, split into what you did and what the site noticed.
   *
   * ⚠️ AN `auto` ACTIVITY IS THE SITE RECORDING ITSELF, and on an ordinary day it is most of the
   * log. Counted on one real Thursday: **fifteen rows, eleven of them auto** — Pictures three
   * times, Chronicle four, Ratings twice, Home and Now once each, several of them under a
   * minute. The four rows that were a day — two naps, a game and a meal — were spread between
   * them. Reported, accurately, as "its so much".
   *
   * ⚠️ FOLDED, NOT DROPPED, AND NOT STOPPED AT THE SOURCE. The minutes are real and they already
   * feed the totals and the grids above, so hiding them from the log while they count elsewhere
   * would make two figures on one screen disagree. And `chronicle_visit` is deliberately one row
   * per visit — see the note in CLAUDE.md about it growing a single row across a day boundary —
   * so merging them at the source is a change to the record rather than to the reading of it.
   * This is a reading: the rows are all still there, one tap away, editable where they were.
   */
  /**
   * Moments: the things that happened rather than took time.
   *
   * ⚠️ THEY ARE FETCHED, NOT DERIVED, and they are never entries. A rating is an instant — see
   * the note on `Moment` in cloud.ts — so it cannot be given an `ended_at` without inventing a
   * duration that the totals, the grids and every minutes goal would then count. It rides in the
   * log beside the sittings and nowhere else.
   */
  const [moments, setMoments] = useState<Moment[]>([])
  useEffect(() => {
    let dead = false
    void (async () => {
      const got = await myMoments(
        new Date(bounds.fromMs).toISOString(),
        new Date(bounds.toMs).toISOString(),
      )
      if (!dead) setMoments(got)
    })()
    return () => {
      dead = true
    }
  }, [bounds.fromMs, bounds.toMs, beat])

  const didMyself = useMemo(() => log.filter((e) => !byId.get(e.activity)?.auto), [log, byId])
  const onSite = useMemo(() => log.filter((e) => byId.get(e.activity)?.auto), [log, byId])
  /**
   * The log as one stream, newest first.
   *
   * ⚠️ A SITTING IS PLACED BY WHEN IT STARTED, which is the order the list already used and the
   * one that reads correctly: a three-hour nap belongs where it began, not where it ended, or a
   * long sitting would jump over everything that happened inside it.
   */
  const stream = useMemo(() => {
    const rows: Array<
      { at: number } & ({ kind: 'sat'; e: Entry } | { kind: 'moment'; m: Moment })
    > = []
    for (const e of seeSite ? log : didMyself)
      rows.push({ at: Date.parse(e.start), kind: 'sat', e })
    /**
     * ⚠️ A MOMENT WITH NO HOUR GOES TO THE HEAD OF ITS DAY. A workout knows which day it was and
     * not when — see `Moment.at` — so `Infinity` puts it above the day's sittings rather than
     * guessing an hour and dropping it between two of them.
     *
     * ⚠️ AND IT IS FILTERED BY THE LOCAL DAY HERE, because only the room knows what that is. The
     * server widens its window by a day on either side on purpose: `date` carries no timezone,
     * so a strict comparison there would drop or add one at the edges depending on how far the
     * viewer is from UTC.
     */
    for (const m of moments) {
      if (m.at) rows.push({ at: Date.parse(m.at), kind: 'moment', m })
      else if (m.on === seeing) rows.push({ at: Infinity, kind: 'moment', m })
    }
    return rows.sort((x, y) => y.at - x.at)
  }, [log, didMyself, moments, seeSite, seeing])

  const onSiteMs = useMemo(
    () => onSite.reduce((n, e) => n + overlapMs(e, bounds.fromMs, bounds.toMs, Date.now()), 0),
    [onSite, bounds.fromMs, bounds.toMs],
  )

  /**
   * The three category totals — and they count what you DID, not what the site noticed.
   *
   * ⚠️ `didMyself`, NOT `log`, AND THAT CHANGED A NUMBER THAT WAS WRONG. An `auto` activity is
   * the site recording itself, and it was landing in Free Time with everything else. Measured on
   * the real account over fourteen days: Free Time held **524 minutes from you across 5 rows and
   * 197 minutes from the site across 57** — so better than a quarter of the figure people judge
   * their week by was "I had a tab open", and nine rows in ten were not decisions.
   *
   * ⚠️ AND LEAVING IT IN HAD BECOME A CONTRADICTION ON ONE SCREEN. The day log already folds
   * those rows out and accounts for them on a line of its own — "1 on the site · 15m" — sitting
   * directly beneath a chip reading "Free Time 1h" that silently contained them. Two figures,
   * one screen, no way to tell that one was inside the other. The fold made the overlap visible;
   * this removes it. Site time is not hidden, it is just counted once, in the line that names it.
   *
   * ⚠️ THE MONTH GRID AND THE RAIL STILL INCLUDE IT, deliberately. "How much of this day is
   * accounted for" is a question about COVERAGE and site time genuinely covers the day; "what did
   * I spend it on" is a question about CHOICES and site time is not one. Different questions are
   * allowed different answers — what is not allowed is one question with two answers on the same
   * screen, which is what this just fixed.
   */
  const cats = useMemo(
    () => minutesByCat(didMyself, acts ?? [], bounds.fromMs, bounds.toMs, Date.now()),
    [didMyself, acts, bounds.fromMs, bounds.toMs],
  )

  /* ⚠️ `useCallback` so an effect can depend on it honestly. The autosave below has to be able
     to complain, and a plain function redefined every render either goes in the dep array and
     restarts the 700ms timer on every keystroke, or is left out and the lint rule is silenced. */
  const moan = useCallback((why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }, [])

  const after = async () => {
    await load()
    onChange?.()
  }

  /**
   * ⚠️ FLUSHED FROM `go` AND FROM `halt`, because a switch closes the sitting and a count still
   * sitting in React state when that happens is a count nobody logged. In `halt` it goes BEFORE
   * the stop: `after()` refetches the day and the local number would be overwritten by a row
   * that does not have it yet.
   */
  /**
   * ⚠️ THE DIALOG HAS TWO DOORS AND ONLY ONE OF THEM FILLED IT IN. ✎ seeds the fields in its own
   * click handler; a Stop opens the same dialog with nothing behind it, so it showed `—` for
   * both ends and "0m" in its own title. Seeding on the id covers both doors and cannot drift
   * from either.
   *
   * ⚠️ AND THE BOX STARTS EMPTY WHATEVER THE SITTING HOLDS, because it adds a NEW journal entry
   * rather than editing the last one — the existing ones are each editable in place above it.
   */
  useEffect(() => {
    const id = fixEnt ?? justDid
    if (!id) return
    const e = log.find((x) => x.id === id)
    if (!e) return
    entWas.current = { from: e.start, to: e.end }
    setEntAct(e.activity)
    setEntFrom(forInput(e.start))
    setEntTo(e.end ? forInput(e.end) : '')
    setEntAmount(e.amount == null ? '' : String(e.amount))
    setEntMood(e.quality == null ? '' : String(e.quality))
    setEntNote('')
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [fixEnt, justDid])

  /**
   * An activity by the name you typed, matched the way the server matches one.
   *
   * ⚠️ TRIMMED AND CASE-FOLDED, BECAUSE `chronicle_activities` IS UNIQUE (owner, name) AND THE
   * SAVE REFUSES A CLASH IN WORDS. Typing "gym" when you have "Gym" must start the one you have
   * rather than ask the server to make a second and come back with "you already have one called
   * gym" — which is a reasonable thing to read in a log and a terrible thing to hand somebody
   * who is trying to start a timer.
   */
  const byName = (name: string): Activity | undefined => {
    const want = name.trim().toLowerCase()
    if (!want) return undefined
    return yours.find((a) => a.name.trim().toLowerCase() === want)
  }

  /**
   * Start what is in the box: the one you have by that name, or a new one.
   *
   * ⚠️ A NEW ACTIVITY ARRIVES AS FREE TIME, which is the only honest guess — the same one
   * `chronicle_visit` makes for a room it has noticed. The category is a judgement about what a
   * thing IS and the box asked for a name; guessing Locked In from a word would put somebody's
   * afternoon in the wrong column without their having said anything about it. It is one tap to
   * change in the Activities fold, and the fold is where that decision belongs.
   */
  const startTyped = async () => {
    if (busy) return
    const name = typed.trim()
    /* nothing typed, but a chip is lit — that is the chip's choice, and it stands */
    if (!name) return pick ? void go(pick) : undefined
    const had = byName(name)
    if (had) {
      setTyped('')
      return void go(had.id)
    }
    setBusy(true)
    const made = await saveActivity(name, 'free', null, undefined, null, null)
    setBusy(false)
    if ('why' in made) return moan(made.why)
    setTyped('')
    await after()
    await go(made.id)
  }

  const flushReps = async () => {
    if (!runId || reps === repsSaved.current) return
    const want = reps
    if (await setAmount(runId, want)) repsSaved.current = want
    else moan('those reps did not save')
  }

  /**
   * ⚠️ IT CLEARS THE BOX BEFORE THE RELOAD, not after. `after()` refetches the day and the new
   * entry arrives in the list; leaving the text in the box as well would show it twice for as
   * long as the fetch took, which reads as having added it twice.
   */
  const addJournal = async (entry: string) => {
    const body = entNote.trim()
    if (!body || busy) return
    setBusy(true)
    const bad = await addNote(entry, body)
    setBusy(false)
    if (bad) return moan(bad.why)
    setEntNote('')
    await after()
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
    await flushReps()
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

  /**
   * The note, which belongs to the sitting it was typed about and used to follow you off it.
   *
   * ⚠️ THIS CAME FROM THE NOW ROOM, and it is the reason folding that room in here was not just
   * a matter of deleting a file. Now wrote the note onto the open sitting while you typed; this
   * half held it in React state and wrote it at Stop, so the two rooms disagreed about what a
   * half-typed sentence was. Measured here before this existed: with Gym running, typed "the
   * hands again, finally", tapped the Drawing chip — and the box still held the words, now
   * attached to Drawing. Not merely lost: moved onto the wrong sitting, silently, with the text
   * still on screen to make it look fine. Now's own comment records the same measurement from
   * the other side, which is how it was found.
   *
   * ⚠️ RE-SEEDED ON THE SITTING'S ID, NOT ON ITS NOTE. Keying this on `running?.note` too — which
   * is what Now did — means our own autosave echoes back through a reload and overwrites whatever
   * has been typed since. The id is the question actually being asked: is this a different
   * sitting from the one the box was filled for.
   */
  const runId = running?.id ?? null
  /**
   * The count on the sitting you are in, tapped up as you go.
   *
   * ⚠️ IT IS THE `amount` COLUMN AND THE EXISTING RPC, not a new table. A workout asked for as
   * "a now activity that has simple ui buttons to easily tap add reps" is a sitting with a
   * quantity on it, which an entry has already had since step 2 — the only thing missing was a
   * way to put a number there without typing it. `chronicle_entry_amount` takes any entry of
   * yours by id and never asks whether it has ended, so the running one was always allowed.
   *
   * ⚠️ LOCAL IS THE TRUTH WHILE YOU TAP, AND THE WRITE IS ABSOLUTE. A tap has to land on the
   * screen now — a set that is thirty reps in is not a set you want to wait for a round trip on
   * — so the count moves here and flushes on a beat. The flush SETS the total rather than adding
   * a delta, which makes it idempotent: a flush that lands twice, or out of order, still leaves
   * the number this screen is showing, where `amount = amount + n` would double a rep for every
   * retry.
   */
  const [reps, setReps] = useState<number | null>(null)
  const repsSaved = useRef<number | null>(null)
  const liveReps = useRef<number | null>(null)
  liveReps.current = running?.amount ?? null
  useEffect(() => {
    /* the count belongs to the sitting exactly as a journal entry does */
    const was = liveReps.current
    setReps(was)
    repsSaved.current = was
  }, [runId])

  /* tapped fast, written slowly: one round trip a beat after the last tap rather than one each */
  useEffect(() => {
    if (!runId || reps === repsSaved.current) return
    const t = window.setTimeout(() => void flushReps(), 600)
    return () => window.clearTimeout(t)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [reps, runId])

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
    /* ⚠️ BEFORE the stop, not after: `after()` refetches the day and the local count would be
       overwritten by the row that does not have it yet */
    await flushReps()
    /**
     * ⚠️ NULL, AND THE ASKING HAPPENS AFTER. The note box beside Stop was the only moment the
     * room ever offered to write something down, which meant deciding what a sitting was worth
     * BEFORE ending it — and getting one sentence to do it in. `chronicle_stop` still takes a
     * note and this no longer sends one; the sitting that just ended opens its own dialog, where
     * a rating is a tap and the journal takes as many entries as you like.
     */
    const bad = await stopTimer(null)
    setBusy(false)
    if (bad) return moan(bad.why)
    await after()
    /* ⚠️ the id was read BEFORE the stop — see `was` above — because afterwards the running
       entry is gone and finding it again means guessing which row just ended */
    if (was) setJustDid(was.id)
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
    const r = await saveActivity(
      n,
      actCat,
      actColour ?? '',
      fixAct,
      actMetric,
      asMins(actSession),
      actShared,
    )
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
      const w = entWas.current
      const kept = w != null && forInput(w.from) === entFrom
      const no = await fixRunning(kept ? w!.from : new Date(entFrom).toISOString(), entAct || null)
      setBusy(false)
      if (no) return moan(no.why)
      setFixEnt(null)
      await after()
      return
    }
    if (!entTo) return
    /**
     * ⚠️ REFUSED HERE, NOT ONLY GREYED. The Save button is disabled while the span is backwards,
     * which is the part a person sees — but a disabled button is a hint rather than a rule, and
     * this is the only place that knows the rule. `chronicle_entry_edit` would take the row and
     * the day would then hold a session that ends before it starts: `overlapMs` clamps it to
     * zero, so it would sit in the log reading "0m" and contribute nothing to any total, which
     * is a corrupt row that looks like an empty one.
     */
    const mins = minsBetweenLocal(entFrom, entTo)
    if (mins !== null && mins < 0) return moan('that ends before it starts')
    /* see `entWas`: an end nobody moved keeps its seconds */
    const was = entWas.current
    const sameFrom = was != null && forInput(was.from) === entFrom
    const sameTo = was?.to != null && forInput(was.to) === entTo
    setBusy(true)
    const bad = await editEntry(
      fixEnt,
      sameFrom ? was!.from : new Date(entFrom).toISOString(),
      sameTo ? was!.to! : new Date(entTo).toISOString(),
      /* ⚠️ THE NOTE IT ALREADY HAS, not null. This argument was hard-coded null, and the server
         read null as "clear it" — so opening a session's editor and pressing Save, changing
         nothing, destroyed whatever you had written about it. The server now reads null as "leave
         it alone" so no caller can lose one by forgetting; this sends the box, so you can change
         one or empty it on purpose. */
      /**
       * ⚠️ NULL, WHICH THE SERVER READS AS "LEAVE IT ALONE". `entNote` is the add-a-journal-entry
       * box now, not this session's note — sending it here would copy whatever is half-typed in
       * that box into the legacy `note` column on every Save. The journal is the one home for
       * what you write about a sitting; the column is frozen where it stood.
       */
      null,
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
            {/**
             * ⚠️ ONLY WHEN THE ACTIVITY COUNTS SOMETHING. A metric is what makes a quantity mean
             * anything — "24" against Drawing is a number with no unit, where "24 reps" against
             * Gym is the set you just did. The activity editor is where a metric is named, so
             * the row appears for the activities you have said count something and for no other.
             *
             * ⚠️ AND THE STEPS ARE +1 / +5 / +10 RATHER THAN A NUMBER FIELD. The whole request
             * was "simple ui buttons to easily tap add reps" — a keyboard between sets is the
             * thing being replaced, not the thing to offer. The one ✕ undoes a mis-tap, which is
             * the only other thing a thumb needs here.
             */}
            {(() => {
              const metric = running ? (byId.get(running.activity)?.metric ?? null) : null
              if (!metric) return null
              const at = reps ?? 0
              const bump = (by: number) => setReps(Math.max(0, Math.round(at + by)))
              return (
                <div className="chron-tally">
                  <span className="chron-tally-at">
                    <strong>{countText(at)}</strong> <span className="muted">{metric}</span>
                  </span>
                  {[1, 5, 10].map((n) => (
                    <button
                      key={n}
                      className="btn btn-ghost chron-tally-up"
                      onClick={() => bump(n)}
                      disabled={busy}
                    >
                      +{n}
                    </button>
                  ))}
                  <button
                    className="btn btn-ghost chron-tally-down"
                    onClick={() => bump(-1)}
                    disabled={busy || at === 0}
                    aria-label={`One fewer ${metric}`}
                    title={`One fewer ${metric}`}
                  >
                    −1
                  </button>
                </div>
              )
            })()}
            {/* ⚠️ THE NOTE BOX IS GONE FROM HERE. It asked what a sitting was worth before you
                had ended it, in one line — and it was the only moment the room ever offered to
                write anything down. Stopping opens a dialog instead, where the rating is a tap
                and the journal takes as many entries as you like. */}
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
        ) : null}
        <button className="btn btn-ghost" onClick={() => setAdding((v) => !v)}>
          ＋ Activity
        </button>
        {/* ⚠️ "⏱ Fill a gap" IS THE `Log past` PILL NOW. It opened a second form with its own
            copy of the activity list, so the room asked which activity in two places; the pills
            change what the one picker does instead. The hour it used to fill in is filled in by
            the pill — see `gapOpens`. */}
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

      {/**
       * ⚠️ ONE FORM WITH TWO MODES, WHICH IS THE HTML ORIGINAL'S ARRANGEMENT AND IT IS BETTER
       * THAN TWO BUTTONS. "⏱ Fill a gap" opened a separate form carrying its own copy of the
       * activity list — so the room asked "which activity" in two places three inches apart, and
       * which one you answered depended on which button you had pressed. The pills change what
       * the ONE picker below them does: start it now, or say when it was.
       *
       * ⚠️ AND SWITCHING TO `Log past` FILLS IN THE LAST HOUR, because a gap you are recording is
       * nearly always the one just behind you. `gapOpens` already knew that; it was only ever
       * reached from a button somebody had to find first.
       */}
      {show === 'day' && seeing === todayISO() && !running && yours.length > 0 && (
        <div className="chron-modes">
          <button
            className={'btn' + (gap ? ' btn-ghost' : ' is-on')}
            aria-pressed={!gap}
            onClick={() => setGap(false)}
          >
            Live
          </button>
          <button
            className={'btn' + (gap ? ' is-on' : ' btn-ghost')}
            aria-pressed={gap}
            onClick={() => {
              const o = gapOpens()
              setGapFrom(o.from)
              setGapTo(o.to)
              setGapAct(pick || (acts ?? []).find((a) => !a.archived && !a.auto)?.id || '')
              setGap(true)
            }}
          >
            Log past
          </button>
        </div>
      )}

      {seeing === todayISO() && switchable.length > 0 && (
        <div className="chron-quick">
          <span className="muted chron-quick-label">
            {running ? 'Switch to' : gap ? 'What was it' : 'Quick start'}
          </span>
          {switchable.map((a) => (
            <button
              key={a.id}
              /* ⚠️ the same chip, two meanings — and it has to SHOW which, or picking one while
                 logging past looks like it did nothing at all */
              className={
                'btn btn-ghost chron-chip-start' + (gap && gapAct === a.id ? ' is-on' : '')
              }
              aria-pressed={gap ? gapAct === a.id : undefined}
              disabled={busy}
              onClick={() => (gap ? setGapAct(a.id) : void go(a.id))}
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

      {/**
       * ⚠️ THE SLOW ROAD, AND IT SITS BELOW THE FAST ONE NOW. This select and its Start button
       * used to be the first thing in the timer row, with the one-tap chips underneath — so the
       * control that costs three taps and a scroll through a grouped list was above the control
       * that costs one, and the better path was the one you had to look past. Measured at 375
       * before the move: the first chip began **419px** down an 812px screen.
       *
       * ⚠️ IT STAYS, BECAUSE THE CHIPS ARE ONLY THE TOP SIX. `quick` is ranked by what you have
       * done today and capped at six — see `tilesFor` — so anything outside that, and everything
       * at all on a day you have not started yet, is reachable only here. A shortcut that is the
       * ONLY way in is not a shortcut.
       */}
      {!running && seeing === todayISO() && yours.length > 0 && (
        <div className="chron-else">
          {/**
           * ⚠️ TYPE IT OR PICK IT, WHICH IS WHAT THE ROOM ALWAYS MEANT. The chips are the
           * clicking half and this was a `<select>` — so "something else" meant opening a
           * grouped list and hunting, and a thing you had not named yet meant leaving to find
           * ＋ Activity first. A `<datalist>` is both: the names you have are suggestions, and
           * anything else is a new activity. The HTML version of this app has always done it
           * this way (`<input list="act-dl">`) and it is the one control that makes the room
           * usable without knowing it.
           *
           * ⚠️ AND IT DOES NOT CREATE WHILE YOU TYPE. Resolution happens on submit, so a name
           * half-entered is not an activity — otherwise "Gy" becomes a permanent activity on the
           * way to "Gym", and the list this control exists to search fills with typos.
           */}
          <label className="chron-pickrow">
            <span className="sr-only">What are you doing?</span>
            <input
              list={actsListId}
              value={typed}
              placeholder={gap ? 'What was it?' : 'What are you doing?'}
              onChange={(e) => {
                setTyped(e.target.value)
                /* an exact name is a choice, so the chips and the button agree with the box */
                const hit = byName(e.target.value)
                if (gap) setGapAct(hit?.id ?? '')
                else setPick(hit?.id ?? '')
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (!gap) void startTyped()
              }}
            />
          </label>
          <datalist id={actsListId}>
            {yours.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
          {!gap && (
            <button
              className="btn btn-ghost"
              disabled={busy || (!typed.trim() && !pick)}
              onClick={() => void startTyped()}
            >
              ▶ Start
            </button>
          )}
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

      {/**
       * ⚠️ THE SAME PICKER FEEDS BOTH, which is what the pills are for. This form used to carry
       * its own activity select — a second list of the same activities, three inches below the
       * one the chips already are — because ⏱ Fill a gap opened a form rather than changing a
       * mode. Two ways to answer "which activity" on one screen is two places for the answer to
       * differ. Now the chips and "Something else…" above choose it in either mode, and this is
       * only ever the two ends of a span.
       */}
      {gap && (
        <div className="chron-span chron-frow">
          <div className="chron-field">
            <label htmlFor="gap-from">From when</label>
            <input
              id="gap-from"
              type="datetime-local"
              value={gapFrom}
              onChange={(e) => setGapFrom(e.target.value)}
            />
          </div>
          <div className="chron-field">
            <label htmlFor="gap-to">Until when</label>
            <input
              id="gap-to"
              type="datetime-local"
              value={gapTo}
              onChange={(e) => setGapTo(e.target.value)}
            />
          </div>
          <div className="chron-field chron-span-go">
            <button className="btn" disabled={busy || !gapAct} onClick={() => void fillGap()}>
              {gapAct ? `Log ${byId.get(gapAct)?.name ?? 'it'}` : 'Pick one above'}
            </button>
          </div>
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

      {show === 'day' && onSite.length > 0 && (
        /**
         * ⚠️ IT SAYS WHAT IS BEHIND IT, in rows and in minutes, because a fold whose label is
         * just "more" is one nobody opens and nobody trusts. The minutes are the honest part:
         * they are already inside the category totals two inches above, so the line has to
         * account for them rather than let them vanish from the reading.
         */
        <button
          className="btn btn-ghost chron-site-toggle"
          aria-expanded={seeSite}
          onClick={() => setSeeSite((v) => !v)}
        >
          {seeSite ? '▾' : '▸'} {countText(onSite.length)} on the site · {spanText(onSiteMs)}
        </button>
      )}

      {/**
       * ⚠️ A DAY CAN BE ALL SITE AND NOTHING ELSE, which is a state this list did not have until
       * the fold existed: `log.length > 0` was once enough to guarantee a row. On a day you only
       * browsed, the ul rendered empty under a toggle — a heading, a button, and a silence. So
       * the condition is what will actually be DRAWN, and the sentence below says which of the
       * two reasons the list is empty for.
       */}
      {show === 'day' && stream.length === 0 && onSite.length > 0 && !seeSite && (
        <p className="muted chron-only-site">
          Nothing but the site itself today — it is all in the line above.
        </p>
      )}

      {show === 'day' && stream.length > 0 && (
        <ul className="chron-log">
          {stream.map((row) => {
            if (row.kind === 'moment') {
              const m = row.m
              const workout = m.kind === 'workout'
              /* how many it held in all, so a row cut at four can say it was cut */
              const held = workout && m.detail ? Number(m.detail) : 0
              return (
                <li
                  key={`m-${m.at ?? m.on}-${m.title}`}
                  className={'chron-moment' + (workout ? ' is-workout' : '')}
                >
                  <span className="chron-moment-what">
                    <span aria-hidden>{workout ? '🏋' : '★'}</span> {workout ? null : <>Rated </>}
                    <strong>{m.title}</strong>
                    {held > 4 ? <span className="muted"> +{held - 4} more</span> : null}
                    {m.about && !workout ? <span className="muted"> · {m.about}</span> : null}
                  </span>
                  {m.score != null ? (
                    <span className="chron-moment-score">{countText(m.score)}</span>
                  ) : null}
                  {/* ⚠️ nothing where the clock goes, rather than a guess — see Moment.at */}
                  {m.at ? (
                    <span className="muted chron-moment-when">
                      {new Date(m.at).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  ) : (
                    <span className="muted chron-moment-when">all day</span>
                  )}
                </li>
              )
            }
            const e = row.e
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
                      entWas.current = { from: e.start, to: e.end }
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
                  {/* ⚠️ THE ✕ IS GONE FROM THE ROW AND LIVES IN THE DIALOG. Two controls on every
                      row of a long list, one of which destroys a session, is most of what made the
                      log feel dense — and the dangerous one sat 4px from the harmless one at the
                      end of a 44px pair. Deleting is now a step inside the editor, beside the
                      thing being deleted and away from Save, which is the arrangement the HTML
                      version of this app uses. One tap further; one fewer thing to mis-tap. */}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/**
       * Editing a session, in a room of its own.
       *
       * ⚠️ IT WAS AN INLINE ROW AND THAT WAS THE WRONG SHAPE, not merely the wrong size. Eight
       * controls squeezed into a log row with every label `sr-only` — "very control dense" — and
       * two attempts at making it shorter only traded one cramped arrangement for another. The
       * HTML version this module is a port of solved it long ago and I had never looked: it edits
       * in a centred modal, every field under a small-caps label, start and end side by side, the
       * rating as buttons, and Delete inside the dialog rather than as a ✕ in the row. Room is
       * what a form needs, and a list row is the one place that cannot give it.
       *
       * ⚠️ AND THE SHARED `Modal` ALREADY HANDLES THE HARD PARTS — Escape, the portal, and focus
       * on open without stealing it back on every keystroke. See the long note in
       * circuit/ui/Modal.tsx about what that last one cost to get right; a second implementation
       * here would have been a second place for all of it to be wrong.
       */}
      {(() => {
        const showing = fixEnt ?? justDid
        const e = log.find((x) => x.id === showing)
        if (!e) return null
        /* ⚠️ what it SAYS differs though what it shows does not: one is an offer, one is a repair */
        const finishing = fixEnt == null
        const a = byId.get(e.activity)
        const metric = byId.get(entAct)?.metric
        const len = minsBetweenLocal(entFrom, entTo)
        const was = entWas.current
        const untouched =
          was?.to != null && forInput(was.from) === entFrom && forInput(was.to) === entTo
        const ms = untouched ? Date.parse(was.to!) - Date.parse(was.from) : (len ?? 0) * 60_000
        const when = (label: string, value: string, set: (v: string) => void) => (
          <div className="chron-field">
            <label>{label}</label>
            <div className="chron-when-row">
              <strong className="chron-when-at">{clockOfLocal(value)}</strong>
              <span className="chron-nudges">
                {NUDGES.map((n) => (
                  <button
                    key={n}
                    className="btn btn-ghost chron-nudge"
                    onClick={() => set(nudgeLocal(value, n))}
                    aria-label={`${label} ${n < 0 ? `${-n} minutes earlier` : `${n} minutes later`}`}
                  >
                    {n > 0 ? `+${n}` : n}
                  </button>
                ))}
              </span>
            </div>
          </div>
        )
        return (
          <Modal
            title={
              finishing
                ? `${spanText(ms)} of ${a?.name ?? 'that'} — how did it go?`
                : `Edit ${a?.name ?? 'this session'}`
            }
            onClose={() => {
              setFixEnt(null)
              setJustDid(null)
            }}
            footer={
              <div className="chron-modal-do">
                {/* ⚠️ DELETE LIVES HERE, AWAY FROM SAVE — the arrangement the HTML version uses,
                    and the reason a log row no longer needs a ✕ of its own beside its ✎ */}
                <button className="btn btn-ghost chron-danger" onClick={() => void forget(e)}>
                  🗑 Delete
                </button>
                <span className="chron-modal-right">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setFixEnt(null)
                      setJustDid(null)
                    }}
                  >
                    {/* ⚠️ "Done" when finishing, because there is nothing to cancel — the
                        sitting is already recorded and this dialog only ever adds to it */}
                    {finishing ? 'Done' : 'Cancel'}
                  </button>
                  <button
                    className="btn"
                    disabled={busy || (len ?? 0) < 0}
                    onClick={() => void saveEnt(metric)}
                  >
                    Save
                  </button>
                </span>
              </div>
            }
          >
            <div className="chron-field">
              <label htmlFor="ent-act">What it was</label>
              <select
                id="ent-act"
                value={entAct}
                onChange={(ev) => {
                  /* ⚠️ a quantity belongs to a metric, and moving a session changes the metric
                     under it — sixty reps is not sixty pages, so the number goes when the unit
                     does, visibly, while somebody is looking at it */
                  const before = byId.get(entAct)?.metric ?? null
                  const after = byId.get(ev.target.value)?.metric ?? null
                  if (before !== after) setEntAmount('')
                  setEntAct(ev.target.value)
                }}
              >
                {[...open, ...(a && a.archived ? [a] : [])].map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="chron-frow">
              {when('From', entFrom, setEntFrom)}
              {e.end ? when('To', entTo, setEntTo) : null}
            </div>

            {e.end && len !== null ? (
              len < 0 ? (
                <p className="chron-when-len is-wrong">That ends before it starts.</p>
              ) : (
                <p className="chron-when-len">{spanText(ms)}</p>
              )
            ) : null}

            {e.end && (
              <details className="chron-exact">
                <summary>exact times</summary>
                <div className="chron-frow">
                  <div className="chron-field">
                    <label htmlFor="ent-xf">Start</label>
                    <input
                      id="ent-xf"
                      type="datetime-local"
                      value={entFrom}
                      onChange={(ev) => setEntFrom(ev.target.value)}
                    />
                  </div>
                  <div className="chron-field">
                    <label htmlFor="ent-xt">End</label>
                    <input
                      id="ent-xt"
                      type="datetime-local"
                      value={entTo}
                      onChange={(ev) => setEntTo(ev.target.value)}
                    />
                  </div>
                </div>
              </details>
            )}

            {e.end && metric && (
              <div className="chron-field">
                <label htmlFor="ent-amt">How many {metric}</label>
                <input
                  id="ent-amt"
                  value={entAmount}
                  inputMode="decimal"
                  placeholder={metric}
                  onChange={(ev) => setEntAmount(ev.target.value)}
                />
              </div>
            )}

            {/**
             * ⚠️ BUTTONS RATHER THAN A SELECT, which is the other thing the HTML version has
             * always done — 👍 Great / 😐 OK / 👎 Rough, one tap rather than opening a list. The
             * scale here is five and stays five, because that is what every rating already
             * stored means; what changes is only how you choose one.
             *
             * ⚠️ AND TAPPING THE CHOSEN ONE CLEARS IT, so "not rated" needs no sixth button. The
             * state it returns to is the one it started in, which is the only thing an undo here
             * could sensibly mean.
             */}
            {e.end && (
              <div className="chron-field">
                <label>How did it go? (optional)</label>
                <div className="chron-pickmoods">
                  {MOODS.map(([n, word]) => (
                    <button
                      key={n}
                      className={
                        'chron-pickmood is-' + word + (entMood === String(n) ? ' is-on' : '')
                      }
                      aria-pressed={entMood === String(n)}
                      onClick={() => setEntMood(entMood === String(n) ? '' : String(n))}
                    >
                      {word}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/**
             * ⚠️ A JOURNAL, NOT A FIELD. This was one `note` column, so a sitting you wanted to
             * say three things about got one, and saying the third meant rewriting the first two.
             * Each entry keeps the moment it was written, which is the half that makes it a
             * journal rather than a longer box — "instead of just a single note id want to be
             * able to journal multiple things into an activity".
             *
             * ⚠️ AND CLEARING ONE DELETES IT, which is `chronicle_note_edit`'s own rule and the
             * one place in this room where empty means remove: a journal entry you have cleared
             * is one you did not mean to write, and a blank row is a thing to tidy up later.
             */}
            <div className="chron-field">
              <label>Journal</label>
              {e.notes.length > 0 && (
                <ul className="chron-journal">
                  {e.notes.map((n) => (
                    <li key={n.id}>
                      <time dateTime={n.at}>
                        {new Date(n.at).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
                      <textarea
                        rows={1}
                        defaultValue={n.body}
                        aria-label={`Written at ${new Date(n.at).toLocaleTimeString()}`}
                        onBlur={(ev) => {
                          if (ev.target.value.trim() === n.body) return
                          void (async () => {
                            const bad = await editNote(n.id, ev.target.value)
                            if (bad) moan(bad.why)
                            await after()
                          })()
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="chron-journal-add">
                <textarea
                  rows={1}
                  value={entNote}
                  placeholder={e.notes.length ? 'and another thing…' : 'write something down'}
                  onChange={(ev) => setEntNote(ev.target.value)}
                />
                <button
                  className="btn btn-ghost"
                  disabled={busy || !entNote.trim()}
                  onClick={() => void addJournal(e.id)}
                >
                  Add
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

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
        <WeekGrid
          on={seeing}
          log={weekLog}
          acts={acts}
          onPick={setSeeing}
          /**
           * ⚠️ TAPPING A BLOCK IS "GO AND LOOK AT THAT", which is two things and has to be both:
           * the day under it and the session's own editor. Picking the day alone would leave you
           * scanning a log for the row you had just pointed at, which is the work the tap was
           * supposed to save.
           */
          onOpen={(day, id) => {
            setSeeing(day)
            setFixEnt(id)
            const e = weekLog.find((x) => x.id === id)
            if (e) {
              entWas.current = { from: e.start, to: e.end }
              setEntAct(e.activity)
              setEntFrom(forInput(e.start))
              setEntTo(e.end ? forInput(e.end) : '')
              setEntAmount(e.amount == null ? '' : String(e.amount))
              setEntMood(e.quality == null ? '' : String(e.quality))
              setEntNote(e.note ?? '')
            }
          }}
          /**
           * ⚠️ AND TAPPING A BARE PATCH IS "I DID SOMETHING THEN", which is ⏱ Fill a gap with its
           * hour already filled in. The form is the same one the button opens — this only saves
           * typing a time you have just pointed at.
           */
          onEmpty={(day, hour) => {
            setSeeing(day)
            const p = (n: number) => String(n).padStart(2, '0')
            setGap(true)
            setGapFrom(`${day}T${p(hour)}:00`)
            setGapTo(`${day}T${p(Math.min(23, hour + 1))}:00`)
            setGapAct(pick || running?.activity || (acts ?? []).find((a) => !a.archived)?.id || '')
          }}
        />
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
                  {/**
                   * ⚠️ THE ONE CONTROL IN THIS ROOM THAT SHOWS SOMETHING TO SOMEBODY ELSE, so it
                   * says who rather than just "share". "Shared" alone would be answered with
                   * "with whom?" and the answer is not guessable: friends, never members, never
                   * the web — see docs/2026-10-23-chronicle-friends-timeline.sql for why a
                   * sitting-by-sitting record does not inherit the wider tiers the profile card
                   * may be set to.
                   *
                   * ⚠️ AND IT IS PER ACTIVITY BECAUSE THAT IS THE DECISION PEOPLE ACTUALLY MAKE.
                   * Nobody wants to rule on each sitting; everybody can say whether Gym is
                   * anybody's business. The line under it is drawn from `shared` itself rather
                   * than written once, so it cannot drift from what the tick does.
                   */}
                  <label className="chron-share">
                    <input
                      type="checkbox"
                      checked={actShared}
                      onChange={(e) => setActShared(e.target.checked)}
                    />
                    <span>Friends can see this</span>
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
                      setActShared(a.shared)
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
