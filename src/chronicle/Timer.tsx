import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  addEntry,
  dayNotesBetween,
  myExercises,
  linkExercise,
  addSet,
  dropSet,
  type MyExercise,
  setAmount,
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
import { tilesFor } from './nowTiles'
import { JournalList } from './JournalList'
import { dayLogNotes, type DayNote } from './journal'
import { localISO } from '../circuit/dates'
import { dayOfStart } from './sets'
import { LIMIT } from './limits'
import { ActivitiesFold } from './ActivitiesFold'
import { useActivityEditor } from './useActivityEditor'
import { SittingDialog } from './SittingDialog'
import { forInput, useSittingEditor } from './useSittingEditor'
import { bump as bumpTally, fresh, undo as undoTally, undoTo, type Tally } from './tally'
import {
  CATS,
  clockText,
  longRun,
  dayBounds,
  gapSince,
  sitting,
  localMidnight,
  minutesByActivity,
  minutesByCat,
  amountIn,
  metSession,
  moodWord,
  overlapMs,
  straddles,
  countText,
  spanText,
  typedMinutes,
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

/** a day either side, by local calendar arithmetic rather than by adding hours */
const dayStep = (iso: string, by: number): string => {
  const d = localMidnight(iso)
  d.setDate(d.getDate() + by)
  return localISO(d)
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
  onRunning,
  onShow,
  onIdea,
  openDay,
}: {
  day: string
  /**
   * Which half of the room is on screen. This component renders six separate things, and all six
   * at once is most of what made Chronicle unreadable: **73 controls on one screen**, answering
   * nine different questions. The room is 38 and 37 now, and the note on `half` in
   * sections/Chronicle.tsx says why that figure is not the 86 I first wrote down.
   *
   * ⚠️ THOSE TWO FIGURES ARE OLDER THAN THE FIXTURE THEY WOULD BE RE-MEASURED AGAINST, so do not
   * read them as today's count — §2's rule about a measured number in a comment, applied to this
   * one before it misleads somebody. The aims half also gains one control per goal that can be
   * started (see `startFor`), which is the only thing since that adds controls per ROW rather
   * than per room. Measured on the preview seed, 7 Nov 2026, at 375: day **26** in-room controls,
   * aims **40**, one of those being the ▶.
   *
   * ⚠️ THE STOPWATCH IS IN NEITHER HALF. Everything from the running clock down to the gap form
   * renders whatever `show` says, because a session you forgot to stop must not be able to hide
   * behind a tab — the same reason the timer sits above the horizon strip rather than inside it.
   * What `show` gates is the DAY (its stepper, totals, log, plans, routines and activity list)
   * against the AIMS half, which lives in the room above.
   */
  show: 'day' | 'aims' | 'journal' | 'friends'
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
  /**
   * What is running, told to the room above — the activity's id, or null.
   *
   * ⚠️ THE OPEN SITTING LIVES DOWN HERE AND THE AIMS HALF NEEDS IT. The ▶ on a goal row has to
   * know whether it is about to restart the thing you are already in, which `chronicle_start`
   * would do by closing that sitting and opening a new one. The alternative was a second
   * `entriesBetween` in the room above, which is the same question asked twice of the server and
   * two answers that can disagree for as long as one of them is stale.
   */
  onRunning?: (activity: string | null) => void
  /**
   * Ask the room to show the Day half — the one thing this component cannot do for itself.
   *
   * ⚠️ THE JOURNAL OPENS A SITTING ON THE DAY IT HAPPENED, and that day's log lives on the Day
   * half: the editor finds its sitting in `log`, which only holds the day being looked at, and
   * the effect above puts `seeing` back on today whenever the half is not Day. So "take me to
   * that sitting" is three moves — the day, the editor, the half — and the last belongs to the
   * room above.
   */
  onShow?: (half: 'day' | 'journal') => void
  /**
   * Hand a journal entry to the room as the first draft of a goal — see `ideaTitle` in goal.ts.
   *
   * ⚠️ THE ROOM ABOVE OWNS THE GOAL FORM, so this only says what was written; the form opens
   * there, prefilled, and nothing is saved until the person presses Add. "A dated note or idea
   * can become a task" was in the first brief for this room, and the note was the one half of the
   * room with no way into the other.
   */
  onIdea?: (text: string) => void
  /**
   * A day a link asked for — `#chronicle?day=`, see dayLink.ts. The Day log opens on it instead of
   * on `day`, and moves to it again if another link asks for a different one.
   */
  openDay?: string | null
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
  const [seeing, setSeeing] = useState(openDay ?? day)
  useEffect(() => setSeeing(day), [day])
  /* ⚠️ AFTER the effect above, which also runs on mount and would put the stepper back on `day` */
  useEffect(() => {
    if (openDay) setSeeing(openDay)
  }, [openDay])
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
  /* ⚠️ false, and it resets on every load rather than being remembered: the site's own minutes
     are a thing you look up, not a thing you read every day */
  const [seeSite, setSeeSite] = useState(false)
  /** what is in the box — see the note on the combobox for why it is not an id */
  const [typed, setTyped] = useState('')
  const actsListId = useId()
  /* bumped by ✎ Note with nothing running, so the Journal's box takes the cursor */
  const [writeNow, setWriteNow] = useState(0)
  /* the day that box writes about — a past day's ✎ Note sends that day, today's sends nothing */
  const [writeDay, setWriteDay] = useState<string | undefined>(undefined)
  /**
   * Every exercise on your own Circuit people, and what each is linked to — see units.ts.
   *
   * ⚠️ EMPTY UNTIL THE LINKS DRAFT IS APPLIED, and then for anybody with no Circuit person: the
   * activity editor shows no "From the Circuit" row and the counter counts as it always has.
   */
  const [exercises, setExercises] = useState<MyExercise[] | null>(null)
  /* the exercise the counter is counting, when the running activity has linked ones */
  const [pickEx, setPickEx] = useState<string | null>(null)
  /**
   * The sets this visit's counter wrote, newest last — what Undo takes back.
   *
   * ⚠️ A REF AND NOT THE TALLY'S OWN HISTORY, because a set is a row on the server with an id, and
   * taking one back is deleting THAT row; the tally only knows numbers.
   */
  const setStack = useRef<Array<{ id: string; value: number; name: string }>>([])
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
  /* ⚠️ ON THE ACTIVITY'S ID, NOT ON THE ENTRY. The room above only asks "is this goal's
     activity the one running", so re-announcing on every reload of the same sitting would be a
     render of the whole Aims list each time the day's log is re-fetched. */
  const runningAct = running?.activity ?? null
  useEffect(() => {
    onRunning?.(runningAct)
  }, [runningAct, onRunning])
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

  /**
   * The day's notes with no session — the third kind of row, after a sitting and a moment.
   *
   * ⚠️ PRIVATE, AND THIS IS YOUR OWN LOG: nothing here reaches Friends, which reads a different
   * function that carries no note at all. Fetched again when the Journal half hands back, since
   * that is where they are written and changed.
   */
  const [dayNotes, setDayNotes] = useState<DayNote[]>([])
  useEffect(() => {
    if (show !== 'day') return
    let dead = false
    void (async () => {
      /* ⚠️ HALF-OPEN, like every range here: [this day, the next) — asking (day, day) asks for
         nothing, and the reader refuses an empty range by returning none */
      const got = await dayNotesBetween(seeing, localISO(new Date(bounds.toMs)))
      if (!dead) setDayNotes(got)
    })()
    return () => {
      dead = true
    }
  }, [seeing, bounds.toMs, beat, show])

  useEffect(() => {
    let dead = false
    void (async () => {
      const got = await myExercises()
      if (!dead) setExercises(got)
    })()
    return () => {
      dead = true
    }
  }, [beat])

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
      { at: number } & (
        | { kind: 'sat'; e: Entry }
        | { kind: 'moment'; m: Moment }
        | { kind: 'note'; n: DayNote; timed: boolean }
      )
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
    /* ⚠️ A NOTE HAS ITS TIME ONLY IF IT WAS WRITTEN THAT DAY — see `dayLogNotes`. One written
       about this day from another goes to the head of it, with no clock, like a workout */
    for (const x of dayLogNotes(dayNotes, seeing, bounds.fromMs, bounds.toMs))
      rows.push({ at: x.at, kind: 'note', n: x.n, timed: x.timed })
    return rows.sort((x, y) => y.at - x.at)
  }, [log, didMyself, moments, dayNotes, seeSite, seeing, bounds.fromMs, bounds.toMs])

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

  /** the Activities fold's editor — see useActivityEditor */
  const actEd = useActivityEditor({ acts, busy, setBusy, moan, after })
  /** the sitting editor — see useSittingEditor */
  const sed = useSittingEditor({ log, byId, bounds, busy, setBusy, moan, after, setSeeing })
  const { fixEnt, setFixEnt, setJustDid, seedSitting, openSitting } = sed

  /**
   * ⚠️ FLUSHED FROM `go` AND FROM `halt`, because a switch closes the sitting and a count still
   * sitting in React state when that happens is a count nobody logged. In `halt` it goes BEFORE
   * the stop: `after()` refetches the day and the local number would be overwritten by a row
   * that does not have it yet.
   */

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
    if (await setAmount(runId, want)) {
      repsSaved.current = want
      setRepsFailed(false)
      setRepsSavedAt(Date.now())
    } else {
      setRepsFailed(true)
      moan('those reps did not save')
    }
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
   * ⚠️ RE-SEEDED ON THE SITTING'S ID. It once keyed on the sitting's note as well, back when a
   * sitting had one — which meant an autosave echoing back through a reload overwrote whatever
   * had been typed since. The id is the question actually being asked: is this a different
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
  /* ⚠️ ONE VALUE FOR THE COUNT AND ITS UNDO HISTORY — see tally.ts for why they cannot be two */
  const [tally, setTally] = useState<Tally>(() => fresh(null))
  const reps = tally.n
  /**
   * Whether the last flush failed, so the row can say so and offer to try again.
   *
   * ⚠️ THE ROW USED TO SAY NOTHING EITHER WAY. A failed write sent one toast and then waited for
   * the next tap to try again — so a count you stopped tapping at, on a bad connection, sat on
   * screen looking saved while the sitting held the old number. Between sets is exactly when you
   * stop tapping.
   */
  const [repsFailed, setRepsFailed] = useState(false)
  /* ⚠️ A RE-RENDER ON EVERY SAVE, which is all this is for. `repsSaved` is a ref because the
     flush guard must read the latest value, and a ref changing draws nothing — so "saving…"
     would sit on screen until the clock's next tick happened to repaint it. */
  const [, setRepsSavedAt] = useState(0)
  const repsSaved = useRef<number | null>(null)
  const liveReps = useRef<number | null>(null)
  liveReps.current = running?.amount ?? null
  useEffect(() => {
    /* the count belongs to the sitting exactly as a journal entry does */
    const was = liveReps.current
    setTally(fresh(was))
    setRepsFailed(false)
    repsSaved.current = was
    setStack.current = []
  }, [runId])

  /**
   * A press on the counter, for an exercise linked to the running activity — a SET, not a number.
   *
   * ⚠️ THE AMOUNT IS NOT WRITTEN FROM HERE. `chronicle_set_add` adds a counted set to its sitting's
   * amount in the same statement, so this moves the screen and tells the flush the server already
   * has it (`repsSaved`). Letting the absolute flush run as well would race the set: a flush that
   * landed first and a set after it counts the same reps twice.
   */
  const pressSet = async (by: number, x: MyExercise) => {
    if (!running) return
    setRepsFailed(false)
    repsSaved.current = (repsSaved.current ?? 0) + by
    setTally((t) => bumpTally(t, by))
    const r = await addSet(x.person, x.exercise, by, dayOfStart(running.start), running.id)
    if ('why' in r) {
      repsSaved.current = (repsSaved.current ?? 0) - by
      setTally((t) => bumpTally(t, -by))
      return moan(r.why)
    }
    setStack.current.push({ id: r.id, value: by, name: x.name })
  }

  /** Undo, in sets mode: the last set this visit wrote, and exactly what it added */
  const dropLastSet = async () => {
    const last = setStack.current.pop()
    if (!last) return
    repsSaved.current = Math.max(0, (repsSaved.current ?? 0) - last.value)
    setTally((t) => bumpTally(t, -last.value))
    const bad = await dropSet(last.id)
    if (bad) {
      setStack.current.push(last)
      repsSaved.current = (repsSaved.current ?? 0) + last.value
      setTally((t) => bumpTally(t, last.value))
      moan(bad.why)
    }
  }

  /** link or unlink one exercise, in the server's words when it refuses */
  const toggleLink = async (x: MyExercise, activity: string | null) => {
    if (busy) return
    setBusy(true)
    const bad = await linkExercise(x.person, x.exercise, activity)
    setExercises(await myExercises())
    setBusy(false)
    if (bad) moan(bad.why)
  }

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
    const r = await saveActivity(n, newCat, null, undefined, newMetric, typedMinutes(newSession))
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
            {/* ⚠️ `role="timer"`, which is what this is. Its implicit live setting is already
                `off` — a clock announcing every second would drown everything else on the page —
                so the role adds the name a screen reader gives it without adding any noise. */}
            <span className="chron-run" role="timer" aria-live="off">
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
             * ⚠️ A FACT AND THE WAY OUT, NEVER A QUESTION THAT HAS TO BE ANSWERED. The clock reads
             * 14:03:22 for a timer left running overnight and says nothing about yesterday, so
             * this says when it began — and that the dialog Stop opens is where the real finishing
             * time is set. It asks nothing and blocks nothing: somebody genuinely at it for five
             * hours reads one line and carries on, which is the whole difference between a fact
             * and a nag. The rule for when it appears is `longRun`, with its own tests.
             */}
            {(() => {
              const long = longRun(running.start, Date.now())
              if (!long) return null
              const t = new Date(running.start)
              const time = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              const when =
                long.daysAgo === 0
                  ? time
                  : long.daysAgo === 1
                    ? `${time} yesterday`
                    : `${t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
              return (
                <p className="chron-longrun">
                  Running since {when}. Forgot to stop? Press Stop, then set when you finished.
                </p>
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
             * thing being replaced, not the thing to offer. `−1` and Undo are the only other
             * things a thumb needs here — see the note on Undo below.
             */}
            {(() => {
              const metric = running ? (byId.get(running.activity)?.metric ?? null) : null
              if (!metric) return null
              const at = reps ?? 0
              /**
               * ⚠️ SETS MODE, WHEN THE ACTIVITY HAS EXERCISES LINKED TO IT. Each press is then a set
               * of the chosen exercise, which the Circuit sees and the count includes — see
               * `pressSet`. An activity with none counts exactly as it always has.
               */
              const linked = running
                ? (exercises ?? []).filter((x) => x.activity === running.activity && x.ok)
                : []
              const chosen =
                linked.find((x) => `${x.person}/${x.exercise}` === pickEx) ?? linked[0] ?? null
              const lastSet = setStack.current[setStack.current.length - 1]
              /**
               * ⚠️ THE UPDATER FORM, FOR THE REASON THE NUDGE BUTTONS IN THE EDITOR ALREADY
               * CARRY IN A COMMENT — and now through `tally.ts`, which is where the arithmetic
               * can be asked a question. Measured in the pane before the fix: three `+5` presses
               * inside one task gave **5 reps**; through the updater they give **15**. A thumb
               * cannot press three times inside one task, but the window is "before React
               * commits", which on a slow render is as long as the render takes.
               */
              const press = (by: number) => {
                setRepsFailed(false)
                setTally((t) => bumpTally(t, by))
              }
              const back = undoTo(tally)
              /**
               * What the row says about the server's copy.
               *
               * ⚠️ NOTHING AT ALL WHEN THERE IS NOTHING TO SAY. "0 reps · saved" on a sitting
               * that has counted nothing is a word about a non-event; the state appears the
               * moment there is a number for it to be about.
               */
              const saving = reps !== repsSaved.current
              const state = repsFailed ? (
                <button
                  className="btn btn-ghost chron-tally-retry"
                  onClick={() => void flushReps()}
                  disabled={busy}
                >
                  not saved — try again
                </button>
              ) : saving ? (
                <span className="muted chron-tally-state">saving…</span>
              ) : at > 0 ? (
                <span className="muted chron-tally-state">saved</span>
              ) : null
              return (
                /**
                 * ⚠️ BUILT FOR BETWEEN SETS. The count is the biggest thing in the row because it
                 * is the thing you glance at with your hands full; the three steps share the full
                 * width so the one you want is under the thumb wherever it lands; and the two
                 * corrections sit on their own line so a correction is never one finger-width
                 * from the thing it corrects.
                 *
                 * ⚠️ AND THE UNIT IS SAID OUT LOUD. The buttons read "+5" on screen, which is
                 * unambiguous beside "24 reps", and "Add 5 reps" to a screen reader, which has no
                 * "beside". The count is an `<output>` that announces politely, so a run of taps
                 * reads back as the number they arrived at rather than every step on the way.
                 */
                <div className="chron-tally" role="group" aria-label={`Count ${metric}`}>
                  <div className="chron-tally-head">
                    <output className="chron-tally-at" aria-live="polite" aria-atomic="true">
                      <strong>{countText(at)}</strong> <span className="muted">{metric}</span>
                    </output>
                    {state}
                  </div>
                  {/**
                   * ⚠️ SAID, BECAUSE THIS IS THE ONE CHRONICLE NUMBER THAT LEAVES CHRONICLE. A set is
                   * part of the person's Circuit cell, and the Circuit shows that cell to the
                   * circuits the person is in — while everything else in this room is private
                   * unless shared. The sitting itself, its time and its activity stay here.
                   */}
                  {chosen ? (
                    <p className="muted chron-tally-where">
                      Each set also counts in your Circuit column.
                    </p>
                  ) : null}
                  {chosen ? (
                    <div className="chron-tally-ex" role="group" aria-label="Which exercise">
                      {linked.map((x) => {
                        const key = `${x.person}/${x.exercise}`
                        const on = key === `${chosen.person}/${chosen.exercise}`
                        return (
                          <button
                            key={key}
                            type="button"
                            className={'btn btn-ghost chron-tally-pick' + (on ? ' is-on' : '')}
                            aria-pressed={on}
                            onClick={() => setPickEx(key)}
                          >
                            {x.name}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="chron-tally-steps">
                    {[1, 5, 10].map((n) => (
                      <button
                        key={n}
                        className="btn btn-ghost chron-tally-up"
                        onClick={() => (chosen ? void pressSet(n, chosen) : press(n))}
                        disabled={busy}
                        aria-label={
                          chosen ? `Add a set of ${n} ${chosen.name}` : `Add ${n} ${metric}`
                        }
                      >
                        +{n}
                      </button>
                    ))}
                  </div>
                  {chosen ? (
                    <div className="chron-tally-fix">
                      {/* ⚠️ ONE CORRECTION IN SETS MODE: Undo takes back the last SET, which is
                          what a mis-press made. A −1 would have to edit some set, and which one
                          is a question nobody between sets should have to answer. */}
                      <button
                        className="btn btn-ghost chron-tally-undo"
                        onClick={() => void dropLastSet()}
                        disabled={busy || !lastSet}
                        aria-label={
                          lastSet
                            ? `Undo — take back ${countText(lastSet.value)} ${lastSet.name}`
                            : 'Nothing to undo'
                        }
                      >
                        ↶ Undo
                      </button>
                    </div>
                  ) : (
                    <div className="chron-tally-fix">
                      <button
                        className="btn btn-ghost chron-tally-down"
                        onClick={() => press(-1)}
                        disabled={busy || at === 0}
                        aria-label={`Take 1 off — ${metric}`}
                      >
                        −1
                      </button>
                      {/**
                       * ⚠️ UNDO TAKES BACK THE LAST PRESS, WHATEVER ITS SIZE. `−1` was the only
                       * correction, so a `+10` meant as a `+1` was nine more taps to repair, made
                       * between sets with the wrong number on screen the whole time. The label says
                       * where it goes back to, because "Undo" alone does not say how far.
                       */}
                      <button
                        className="btn btn-ghost chron-tally-undo"
                        onClick={() => {
                          setRepsFailed(false)
                          setTally((t) => undoTally(t))
                        }}
                        disabled={busy || back === undefined}
                        aria-label={
                          back === undefined
                            ? 'Nothing to undo'
                            : `Undo — back to ${countText(back ?? 0)} ${metric}`
                        }
                      >
                        ↶ Undo
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            {/* ⚠️ THE NOTE BOX IS GONE FROM HERE. It asked what a sitting was worth before you
                had ended it, in one line — and it was the only moment the room ever offered to
                write anything down. Stopping opens a dialog instead, where the rating is a tap
                and the journal takes as many entries as you like. */}
            {/**
             * ⚠️ AND THAT LEFT THE JOURNAL WITH NO DOOR ANYBODY WOULD FIND. The decision above is
             * right — a one-line box beside Stop asks the wrong question at the wrong moment —
             * but the consequence it did not name is that writing something down became "press ✎
             * on the row in the day log that happens to be the one with no end on it", which is
             * two taps into a list on the other half of the room, and nothing says it is there.
             * The dialog it opens is the same dialog; this is only the door, and the journal is
             * drawn first inside it while a sitting is open so the door leads somewhere.
             *
             * ⚠️ NOT A SECOND WRITE PATH. It sets `fixEnt`, which is what the log row's ✎ sets.
             * A box here with its own `addNote` would be the third place a note has been written
             * from in this file, and the first two both lost one — see the autosave that moved a
             * sentence onto the wrong sitting, and `chronicle_running_note`, which no longer
             * exists.
             */}
            <button
              className="btn btn-ghost chron-jot"
              disabled={busy}
              onClick={() => setFixEnt(running.id)}
              title="Write something about this session, without stopping it"
            >
              ✎ Note
              {running.notes.length ? (
                <span className="chron-jot-n" aria-hidden>
                  {running.notes.length}
                </span>
              ) : null}
              <span className="sr-only">
                {running.notes.length
                  ? ` — ${running.notes.length} already written`
                  : ' — nothing written yet'}
              </span>
            </button>
            <button className="btn" disabled={busy} onClick={() => void halt()}>
              ■ Stop
            </button>
          </>
        ) : seeing !== todayISO() ? (
          /* ⚠️ a timer runs in the present or not at all. On another day the controls would be a
             lie — there is nothing to time — so the day offers the repair tools instead. */
          <>
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
            {/**
             * ⚠️ A NOTE ABOUT THIS DAY, FROM THIS DAY. The Journal's box only ever wrote about
             * today, so "slept badly on Tuesday", remembered on Thursday, had to be filed under
             * Thursday. On a past day this opens the same box on THIS day; the note keeps the moment
             * it was written, and this day's log shows it with that date and no clock. Not on a day
             * still to come: the writer refuses one, and you cannot have noticed anything about it.
             */}
            {seeing < todayISO() ? (
              <button
                className="btn btn-ghost chron-jot"
                onClick={() => {
                  setWriteDay(seeing)
                  setWriteNow((n) => n + 1)
                  onShow?.('journal')
                }}
              >
                ✎ Note
                <span className="sr-only"> — write something down about this day</span>
              </button>
            ) : null}
          </>
        ) : (
          /**
           * ⚠️ A NOTE WITHOUT A TIMER, which is the whole of "writing a note must not require
           * starting a timer". With a session running, ✎ Note writes about it; with nothing
           * running it used to be absent, so writing anything down meant timing something first.
           * This goes to the Journal and puts the cursor in its box — the one place a note with
           * no session is written and changed.
           */
          <button
            className="btn btn-ghost chron-jot"
            onClick={() => {
              setWriteDay(undefined)
              setWriteNow((n) => n + 1)
              onShow?.('journal')
            }}
          >
            ✎ Note
            <span className="sr-only"> — write something down, no session needed</span>
          </button>
        )}
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
              maxLength={LIMIT.name}
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
              maxLength={LIMIT.unit}
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
      {show === 'journal' && acts !== null && (
        <JournalList
          acts={acts}
          beat={beat}
          writeNow={writeNow}
          writeDay={writeDay}
          onOpen={(row, e) => {
            /* ⚠️ THE DAY FIRST, THEN THE HALF, in one handler so they commit together: with the
               half changed alone, the effect that resets `seeing` would run against 'journal' */
            openSitting(row.sat, e)
            onShow?.('day')
          }}
        />
      )}
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
            if (row.kind === 'note') {
              const n = row.n
              return (
                <li key={`n-${n.id}`} className="chron-moment is-note">
                  <span className="chron-moment-what">
                    <span aria-hidden>📝</span>{' '}
                    <span className="sr-only">A note only you can read: </span>
                    <span className="chron-note-text">{n.body}</span>
                  </span>
                  {/* ⚠️ THE TIME IT WAS WRITTEN, OR THE DAY — never a time on this day that the
                      note does not have. See `dayLogNotes`. */}
                  <span className="muted chron-moment-when">
                    {row.timed
                      ? new Date(n.at).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : `written ${new Date(n.at).toLocaleDateString(undefined, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}`}
                  </span>
                  {/* changed where it is written — one editor for a note, not two that drift */}
                  <button
                    type="button"
                    className="btn btn-ghost chron-x"
                    aria-label="Change this note, in the Journal"
                    onClick={() => onShow?.('journal')}
                  >
                    ✎
                  </button>
                </li>
              )
            }
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
                  {/* ⚠️ THE FIRST ONE AND A COUNT, not all of them. A sitting can hold fifty
                      journal entries and a log row is one line of a list — the row says there is
                      something to read and the editor is where it is read. */}
                  {e.picture ? (
                    <span
                      className="muted chron-ent-shot"
                      title="has a photograph"
                      aria-label="has a photograph"
                    >
                      📷
                    </span>
                  ) : null}
                  {e.notes.length ? (
                    <span className="muted chron-ent-note">
                      {e.notes[0].body}
                      {e.notes.length > 1 ? ` +${e.notes.length - 1}` : ''}
                    </span>
                  ) : null}
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
                      seedSitting(e)
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
      <SittingDialog
        ed={sed}
        log={log}
        byId={byId}
        busy={busy}
        setBusy={setBusy}
        moan={moan}
        actEd={actEd}
        open={open}
        after={after}
        onIdea={onIdea}
        onShow={onShow}
      />

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
            const e = weekLog.find((x) => x.id === id)
            if (e) openSitting(day, e)
            else {
              setSeeing(day)
              setFixEnt(id)
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
        <ActivitiesFold
          ed={actEd}
          acts={acts}
          byId={byId}
          exercises={exercises}
          mins={mins}
          busy={busy}
          after={after}
          toggleLink={toggleLink}
        />
      )}

      {say && <p className="chron-say">{say}</p>}
    </div>
  )
}
