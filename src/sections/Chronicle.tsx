import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { moveTab } from '../ui/tabStrip'
import {
  finished,
  derived,
  inScope,
  lateIn,
  pastIn,
  marksOf,
  streakAsks,
  streakOf,
  lastDay,
  reached,
  repeats,
  homeFor,
  tallyAsks,
  unitFor,
  weight,
  share,
  today as todayISO,
  tomorrow as tomorrowISO,
  windowOf,
  type Goal,
  type Scope,
} from '../chronicle/goal'
import {
  dropGoal,
  myActivities,
  myGoals,
  saveGoal,
  setProgress,
  shareGoal,
  tally,
} from '../chronicle/cloud'
import { CATS, countText, spanText, type Activity } from '../chronicle/record'
import { Timer } from '../chronicle/Timer'
import { Friends } from '../chronicle/Friends'
import { Sharing } from '../chronicle/Sharing'
import { Looking } from '../chronicle/Looking'
import { MonthGrid } from '../chronicle/MonthGrid'
import { Rail } from '../chronicle/Rail'
import { Lifetime } from '../chronicle/Lifetime'
import { Toast } from '../circuit/ui/Toast'

/**
 * Chronicle — what you are aiming at, at every cadence.
 *
 * Step 1 of docs/2026-10-12-chronicle-design.md: the goals and the horizons. No timer and no
 * record yet — those are step 2, and this is worth having without them.
 *
 * ⚠️ THE VIEWS HOLD NO RULES. Every one of them is the same question — `inScope(goal, scope, on)`
 * — asked with a different scope and day, which is the whole reason the window lives on the goal.
 * Six views that each knew their own dates would be six planners that agreed most of the time.
 */
type View = {
  id: string
  label: string
  scope: Scope
  when: () => string
  blurb: string
  /**
   * Always on the strip, even empty.
   *
   * ⚠️ SIX TABS FOR ONE GOAL. Measured on the live account: **1 goal, and six horizons to look
   * for it in** — the strip scrolled 362px at 375, so half of it was off-screen, and five of the
   * six were furniture. Three sizes of thinking carry it: today, this week, and the things that
   * take years.
   *
   * ⚠️ AND THE OTHER THREE ARE HIDDEN RATHER THAN DELETED, which is the difference between this
   * and the `quarter` removal above. That one was safe because no goal could have the scope; a
   * goal CAN be a month or a year, and a goal takes the scope of the tab it was added from — so
   * deleting the tab would strand anything already in it, unreachable and uneditable. A tab with
   * something in it always shows. You cannot make a new month goal; you can always see an old one.
   */
  core?: true
}

/**
 * ⚠️ TODAY AND TOMORROW ARE THE SAME SCOPE, DIFFERENT DAYS, which is why this is a list of views
 * rather than a list of scopes. A repeating daily goal appears in both, correctly — that is what
 * "daily" means — while a one-off anchored to tomorrow appears only in the second.
 *
 * ⚠️ AND `quarter` IS GONE, ANSWERED BY EVAN: "not worth a tab". It was only ever here because
 * the table allows the scope, and a scope the database accepts with no view to show it is a goal
 * somebody can create and never see again.
 *
 * ⚠️ WHICH IS WHY REMOVING IT IS SAFE RATHER THAN A SHORTCUT, and worth saying precisely. A goal
 * takes the scope of the TAB it is added from, so with no quarter tab the room can no longer make
 * one. The check constraint still accepts the word, deliberately: narrowing it would strand an
 * older file's goal on import instead of merely hiding it, and widening it again if the answer
 * ever changes is one statement where restoring the type and the window maths would not be. That
 * leaves exactly one door — importing a file that already contains a quarter goal — and there is
 * no such goal in any account today. If one ever arrives it is invisible rather than lost: the
 * row keeps its scope, and putting the tab back is this entry.
 */
/**
 * ⚠️ THREE NOW, AND THE THIRD IS SOMEBODY ELSE'S. Day and Aims are both about you; Friends is a
 * window onto other people's records, which is why it is a place of its own rather than a strip
 * inside the Day. Nothing of theirs appears without three separate opt-ins on their side — see
 * docs/2026-10-23-chronicle-friends-timeline.sql.
 */
type Half = 'day' | 'aims' | 'friends'

/**
 * The questions the room answers, which used to be answered at once.
 *
 * ⚠️ THE HINT IS THE HALF OF THIS THAT EARNS ITS PLACE. "Day" and "Aims" are two words I chose,
 * and the room's own blurb had to explain what "two halves" meant because the halves were not
 * labelled — so the label gets the short word and the line under it gets the question, in the
 * words somebody would use asking it.
 */
const HALVES: Array<[Half, string, string]> = [
  ['day', 'Day', 'what you are doing'],
  ['aims', 'Aims', 'what you are aiming at'],
  ['friends', 'Friends', 'what they have been up to'],
]

const VIEWS: View[] = [
  {
    id: 'today',
    label: 'Today',
    scope: 'day',
    when: todayISO,
    blurb: 'What today is for.',
    core: true,
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow',
    scope: 'day',
    when: tomorrowISO,
    blurb: 'Decided now, so tomorrow does not have to be.',
  },
  {
    id: 'week',
    label: 'This week',
    scope: 'week',
    when: todayISO,
    blurb: 'Sunday to Saturday.',
    core: true,
  },
  {
    id: 'month',
    label: 'This month',
    scope: 'month',
    when: todayISO,
    blurb: 'The calendar month.',
  },
  { id: 'year', label: 'This year', scope: 'year', when: todayISO, blurb: 'The whole year.' },
  {
    id: 'life',
    label: 'Years',
    scope: 'life',
    core: true,
    when: todayISO,
    blurb: 'No date on it — the things that take as long as they take.',
  },
]

const niceDate = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

/**
 * What a goal that has gone past was for, in words.
 *
 * ⚠️ THE WINDOW'S OWN FIRST DAY, NOT THE ANCHOR, and the first version of this got it wrong in
 * the room: a week goal anchored to Mon 5 Oct read "the week of Mon, Oct 5" while its window —
 * the one `share` measures over — was Sun 4 Oct to Sat 10 Oct. A goal made in here always anchors
 * to `windowOf(...).from`, so the two agree and the mistake is invisible; an imported one can
 * carry any day inside its window, and then the chip names a day the goal was never about. This
 * is the same shape as a unit written in a comment instead of computed.
 *
 * ⚠️ AND THE CADENCE DECIDES THE WORDS. An anchor is a date, but a MONTH goal was not about the
 * 1st and a YEAR goal was not about January 1st — naming a weekday for either is a precision the
 * goal never had. Each scope says as much as it meant and no more.
 */
const wasFor = (g: Goal): string => {
  /* `late` has already established this is a one-off with an anchor, so the window is real */
  const from = (g.anchor ? windowOf(g.scope, g.anchor)?.from : null) ?? g.anchor
  if (!from) return 'earlier'
  const d = new Date(from + 'T12:00')
  const say = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o)
  switch (g.scope) {
    case 'week':
      return `the week of ${say({ month: 'short', day: 'numeric' })}`
    case 'month':
      return say({ month: 'long', year: 'numeric' })
    case 'quarter':
      return `the quarter from ${say({ month: 'short', year: 'numeric' })}`
    case 'year':
      return say({ year: 'numeric' })
    default:
      return niceDate(from)
  }
}

export function Chronicle({ authed = false }: { authed?: boolean } = {}) {
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [view, setView] = useState('today')
  /**
   * Which half of the room is on screen.
   *
   * ⚠️ THIS IS NOT A HORIZON, and keeping the two apart is the whole point. `view` asks how far
   * ahead you are thinking — today, this week, this year — and the strip for it belongs to the
   * aims half alone, because it governs which goals are listed and which grid is drawn and
   * nothing else. `half` asks which question you are here for: what am I doing, or what am I
   * aiming at. The complaint that produced this change was that the room "looks messy and
   * confusing once you start using it", and it was right: both questions were answered at once,
   * on one screen carrying **73 controls**. It is 38 and 37 now.
   *
   * ⚠️ AND THAT FIGURE WAS 86 UNTIL IT WAS MEASURED PROPERLY, which is worth the line because
   * the wrong one was the whole justification for this change. 86 is what
   * `querySelectorAll('button, input, …').length` returns, and this room has three `<details>`
   * folds holding 30 controls between them. A closed fold's contents pass every cheap visibility
   * test there is — `display`, `visibility`, `offsetParent`, a non-zero `getBoundingClientRect()`
   * — because Chrome hides them on the UA's `::details-content` pseudo-element, which no
   * ancestor's computed style reveals. `checkVisibility()` is the only one that knows. The same
   * blind spot was in `scripts/mobile-audit.js`, which this found and which is fixed there.
   *
   * ⚠️ AND THE DAY HALF IS THE DEFAULT, because the stopwatch is what people open this room to
   * use. A room that opens on its goals makes you take a step before you can start working.
   */
  const [half, setHalf] = useState<Half>('day')
  const [adding, setAdding] = useState(false)
  /**
   * The goal the form is editing, or null when it is adding a new one.
   *
   * ⚠️ THE SAME FORM FOR BOTH, because they take the same six answers and two forms would be two
   * places for the source picker's rules to drift apart. `chronicle_goal_save` has taken an id
   * since step 1 and nothing had ever passed one — which is why a typo in a goal's name was
   * permanent, and why one of the first real goals in the database has its unit spelled "p0ints".
   */
  const [fixing, setFixing] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [every, setEvery] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * What the record says, for the goals that have a source.
   *
   * ⚠️ FETCHED SEPARATELY RATHER THAN FOLDED INTO THE GOAL LIST, because the two answer different
   * questions and change at different times: the list changes when you edit a goal, the tally
   * changes every time the timer runs. Keeping them apart means stopping a timer refreshes the
   * numbers without re-reading every goal.
   */
  const [got, setGot] = useState<Record<string, number>>({})
  /**
   * The run of windows behind each repeating goal.
   *
   * ⚠️ ITS OWN FETCH, SEPARATE FROM THE TALLY, because the two are asked about different things:
   * the tally is one window per goal and changes whenever the timer runs, while a streak is thirty
   * windows per goal and only changes when a window flips. Folding them together would mean a
   * thirty-fold query every time somebody stopped a stopwatch.
   */
  const [runs, setRuns] = useState<Record<string, number>>({})
  const [acts, setActs] = useState<Activity[]>([])
  /* ⚠️ a counter rather than a callback chain: the rail reads its own two sums, and everything
     that could change them — starting, stopping, filling a gap, an edit, a plan — already ends in
     the same `load()` the goals half uses. One number to watch beats five places to remember. */
  const [beat, setBeat] = useState(0)
  const [src, setSrc] = useState('')
  /**
   * Whether a derived goal counts minutes or the activity's own metric.
   *
   * ⚠️ IT IS ONLY A REAL CHOICE FOR ONE ACTIVITY WITH A METRIC. A category's activities have
   * different metrics, so adding pages to reps gives a number with no unit — the table refuses
   * that pairing and the save function corrects it, and the picker below simply does not offer it.
   */
  const [countWhat, setCountWhat] = useState<'minutes' | 'amount'>('minutes')
  /** the activity a goal is counted from, resolved once — null for a category or for neither */
  const srcAct = useMemo(
    () => (src.startsWith('a:') ? (acts.find((a) => a.id === src.slice(2)) ?? null) : null),
    [src, acts],
  )
  /**
   * ⚠️ WHAT THE GOAL ACTUALLY COUNTS, DERIVED RATHER THAN REMEMBERED — and this is the fix for a
   * goal that could never move. The chooser above appears only when the source is one activity
   * that names a metric, but it is a SEPARATE control from the source and it kept its answer when
   * the source moved beneath it. Pick Gym, choose "count the reps", then change the source to
   * Dishes: the chooser vanishes, `countWhat` stays on 'amount', and the save sent it.
   *
   * What that made was a goal counting a quantity its source never records. Driven in the room:
   * "Read ten books · FROM DISHES · 0 / 10 done", two inches from "Wash up every evening · FROM
   * DISHES · 12 / 10 minutes" — same activity, same twelve minutes, one of them stuck at zero for
   * ever. The same shape as every other goal that read 0 with the minutes in the totals above it.
   *
   * Derived, the remembered answer is harmless: it only reaches a save when the source can
   * actually produce one. chronicle_goal_save corrects it too, because a rule the client alone
   * keeps is a rule that lasts until the next caller.
   */
  const goalCounts: 'minutes' | 'amount' = srcAct?.metric ? countWhat : 'minutes'
  /**
   * What the room would suggest for the unit box as things stand — the word the placeholder shows.
   *
   * ⚠️ IT EXISTS TO TELL THE ROOM'S WORD FROM THE PERSON'S. `unitFor` says a typed word always
   * wins, and it must: somebody counting an activity's minutes who calls them "pomodoros" means
   * pomodoros. But the box is also FILLED from this suggestion on save, so a goal saved against
   * Gym comes back with "reps" in it — and that word is the room's, not theirs. Moving such a goal
   * to an activity counting pages left the row disagreeing with itself in one line:
   * "FROM WRITING · PAGES … 0 / 60 reps".
   *
   * So when the source changes, a box still holding the OLD suggestion is emptied and refills from
   * the new one, and a box holding anything else is left exactly alone.
   */
  const suggestedUnit = unitFor('', {
    counts: goalCounts,
    activity: srcAct,
    cat: src.startsWith('c:') ? (src.slice(2) as 'locked' | 'free' | 'life') : null,
  })
  /** how long this is guessed to take, as typed — minutes, blank for "no idea" */
  const [why, setWhy] = useState('')
  const [est, setEst] = useState('')
  /** 0 normal, 1 important, 2 urgent — see Goal.priority, which is the list's order */
  const [pri, setPri] = useState<0 | 1 | 2>(0)

  /**
   * Late goals you have ticked while looking at this view, kept on screen.
   *
   * ⚠️ BECAUSE FINISHING ONE OTHERWISE MADE IT DISAPPEAR MID-CLICK. A late goal is listed for
   * being unfinished, so the tick that finishes it removes its own row — and since a done goal
   * anchored to a window that has closed is in no list at all, a mis-tick put it permanently out
   * of reach. Measured in the room: the row went, the badge fell 2 to 1, nothing was said, and
   * there was no longer anywhere to untick it.
   *
   * Everywhere else in this room a ticked goal stays put with a line through it, so this is the
   * existing behaviour rather than a new idea. It is per-view and per-visit on purpose: leaving
   * the tab is the moment the finished work rolls off, which is what a dated goal is supposed to
   * do once it is done.
   */
  const [kept, setKept] = useState<string[]>([])

  /**
   * ⚠️ THE STRIP AND ITS PANEL ARE NAMED, which is the half `role="tablist"` needs that cannot be
   * supplied by a keyboard handler. A tab announces "3 of 6, selected" and then has to say which
   * element holds the answer; six strips on this site said it and none of them did.
   */
  const tabsId = useId()
  const panelId = `${tabsId}-panel`
  /** how many of each view has something in it, so the strip says where the work is */
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const x of VIEWS) {
      const when = x.when()
      /* ⚠️ THE LATE ONES COUNT TOO, or the strip reads 0 over a tab that has rows in it. They
         are unfinished work in that window's list, which is the only thing this number means. */
      out[x.id] = (goals ?? []).filter(
        (g) =>
          (inScope(g, x.scope, when) && !finished(g, got, when)) ||
          lateIn(g, got, x.scope, when, todayISO()),
      ).length
    }
    return out
  }, [goals, got])

  /**
   * The horizons actually on the strip: the three core ones, plus any that holds something.
   *
   * ⚠️ IT DEPENDS ON `counts`, WHICH IS WHY IT SITS HERE AND NOT BESIDE `VIEWS`. A tab appears
   * the moment a goal lands in it and goes again when that goal is finished — which is right,
   * and means the strip is never showing a window with nothing to say.
   */
  const shown = useMemo(() => VIEWS.filter((x) => x.core || (counts[x.id] ?? 0) > 0), [counts])
  /**
   * ⚠️ AND IF THE OPEN TAB STOPS BEING SHOWN, THE PANEL HAS TO FOLLOW. Finishing the last month
   * goal while looking at This month would otherwise leave the body of a window with no tab
   * above it and no way back — the strip would simply have one fewer button and the room would
   * look broken rather than tidy.
   */
  useEffect(() => {
    if (shown.length && !shown.some((x) => x.id === view)) setView(shown[0].id)
  }, [shown, view])

  const viewAt = shown.findIndex((x) => x.id === view)

  /** which streak fetch is the current one — see the note in `load` about late answers */
  const runSeq = useRef(0)

  const load = useCallback(async () => {
    if (!authed) {
      setGoals([])
      return
    }
    const [mine, a] = await Promise.all([myGoals(), myActivities()])
    setGoals(mine)
    setActs(a)
    /**
     * ⚠️ EVERY DERIVED GOAL, NOT JUST THE ONES ON SCREEN. Asking per view would mean the counts on
     * the window strip were right for the window you were looking at and zero everywhere else —
     * and the strip's whole job is to say where the work is before you go there.
     */
    /* ⚠️ DEDUPED ON THE KEY, which is now the identity of the question rather than of the goal:
       a repeating daily goal is two different asks here — today's window and tomorrow's — and
       collapsing them to one was the bug windowKey is named after */
    const asks = [
      ...new Map(
        [todayISO(), tomorrowISO()].flatMap((d) => tallyAsks(mine, d)).map((x) => [x.key, x]),
      ).values(),
    ]
    setGot(asks.length ? await tally(asks) : {})
    /**
     * ⚠️ THE STREAKS ARE NOT AWAITED, and that is a measured decision rather than a style one.
     * A streak asks about THIRTY-ONE windows per repeating goal, so ten of them is 310 questions
     * in one call. Timed against a year of a heavy user — 2,196 sessions over 19 activities —
     * that call takes **617ms**, and twenty asks take 42ms.
     *
     * `load()` is what every write waits on — `after()` calls it when you tick a goal, stop a
     * timer, edit a span. Awaiting the streaks inside it would put six tenths of a second in
     * front of every one of those, for a number that only decorates a chip. Letting it land on
     * its own turns the cost into "the flames appear a moment later" instead of "the room pauses
     * after every tap".
     *
     * ⚠️ THOSE FIGURES ARE THE ONES AFTER THE FIX, and this note used to say otherwise. The
     * function answered each ask with its own scan of the record, which was **2.75 seconds** for
     * the same 310; `chronicle_tally_one_pass` made it one pass on 13 Oct and this comment went
     * on claiming the old number — "it still costs the database the same", with a pointer to the
     * evidence "for whoever finishes it", two days after it was finished. The decision above is
     * unchanged and the reason for it is not: 617ms in front of every tap is still worth moving
     * out of the way, but it is a choice about feel rather than a workaround for a slow query.
     * See docs/2026-10-13-chronicle-tally-cost.sql, which is now the record of how it was done.
     *
     * ⚠️ AND THE ANSWER IS DROPPED IF THE GOALS HAVE MOVED ON. Without that, a slow streak reply
     * can land after a later load has already replaced the goals, painting runs for rows that are
     * no longer there — the same guard `Looking` uses for its own late answers.
     */
    const back = streakAsks(mine, todayISO())
    if (!back.length) {
      setRuns({})
      return
    }
    const mark = ++runSeq.current
    void tally(back).then((r) => {
      if (mark === runSeq.current) setRuns(r)
    })
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  /* leaving the tab is when finished work from a closed window rolls off — see `kept` */
  useEffect(() => {
    setKept([])
  }, [view])

  const v = shown.find((x) => x.id === view) ?? shown[0] ?? VIEWS[0]
  const on = v.when()
  const win = windowOf(v.scope, on)
  /**
   * The goal being changed, when one is.
   *
   * ⚠️ A GOAL'S SCOPE IS ITS OWN, NOT THE VIEW'S. The save sent `scope: v.scope`, which is right
   * for a new goal — the ＋ button says "Add to today" because you are looking at today — and
   * silently wrong for an edit, because the two are not always the same list. A quarter goal is
   * shown under the YEAR, by `homeFor`, so opening its editor in the only place it appears and
   * pressing Save — changing nothing — rewrote it into a year goal. Measured: "Read ten books
   * THIS QUARTER · 3 / 10 books" came back as "Read ten books · 3 / 10 books", and ten books a
   * quarter had quietly become ten books a year.
   *
   * ⚠️ AND THAT IS A CONSEQUENCE OF MAKING QUARTER GOALS VISIBLE. Before `homeFor` they were in
   * no list at all, so no editor could be opened on one and `v.scope` was always the goal's own
   * scope. Fixing a thing into view gives it neighbours it never had.
   */
  const beingFixed = useMemo(
    () => (fixing ? ((goals ?? []).find((g) => g.id === fixing) ?? null) : null),
    [fixing, goals],
  )

  /* ⚠️ memoised on the list and the view, because `inScope` runs per goal per render and the
     filter is the only work this component does that grows with somebody's history */
  const mine = useMemo(
    () => (goals ?? []).filter((g) => inScope(g, v.scope, on)),
    [goals, v.scope, on],
  )

  /**
   * The goals whose own window has closed with them unfinished — see `late` in goal.ts.
   *
   * ⚠️ A SECOND LIST RATHER THAN A WIDER FIRST ONE. `mine` is what this window is for, and
   * mixing a thing you failed to do last Tuesday into it would make the list stop answering
   * that question. They are drawn under a heading of their own, below, each one saying what it
   * was for — so the window's own work is still the first thing on the screen.
   */
  const overdue = useMemo(
    () =>
      (goals ?? []).filter(
        (g) => pastIn(g, v.scope, on, todayISO()) && (!finished(g, got, on) || kept.includes(g.id)),
      ),
    [goals, got, v.scope, on, kept],
  )

  const add = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    const n = Number(target)
    const hasTarget = target.trim() !== '' && Number.isFinite(n) && n > 0
    /* a new goal belongs to the list you are looking at; an existing one keeps what it is */
    const saveScope = beingFixed?.scope ?? v.scope
    const r = await saveGoal({
      id: fixing ?? undefined,
      title: t,
      scope: saveScope,
      /* ⚠️ a repeat has no anchor and a one-off must have one — the check constraint enforces
         exactly this pair, so the form cannot send a shape the table would refuse
         ⚠️ AND AN EDIT KEEPS THE ANCHOR IT HAD. Taking `win.from` would move a one-off goal onto
         whatever window is on screen, which for a quarter goal under the year is a different
         window entirely. The fallback is only for the case that has no anchor to keep: a
         repeating goal whose repeat has just been turned off, which needs one in its OWN scope. */
      anchor:
        saveScope === 'life' || every
          ? null
          : (beingFixed?.anchor ?? windowOf(saveScope, on)?.from ?? null),
      every: saveScope === 'life' ? null : every ? 1 : null,
      target: hasTarget ? n : null,
      /* ⚠️ sent on every save, which is what makes the server's "null leaves it alone" something
         to rely on rather than depend on — see docs/2026-10-13-chronicle-silent-erasures.sql. An
         empty box clears it, deliberately. */
      note: why.trim(),
      /* ⚠️ a source needs a target to count towards, which the table also insists on — a derived
         tick-box would tick itself the moment you did a minute of anything */
      activity: hasTarget && src.startsWith('a:') ? src.slice(2) : null,
      cat: hasTarget && src.startsWith('c:') ? (src.slice(2) as Activity['cat']) : null,
      counts: hasTarget ? goalCounts : 'minutes',
      /* ⚠️ a blank or unreadable guess is null, not zero: "no idea" is a real answer and zero
         minutes of work is not — see Goal.est, and `weight`, which has to count the difference */
      est: (() => {
        const n = Number(est)
        return est.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null
      })(),
      priority: pri,
      /** see `unitFor` — a target always carries a unit, and the room usually knows which */
      unit: hasTarget
        ? unitFor(unit, {
            counts: goalCounts,
            activity: srcAct,
            cat: src.startsWith('c:') ? (src.slice(2) as 'locked' | 'free' | 'life') : null,
          })
        : null,
    })
    setBusy(false)
    if ('why' in r) {
      setSay(r.why)
      window.setTimeout(() => setSay(null), 6000)
      return
    }
    setTitle('')
    setTarget('')
    setUnit('')
    setEvery(false)
    setSrc('')
    setWhy('')
    setCountWhat('minutes')
    setEst('')
    setPri(0)
    setFixing(null)
    setAdding(false)
    await load()
  }

  const bump = async (g: Goal, by: number) => {
    if (busy) return
    setBusy(true)
    await setProgress(g.id, Math.max(0, g.progress + by), g.done)
    setBusy(false)
    await load()
  }

  const tick = async (g: Goal) => {
    if (busy) return
    /* ⚠️ BEFORE THE WRITE, not after: `load()` replaces the goals and the row is re-filtered on
       that render, so an id remembered afterwards arrives too late to keep anything on screen */
    if (pastIn(g, v.scope, on, todayISO())) setKept((k) => (k.includes(g.id) ? k : [...k, g.id]))
    setBusy(true)
    await setProgress(g.id, g.progress, !g.done)
    setBusy(false)
    await load()
  }

  /**
   * Put one goal on the profile, or take it off.
   *
   * ⚠️ IT SHOWS NOTHING ON ITS OWN. The chronicle block has to be asking for goals as well, so a
   * member who ticks this and has no block — or a block that does not want goals — has published
   * nothing. Said in the title rather than left to be discovered.
   */
  const putOnProfile = async (g: Goal) => {
    setBusy(true)
    await shareGoal(g.id, !g.shared)
    setBusy(false)
    await load()
  }

  const remove = async (g: Goal) => {
    if (!window.confirm(`Delete “${g.title}”?`)) return
    setBusy(true)
    await dropGoal(g.id)
    setBusy(false)
    await load()
  }

  /**
   * What a visitor sees. Reachable only by a shared link — chronicle is `nav: member` in
   * places.ts, which explains there why it has no demo: a page of invented goals teaches nobody
   * anything. So this is a description and a door, and deliberately nothing else.
   *
   * ⚠️ IT SAID "A PLANNER" FOR EIGHT STEPS AFTER IT STOPPED BEING ONE. This copy was written at
   * step 1, when the room really was only the horizons — and it stayed while the stopwatch, the
   * record, the routines, the plans and the ratings were built on top of it. The room's own blurb
   * three lines below says "Two halves"; the pitch outside the door still said one. A sentence
   * that describes a feature is a thing a later feature can make untrue, and nothing fails when
   * it does.
   *
   * ⚠️ AND "Sign in to use it." WAS NOT A LINK. Every other members-only room pairs that sentence
   * with the house's `<a href="#signin" className="btn">` — the Circuit and Investments both do.
   * This told somebody to do something and gave them no way to do it, which is worse than saying
   * nothing: they are already on the one page that cannot help them.
   */
  if (!authed) {
    return (
      <section className="card">
        <h2 className="section-title">Chronicle</h2>
        <p className="muted">
          Two halves: a stopwatch for what you are doing, and what you are aiming at — today, this
          week, this year, and the things that take years. Point a goal at an activity and it fills
          itself in as you work.
        </p>
        <p className="muted">
          It lives in your account rather than in this browser, so it is on your phone too.
        </p>
        <a href="#signin" className="btn">
          Sign in
        </a>
      </section>
    )
  }

  return (
    <section className="card chron">
      <h2 className="section-title">Chronicle</h2>

      {/**
       * ⚠️ THE ROOM HAS TO SAY WHAT IT IS, and it did not. Reported plainly by the person who
       * asked for it and watched it get built — "i am not sure how most of it works yet" — which
       * is as clear a signal as a room can give. Every word in it was mine: scope, source,
       * repeats, and three category names he had never used.
       *
       * ⚠️ TWO SENTENCES, AND THE LONG VERSION LIVES IN A COMMENT. The page gets the shortest true
       * thing; docs/2026-10-12-chronicle-design.md gets the reasoning.
       *
       * ⚠️ AND IT IS ONE OF A PAIR — the signed-out blurb above says the same thing to somebody
       * who cannot see this. They drifted the day the Years view shipped: that commit added "and
       * the things that take years" to the signed-out one and left this one ending at "this
       * year", so the room that HAS the tab was the one not mentioning it. A horizon added here
       * is two sentences to change, not one.
       *
       * ⚠️ AND IT LOST A SENTENCE THE DAY THE HALVES GOT LABELS. It opened "Two halves. The
       * stopwatch below… The tabs under it…", which was a diagram in words because neither half
       * had a name on screen. They do now, so the blurb names them instead of describing where
       * they sit — and "the tabs under it" had stopped being true the moment the horizon strip
       * moved inside Aims. The signed-out one claims no layout, so it still reads correctly.
       */}
      {/**
       * ⚠️ THE PARAGRAPH IS GONE, AND THE STRIP BELOW ALREADY SAID IT. It explained that Day is
       * the stopwatch, Aims is what you are aiming at and Friends is other people — which is
       * word for word what the three buttons under it carry on their own faces. Fifty words
       * repeating three labels, folded or not: "id rather the ui just be simple and easy that
       * doesnt need tons of reading to make sense".
       *
       * ⚠️ FOLDING IT WAS NOT ENOUGH, which is the useful half of this. A fold makes a wall of
       * text cheaper to skip; it does not make it worth reading, and it leaves a handle on screen
       * advertising homework. The question a fold answers is "where do I put this?" and the
       * question here was "does this need to exist?" — it did not, because the thing it described
       * is visible.
       *
       * ⚠️ WHAT IT DID SAY AND THE STRIP DOES NOT is that a numbered goal can point at an
       * activity and fill itself in. That is one fact, it belongs where goals are, and the Aims
       * half has a blurb of its own per horizon — so it is said there or not at all, rather than
       * to everybody on arrival.
       */}
      {/**
       * ⚠️ THE TIMER COMES FIRST, which is what this comment claimed while the element sat below
       * the window strip — the layout and the sentence disagreed and the sentence was the one I
       * had read. A running clock is the one thing in this room that is true regardless of which
       * horizon you are looking at, so a session you forgot to stop must not be able to hide
       * behind a tab.
       *
       * ⚠️ AND THE DAY IT WRITES INTO FOLLOWS THE VIEW only for Today and Tomorrow, because those
       * are the two views that name a day. The longer windows show the record for today.
       */}
      {/**
       * ⚠️ THE TIMER AND THE RAIL ARE ONE ROW at a width that has room for it, which is the shape
       * the HTML app has and this did not. Below 900px the rail drops under the timer rather than
       * squeezing it — a 15rem column beside a stopwatch on a phone is two things too narrow to
       * read instead of one of each.
       */}
      {/**
       * ⚠️ THE ROOM'S OWN NAV, above the body rather than inside the timer, because the strip
       * governs the whole room and the timer is one of the things it governs. It sits over
       * `chron-body` so that in the day half the order is strip → day → stopwatch → log, and in
       * the aims half strip → stopwatch → horizon strip → goals: the stopwatch under the strip
       * either way, which is the one thing that must not move.
       */}
      {/**
       * ⚠️ NOT A TABLIST, and the horizon strip below it is. A tab needs a panel, and the day
       * half's panel is six blocks inside `Timer` with no element of its own to point an
       * `aria-controls` at — inventing one to satisfy the pattern would be a wrapper that exists
       * for a screen reader and lies to it about what it holds. Two pressed buttons is what this
       * is, so that is what it says.
       */}
      <div className="chron-halves">
        {HALVES.map(([id, label, hint]) => (
          <button
            key={id}
            aria-pressed={half === id}
            className={'btn' + (half === id ? ' is-on' : ' btn-ghost')}
            onClick={() => setHalf(id)}
          >
            {label}
            <small>{hint}</small>
          </button>
        ))}
      </div>

      <div className={'chron-body' + (acts.length ? '' : ' is-alone')}>
        <div className="chron-main">
          <Timer
            day={v.scope === 'day' ? on : todayISO()}
            beat={beat}
            onChange={() => {
              setBeat((n) => n + 1)
              void load()
            }}
            show={half}
          />
        </div>
        {/**
         * ⚠️ THE SAME RULE AS THE WEEK GRID ABOVE: a rail reading 0%, 0m, 0m and "0% of the day"
         * beside a room nobody has used yet is four zeros where one instruction belongs. The big
         * number is the most prominent thing on the screen, and for a new member it would be a
         * verdict on a day they have not had a chance to spend.
         */}
        {half === 'day' && acts.length > 0 && (
          <Rail day={v.scope === 'day' ? on : todayISO()} acts={acts} tick={beat} />
        )}
      </div>

      {/* ⚠️ the counts are UNFINISHED work, not totals — a strip of totals tells you how much you
          have written down, which is not a thing anybody needs to know at a glance */}
      {/**
       * ⚠️ THE WHOLE AIMS HALF, strip and panel together, because the strip is the panel's own
       * filter rather than a second navigation. Splitting them would leave a horizon chooser on
       * screen with nothing on screen for it to choose between.
       */}
      {half === 'friends' && (
        <>
          {/* ⚠️ THE SWITCH SITS ABOVE THE LIST IT GOVERNS. This is the screen that is empty
              because sharing is off, so it is the screen that must be able to turn it on — the
              old empty state named three switches in prose and linked to none of them. */}
          <Sharing authed={authed} />
          <Friends authed={authed} />
        </>
      )}

      {half === 'aims' && (
        <>
          <div className="chron-strip" role="tablist" aria-label="How far ahead">
            {shown.map((x, i) => (
              <button
                key={x.id}
                role="tab"
                id={`${tabsId}-${i}`}
                aria-selected={view === x.id}
                aria-controls={panelId}
                /**
                 * ⚠️ ONE TAB STOP FOR THE WHOLE STRIP, which is the contract `role="tablist"` takes
                 * on. Six buttons meant six stops on the way past, and the arrow keys — the thing a
                 * tablist tells a screen reader to expect — did nothing at all. Declaring the role
                 * and not keeping it is worse than six plain buttons, because the announcement
                 * promises a behaviour that is not there.
                 */
                tabIndex={view === x.id ? 0 : -1}
                className={'btn chron-tab' + (view === x.id ? ' is-on' : ' btn-ghost')}
                onKeyDown={(e) =>
                  moveTab(e, i, shown.length, (n) => {
                    setView(shown[n].id)
                    setAdding(false)
                  })
                }
                onClick={() => {
                  setView(x.id)
                  setAdding(false)
                }}
              >
                {x.label}
                {counts[x.id] ? <span className="chron-count">{counts[x.id]}</span> : null}
              </button>
            ))}
          </div>

          {/**
           * ⚠️ ONE PANEL FOR SIX WINDOWS, because the element is reused rather than swapped: every
           * window draws the same blurb, the same weight line and the same list from different data,
           * so there is one box here and the label follows the open tab.
           *
           * ⚠️ AND IT ENDS BEFORE `YourCopy`. What belongs to the window goes inside; what is about
           * the whole record does not — see the note down there, which was already saying so about a
           * tab body that had no element to be outside of.
           */}
          <div id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-${viewAt}`}>
            <p className="muted chron-blurb">
              {v.blurb}
              {win && v.scope !== 'life' ? (
                <>
                  {' '}
                  <span className="chron-win">
                    {v.scope === 'day'
                      ? niceDate(win.from)
                      : /* ⚠️ lastDay, not `win.to` — the end is exclusive, so naming it would tell
                     somebody their month runs to the 1st of the next one. The arithmetic lives in
                     goal.ts where it is tested; it was briefly here, done with toISOString, which
                     is the UTC trap dates.ts opens with a warning about. */
                        `${niceDate(win.from)} – ${niceDate(lastDay(win))}`}
                  </span>
                </>
              ) : null}
            </p>

            {/**
             * ⚠️ IT SAYS WHAT IT COULD NOT COUNT, and that is the whole reason this is two sentences
             * rather than one number. An estimate is optional, so the minutes are a FLOOR — "about 50m"
             * on a day with three unguessed things in it is not a fifty-minute day, and showing the
             * total alone would understate it silently, which is worse than not showing it. See
             * `weight`, whose answer deliberately has no single figure in it.
             *
             * ⚠️ AND IT IS ABSENT WHEN THERE IS NOTHING TO SAY. An empty window already has its own
             * sentence below, and "0 left" under a heading is a line that only ever states the obvious.
             */}
            {(() => {
              const w = weight(goals ?? [], got, v.scope, on, todayISO())
              if (!w.left) return null
              const parts = [`${w.left} left`]
              if (w.mins > 0) parts.push(`about ${spanText(w.mins * 60_000)}`)
              if (w.vague > 0)
                parts.push(w.mins > 0 ? `${w.vague} unguessed` : `none of them guessed at`)
              return <p className="muted chron-weight">{parts.join(' · ')}</p>
            })()}

            {goals === null ? (
              <p className="muted" aria-busy>
                Loading…
              </p>
            ) : (
              <>
                {/**
                 * ⚠️ SEVEN EMPTY TABS IS NOT AN EMPTY STATE. With nothing made yet the room was a strip
                 * of windows over "Nothing here yet", which says where you are and not what to do — and
                 * the two things to do are in two different places, one of them above this list. So
                 * while there is nothing at all, the room says the steps in order and stops pretending
                 * the tabs are useful.
                 *
                 * ⚠️ AND IT GOES AWAY FOR GOOD once anything exists, like the instrument's start row:
                 * scaffolding that never leaves is how a room gets cluttered by the help it needed once.
                 */}
                {!goals.length && !acts.length ? (
                  <ol className="chron-first">
                    <li>
                      <strong>Name something you do.</strong> Press ＋ Activity up there —
                      "Drawing", "Dishes", "Work". Each one is Locked In, Free Time or Life.
                    </li>
                    <li>
                      <strong>Press Start when you begin it</strong>, Stop when you are done. That
                      is the record, and it keeps running if you close the tab.
                    </li>
                    <li>
                      <strong>Then aim at something.</strong> Add a goal below — a tick-box, or a
                      number like 30 minutes. Point a number at an activity and you never have to
                      tick it.
                    </li>
                  </ol>
                ) : null}
                <ul className="chron-list">
                  {/* ⚠️ ONE MAP OVER BOTH LISTS, not two lists with two row renderers. A late goal is an
                ordinary goal that wants the same tick, meter, editor and ✕ as any other — a second
                copy of this block would be the place where those four quietly drift apart. The
                heading is emitted at the boundary instead. */}
                  {[...mine, ...overdue].map((g, i) => {
                    const isLate = i >= mine.length
                    const s = share(g, got, on)
                    const done = finished(g, got, on)
                    const auto = derived(g)
                    const have = reached(g, got, on)
                    /**
                     * ⚠️ FREE, WHICH IS THE WHOLE REASON IT EXISTS. `streakAsks` already fetches
                     * thirty-one windows for every repeating goal and the chip throws all but the run
                     * away — the room was paying for a month of history and showing one number. These
                     * are the same answers, read instead of discarded: no query, no state, no load.
                     */
                    const marks = marksOf(g, runs)
                    const act = g.activity ? acts.find((a) => a.id === g.activity) : null
                    const from = g.activity
                      ? (act?.name ?? 'an activity')
                      : g.cat
                        ? (CATS.find(([c]) => c === g.cat)?.[1] ?? g.cat)
                        : null
                    /* ⚠️ "from Writing · pages" rather than just "from Writing", because two goals on
                 one activity — an hour a day AND four pages a day — are otherwise identical on
                 screen while measuring completely different things */
                    const fromWhat =
                      auto && g.counts === 'amount' && act?.metric ? act.metric : null
                    /* an activity that has been archived; a category source cannot be, so `cat` is never
                 gone and only a goal pointing at an activity can say this */
                    const srcGone = !!act?.archived
                    return (
                      <Fragment key={g.id}>
                        {i === mine.length ? (
                          /* ⚠️ AN <li> BECAUSE IT LIVES IN A <ul>: a heading between two list items is
                       not a child a list may have. It keeps its text for a screen reader, which
                       is the only thing saying why these rows are not part of the window above. */
                          <li className="chron-before">From before</li>
                        ) : null}
                        <li className={'chron-goal' + (done ? ' is-done' : '')}>
                          <div className="chron-goal-top">
                            {s == null ? (
                              <label className="chron-tick">
                                <input
                                  type="checkbox"
                                  checked={g.done}
                                  onChange={() => void tick(g)}
                                />
                                <span>{g.title}</span>
                              </label>
                            ) : (
                              <span className="chron-name">{g.title}</span>
                            )}
                            {/* ⚠️ "every day" rather than "repeats": the useful half of the fact is the
                        cadence and the room already knows it, so a chip saying only that a thing
                        repeats is a label that raises the question it should answer */}
                            {repeats(g) ? (
                              <span className="chron-chip">every {g.scope}</span>
                            ) : null}
                            {/**
                             * ⚠️ A CADENCE THE ROOM HAS NO VIEW FOR SAYS SO. `homeFor` lists a quarter goal
                             * under the year, because the year is the nearest cadence left and the
                             * alternative — which is what happened — is a goal in no list at all. But an
                             * unlabelled quarter goal sitting among the year's would be a quiet lie about
                             * what it is, and the member needs to know in order to edit it into something
                             * the room does show.
                             */}
                            {!repeats(g) && homeFor(g.scope) !== g.scope ? (
                              <span
                                className="chron-chip"
                                title={`A ${g.scope} goal, listed here because the room has no ${g.scope} view`}
                              >
                                this {g.scope}
                              </span>
                            ) : null}
                            {/**
                             * ⚠️ WHAT IT WAS FOR, because the row is in a window it does not belong to.
                             * The heading says these are from before; only this says from WHEN, and
                             * without it a goal under Today looks like a goal for today that the room has
                             * decided to shout about.
                             */}
                            {isLate ? (
                              <span
                                className="chron-chip is-late"
                                title={`Not finished, and the ${g.scope} it was for has ended`}
                              >
                                was for {wasFor(g)}
                              </span>
                            ) : null}
                            {/**
                             * ⚠️ FLAGGED ONLY WHEN IT IS FLAGGED. Ordinary is the overwhelming majority, and
                             * a chip reading "ordinary" on every row would be noise that makes the two that
                             * matter harder to find rather than easier — which is the opposite of what a
                             * priority is for. The order already puts these at the top; the chip says why.
                             */}
                            {g.priority > 0 ? (
                              <span
                                className={
                                  'chron-chip is-pri' + (g.priority === 2 ? ' is-now' : '')
                                }
                                title={g.priority === 2 ? 'Urgent' : 'Important'}
                              >
                                {g.priority === 2 ? 'urgent' : 'important'}
                              </span>
                            ) : null}
                            {/* ⚠️ "~20m" with the tilde, because it is a guess and a bare "20m" beside a
                        row that also carries real measured minutes reads as one of them */}
                            {g.est != null ? (
                              <span
                                className="chron-chip is-est"
                                title="How long you thought it would take"
                              >
                                ~{spanText(g.est * 60_000)}
                              </span>
                            ) : null}
                            {/**
                             * ⚠️ TWO IN A ROW IS THE FLOOR, because "a streak of 1" is just "done", and a
                             * badge that appears the first time you do anything teaches nobody that it
                             * means anything. It earns its place on the second window.
                             */}
                            {(() => {
                              const run = streakOf(g, runs)
                              return run >= 2 ? (
                                <span
                                  className="chron-chip is-run"
                                  title={`${run} ${g.scope}s in a row`}
                                >
                                  🔥 {run}
                                </span>
                              ) : null
                            })()}
                            {/* ⚠️ a derived goal says WHERE its number comes from, because a number that
                        moves on its own and does not say why reads as a bug rather than a feature */}
                            {/**
                             * ⚠️ AND IT SAYS WHEN THAT SOURCE IS ARCHIVED, which is the same lesson
                             * `readRoutine` was written for one surface over: an archived activity can
                             * never gain another minute, because `chronicle_start` refuses one with an
                             * `archived_at`. So a derived goal pointing at one reads 0 / 30 for ever and
                             * the room said nothing — the only clue was a number that had stopped
                             * moving, which reads as a bug in the counting rather than a consequence of
                             * something you did on purpose.
                             *
                             * ⚠️ IN THE TEXT, NOT ONLY THE TITLE. A tooltip does not exist on a phone,
                             * and this is the whole explanation for the row; the title carries the
                             * advice, the chip carries the fact.
                             */}
                            {from ? (
                              <span
                                className={'chron-chip is-auto' + (srcGone ? ' is-gone' : '')}
                                title={
                                  srcGone
                                    ? `${from} is archived — this cannot move again until you bring it back, or point the goal somewhere else`
                                    : undefined
                                }
                              >
                                from {from}
                                {fromWhat ? ' · ' + fromWhat : ''}
                                {srcGone ? ' · archived' : ''}
                              </span>
                            ) : null}
                            {/* ⚠️ next to the delete rather than on the title, unlike the activity rows:
                        a goal's title is already a checkbox for the tick-box kind, and a label
                        that both ticks and opens an editor is a label you cannot press safely */}
                            {/**
                             * ⚠️ THE THREE MOVE AS ONE, the way a log row's do — see `.chron-ent-do`. They
                             * were siblings of the title in a wrapping row, which is survivable with two
                             * of them and not with three: at 375 "Water the plants" put ✎ and ○ on the
                             * title's line and left ✕ alone on the next, under an empty space. Every
                             * measurement said the room was fine, because a wrap is not an overflow — the
                             * same way the day log read clean this morning with its buttons orphaned.
                             */}
                            <span className="chron-goal-do">
                              <button
                                className="btn btn-ghost chron-x"
                                onClick={() => {
                                  setFixing(g.id)
                                  setAdding(true)
                                  setTitle(g.title)
                                  setTarget(g.target == null ? '' : String(g.target))
                                  setUnit(g.unit ?? '')
                                  setEvery(repeats(g))
                                  setSrc(g.activity ? 'a:' + g.activity : g.cat ? 'c:' + g.cat : '')
                                  setCountWhat(g.counts)
                                  setEst(g.est == null ? '' : String(g.est))
                                  setPri(g.priority)
                                  setWhy(g.note ?? '')
                                }}
                                aria-label={`Change ${g.title}`}
                                title={`Change ${g.title}`}
                              >
                                ✎
                              </button>
                              {/**
                               * ⚠️ A WORD, NOT ONLY A GLYPH, in the label — this one decides whether other
                               * people read the title of something you wrote about your own life, and
                               * "share" is too consequential to be explained by a tooltip nobody on a phone
                               * will see. The title names the other half of the switch, because a tick here
                               * alone genuinely does nothing.
                               */}
                              <button
                                className={'btn btn-ghost chron-x' + (g.shared ? ' is-on' : '')}
                                onClick={() => void putOnProfile(g)}
                                aria-label={
                                  g.shared
                                    ? `${g.title} is on your profile — take it off`
                                    : `Put ${g.title} on your profile`
                                }
                                title={
                                  g.shared
                                    ? 'On your profile, if your Chronicle block is showing goals'
                                    : 'Put this on your profile'
                                }
                              >
                                {g.shared ? '◉' : '○'}
                              </button>
                              <button
                                className="btn btn-ghost chron-x"
                                onClick={() => void remove(g)}
                                aria-label={`Delete ${g.title}`}
                                title={`Delete ${g.title}`}
                              >
                                ✕
                              </button>
                            </span>
                          </div>
                          {/**
                           * ⚠️ UNDER THE TITLE, NOT BESIDE IT. Everything else on that row is a chip or a
                           * number — a cadence, a flag, a bar — and a sentence wedged among them would
                           * either push them off the end or be clipped to a word. This is the only part of
                           * a goal that can be prose, so it gets its own line and wraps.
                           */}
                          {g.note ? <p className="muted chron-goal-why">{g.note}</p> : null}
                          {s != null && (
                            <div className="chron-meter">
                              <div className="chron-bar">
                                <i style={{ width: `${Math.round(s * 100)}%` }} />
                              </div>
                              <span className="chron-num">
                                {/* ⚠️ rounded for reading, and the raw value is never shown: minutes come
                            back as a fraction of a minute from the overlap sum, and "29.983 / 30"
                            is a number that looks broken rather than nearly done.
                            ⚠️ AND GROUPED, by countText — the seed's own "20,000 reps" read
                            "180 / 20000 reps" here, the same number twice in two notations.
                            `g.target!` is safe because `s != null` IS "target is a positive
                            number" — see share(), which TypeScript cannot narrow through. */}
                                {countText(auto ? Math.round(have) : have)} / {countText(g.target!)}{' '}
                                {g.unit}
                              </span>
                              {/* ⚠️ NO PLUS AND MINUS ON A DERIVED GOAL. There is nothing to press — the
                          record is the number — and buttons that looked like they moved it would
                          either lie or fight the next tally. */}
                              {!auto && (
                                <>
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => void bump(g, -1)}
                                  >
                                    −
                                  </button>
                                  <button className="btn btn-ghost" onClick={() => void bump(g, 1)}>
                                    +
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/**
                           * ⚠️ ONE MARK PER WINDOW ALREADY FETCHED — see marksOf. The chip says "🔥 4"; this
                           * says which four, and what the month around them looked like. It costs no query.
                           *
                           * ⚠️ IT IS NOT A CONTROL, so it carries no touch target and nothing to press. A
                           * month of history you can tap is a month of history somebody taps by accident
                           * while scrolling.
                           *
                           * ⚠️ AND IT IS READ ALOUD AS A SENTENCE. Thirty-one `<i>`s are thirty-one pieces
                           * of nothing to a screen reader, so the row is aria-hidden and the count sits
                           * beside it in sr-only text — the same division the tick-boxes use.
                           */}
                          {marks.length > 0 && (
                            <>
                              <div className="chron-marks" aria-hidden>
                                {marks.map((m, i) => (
                                  <i key={i} className={'is-' + m} />
                                ))}
                              </div>
                              <span className="sr-only">
                                {marks.filter((m) => m === 'met').length} of the last {marks.length}{' '}
                                {g.scope}s reached
                              </span>
                            </>
                          )}
                        </li>
                      </Fragment>
                    )
                  })}
                </ul>

                {!mine.length && !overdue.length && <p className="muted">Nothing here yet.</p>}

                {adding ? (
                  <div className="chron-add">
                    <label>
                      <span className="sr-only">What is the goal?</span>
                      <input
                        autoFocus
                        value={title}
                        placeholder={v.scope === 'life' ? 'Learn to animate' : 'What needs doing?'}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void add()}
                      />
                    </label>
                    <label className="chron-qty">
                      <span className="sr-only">A number to reach, if there is one</span>
                      <input
                        value={target}
                        inputMode="decimal"
                        placeholder="100"
                        onChange={(e) => setTarget(e.target.value)}
                      />
                    </label>
                    {/**
                     * ⚠️ MINUTES, SAID IN THE PLACEHOLDER, because a bare number box next to another
                     * bare number box is two fields nobody can tell apart. "20m?" says both the unit and
                     * that it is optional.
                     */}
                    <label className="chron-qty">
                      <span className="sr-only">How long will it take? In minutes</span>
                      <input
                        value={est}
                        inputMode="numeric"
                        placeholder="20m?"
                        onChange={(e) => setEst(e.target.value)}
                      />
                    </label>
                    {/**
                     * ⚠️ "WHY" RATHER THAN "NOTE", because the field is only worth a box if it asks a
                     * question somebody wants to answer. A goal's title says what; the one thing that
                     * goes stale about a goal is the reason you set it, which is exactly what you want
                     * back in March about something written in January.
                     *
                     * ⚠️ AND IT WRAPS TO ITS OWN LINE in the row, because it is the only part of this
                     * form that can be a sentence — the same reason the goal row shows it under the
                     * title rather than among the chips.
                     */}
                    <label className="chron-whyfor">
                      <span className="sr-only">Why does this matter? Optional</span>
                      <input
                        value={why}
                        placeholder="why, if it helps"
                        onChange={(e) => setWhy(e.target.value)}
                      />
                    </label>
                    <label className="chron-choice">
                      <span className="sr-only">How much does it matter?</span>
                      <select
                        value={String(pri)}
                        onChange={(e) => setPri(Number(e.target.value) as 0 | 1 | 2)}
                      >
                        <option value="0">ordinary</option>
                        <option value="1">important</option>
                        <option value="2">urgent</option>
                      </select>
                    </label>
                    <label className="chron-qty">
                      <span className="sr-only">What the number counts</span>
                      {/**
                       * ⚠️ THE HINT IS WHAT LEAVING IT BLANK ACTUALLY GIVES YOU, which "points" was not.
                       * The box is optional and `unitFor` fills it from what the room already knows —
                       * minutes for a goal counting an activity's time, that activity's own metric for
                       * one counting an amount, "done" only where nothing can be known. A placeholder
                       * naming a fourth word nobody will get is a guess the reader has to un-learn, and
                       * it changes as the source does, so the preview is live.
                       */}
                      <input
                        value={unit}
                        placeholder={unitFor('', {
                          counts: goalCounts,
                          activity: srcAct,
                          cat: src.startsWith('c:')
                            ? (src.slice(2) as 'locked' | 'free' | 'life')
                            : null,
                        })}
                        onChange={(e) => setUnit(e.target.value)}
                      />
                    </label>
                    {/**
                     * ⚠️ ONLY WHEN THERE IS A NUMBER TO COUNT, and only when the window can be added up.
                     * A source on a tick-box has nothing to count towards, and a source on a lifetime
                     * goal has no window to count over — both are refused one layer down, so offering
                     * them here would be offering a thing that cannot be saved.
                     */}
                    {target.trim() !== '' && v.scope !== 'life' && acts.length > 0 && (
                      <label className="chron-choice">
                        <span className="sr-only">Counted from what?</span>
                        <select
                          value={src}
                          onChange={(e) => {
                            /* ours to update, theirs to keep — see `suggestedUnit` */
                            if (unit.trim() === suggestedUnit) setUnit('')
                            setSrc(e.target.value)
                          }}
                        >
                          <option value="">I will count it myself</option>
                          {/**
                           * ⚠️ AN ARCHIVED ACTIVITY STAYS IN THE LIST WHILE IT IS THE ONE SELECTED, the
                           * same rule the plan form already uses. Without it the picker had no option
                           * matching the goal's source, so it rendered blank — which reads as "I will
                           * count it myself" — on a goal whose own row two inches away said FROM DRAWING.
                           * A control that shows a different current value from the thing it edits is a
                           * lie about state, and the one somebody acts on.
                           *
                           * ⚠️ THE DATA WAS NEVER AT RISK, which is worth saying because the shape looks
                           * exactly like §8's silent erasure. `src` is React state set when the editor
                           * opens; a `<select>` whose value matches no option displays empty without
                           * changing it, so pressing Save kept `activity=pv-draw`. Measured before
                           * fixing: before and after both `activity=pv-draw counts=minutes`.
                           */}
                          <optgroup label="count my time on…">
                            {acts
                              .filter((a) => !a.archived || src === 'a:' + a.id)
                              .map((a) => (
                                <option key={a.id} value={'a:' + a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="count all my time that is…">
                            {CATS.map(([c, label]) => (
                              <option key={c} value={'c:' + c}>
                                {label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                    )}
                    {/**
                     * ⚠️ ONLY WHEN THE SOURCE IS ONE ACTIVITY THAT COUNTS SOMETHING. Without a metric
                     * there is nothing to choose between, and for a category the choice is meaningless —
                     * so the control appears exactly when it is a real question and never as a dropdown
                     * with one answer.
                     */}
                    {(() => {
                      const picked = srcAct
                      return picked?.metric ? (
                        <label className="chron-choice">
                          <span className="sr-only">Count what?</span>
                          <select
                            value={countWhat}
                            onChange={(e) => {
                              /* the same question: "count the reps" instead of the time changes the
                           word the room would suggest, so its own word follows and yours does not */
                              if (unit.trim() === suggestedUnit) setUnit('')
                              setCountWhat(e.target.value as 'minutes' | 'amount')
                            }}
                          >
                            <option value="minutes">count the time</option>
                            <option value="amount">count the {picked.metric}</option>
                          </select>
                        </label>
                      ) : null
                    })()}
                    {v.scope !== 'life' && (
                      <label className="chron-rep">
                        <input
                          type="checkbox"
                          checked={every}
                          onChange={(e) => setEvery(e.target.checked)}
                        />
                        <span>every {v.scope}</span>
                      </label>
                    )}
                    <button
                      className="btn"
                      disabled={!title.trim() || busy}
                      onClick={() => void add()}
                    >
                      {fixing ? 'Save' : 'Add'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setAdding(false)
                        setFixing(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn"
                    onClick={() => {
                      /* ⚠️ cleared on the way in, or opening Add straight after a Cancel would show the
                   goal you were editing and quietly save over it */
                      setFixing(null)
                      setTitle('')
                      setTarget('')
                      setUnit('')
                      setEvery(false)
                      setSrc('')
                      setWhy('')
                      setCountWhat('minutes')
                      setEst('')
                      setPri(0)
                      setAdding(true)
                    }}
                  >
                    ＋ Add to {v.label.toLowerCase()}
                  </button>
                )}

                {/**
                 * ⚠️ LOOKING BACK, FOR THE WINDOWS WHERE IT IS THE ONLY WAY TO SEE ANYTHING. Today and
                 * Tomorrow have the Timer log above, entry by entry with the times on them, which is
                 * strictly more than a total — showing both would be one day said twice. A week, a
                 * month, a quarter and a year have no other view at all, which was the biggest hole in
                 * the room: it recorded a life and could not show it back.
                 *
                 * ⚠️ AND NOT FOR Years, which has no window to add up: all-time totals are a different
                 * question, and `chronicle_totals` caps a range at 400 days, so answering it with THIS
                 * component would mean quietly showing a year and calling it everything. Years asks that
                 * different question properly a few lines down — see `Lifetime`, which is why this note
                 * says "not for Years" rather than "nothing for Years".
                 */}
                {/**
                 * ⚠️ THE CALENDAR BEFORE THE BARS, and only for the month. The bars say WHAT the month
                 * held; the calendar says WHICH DAYS, and that is the question you are asking when you
                 * open a month — whether the habit held, where the gaps are. The week has its own grid
                 * above, at hour resolution, so a second one here would be the same days twice; a year
                 * in day cells would be 365 specks.
                 */}
                {/**
                 * ⚠️ AND NOT BEFORE THERE IS ANYTHING, the same rule as the rail and the week grid. A
                 * new member opening This month met a 35-cell calendar with nothing in a single one of
                 * them, sitting between "Nothing here yet." above it and "Nothing recorded this month
                 * yet." below — an empty grid framed by two sentences already saying so, on the one
                 * screen where the three-step instruction is what somebody actually needs.
                 *
                 * ⚠️ THE SENTENCE UNDERNEATH STAYS, which is the half that was always doing the work.
                 * This hides a chart of nothing, not the fact that there is nothing.
                 */}
                {v.scope === 'month' && acts.length > 0 && <MonthGrid on={on} beat={beat} />}
                {/**
                 * ⚠️ AND YEARS GETS ITS OWN. Until this existed, Years was the only horizon with not one
                 * word about the record in it — its goals and nothing else, which is a strange silence
                 * for the view whose whole subject is the things that take years. `chronicle_spans` asks
                 * the question `chronicle_totals` cannot: every year somebody has, each as its own
                 * window, computed in the client because a year begins at local midnight.
                 */}
                {v.scope === 'life' && <Lifetime beat={beat} />}
                {win && v.scope !== 'day' && v.scope !== 'life' ? (
                  <Looking win={win} label={v.label} scope={v.scope} on={on} beat={beat} />
                ) : null}
                {say && <p className="chron-say">{say}</p>}
              </>
            )}
          </div>
        </>
      )}

      {/**
       * ⚠️ THE ROOM HAD NO TOAST, so every message it sent went nowhere. `<Toast/>` is mounted per
       * room — the Circuit, Ratings, the Instrument and Account each mount their own — and this
       * one never did, which nothing noticed while the room had nothing to say. Putting a file
       * back does: a file that is not ours, or one the account already holds, changes nothing on
       * screen, so the sentence is the ONLY feedback there is. Found by watching for it rather
       * than by reading the code, which showed a perfectly ordinary showToast call.
       */}
      <Toast />
    </section>
  )
}
