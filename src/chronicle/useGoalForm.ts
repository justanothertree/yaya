import { useMemo, useState } from 'react'
import { repeats, unitFor, today as todayISO, windowOf, type Goal, type Scope } from './goal'
import { saveGoal, setDays } from './cloud'
import { typedMinutes, type Activity } from './record'
import { EVERY_DAY, maskOn, weekday, type DayMask } from './weekdays'

/**
 * The goal form: which goal it is editing, what its fields hold, what the source picker derives
 * from them, and saving.
 *
 * ⚠️ A HOOK CALLED BY THE ROOM, NOT STATE INSIDE THE FORM, for the reason useActivityEditor is one:
 * a row's ✎, the journal's ＋ Goal and a tab change all reach the form from outside, and a half-typed
 * goal has to survive the form closing exactly as it did when this lived in Chronicle.tsx. The form
 * draws it (GoalForm.tsx).
 */
export function useGoalForm({
  goals,
  acts,
  v,
  on,
  busy,
  setBusy,
  setSay,
  setKept,
  load,
}: {
  goals: Goal[] | null
  acts: Activity[]
  /** the view on screen — a new goal takes its scope */
  v: { scope: Scope }
  on: string
  busy: boolean
  setBusy: (busy: boolean) => void
  setSay: (say: string | null) => void
  setKept: (update: (kept: string[]) => string[]) => void
  load: () => Promise<void>
}) {
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
  /**
   * Which weekdays a repeating daily goal is for, as the form holds it — see weekdays.ts.
   *
   * ⚠️ SAVED FROM TODAY, NEVER FROM THE DAY THE GOAL WAS MADE. Evan's rule: an edit reaches today
   * and the days after it, and every earlier day keeps the schedule it was judged under.
   */
  const [wdays, setWdays] = useState<DayMask>(EVERY_DAY)
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
  const [why, setWhy] = useState('')
  /** how long this is guessed to take, as typed — minutes, blank for "no idea" */
  const [est, setEst] = useState('')
  /** 0 normal, 1 important, 2 urgent — see Goal.priority, which is the list's order */
  const [pri, setPri] = useState<0 | 1 | 2>(0)

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
      est: typedMinutes(est),
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
    /**
     * ⚠️ THE SCHEDULE IS ITS OWN WRITE, AFTER THE GOAL, and only when it CHANGED. Writing it on
     * every save would add a row per edit for nothing, and a goal saved as "every day" with no
     * rows is already every day. A one-off has none to write; a goal that stops repeating keeps
     * the rows it had — they are history, and the server keeps them for if it repeats again.
     */
    const was = beingFixed ? maskOn(beingFixed.days ?? [], todayISO()) : EVERY_DAY
    const days =
      !('why' in r) && saveScope === 'day' && every && wdays !== was
        ? await setDays(r.id, wdays, todayISO())
        : null
    setBusy(false)
    if ('why' in r) {
      setSay(r.why)
      window.setTimeout(() => setSay(null), 6000)
      return
    }
    /* the goal saved and its days did not: said, and the form closes on what DID save */
    if (days) {
      setSay(`Saved, but not the days: ${days.why}`)
      window.setTimeout(() => setSay(null), 6000)
    }
    /* ⚠️ A GOAL SAVED FOR DAYS THAT LEAVE THIS ONE OUT STAYS ON SCREEN FOR THE VISIT, saying
       "not due today". Without this, adding "floss, not Sundays" on a Sunday made the row vanish
       the moment Save was pressed — which reads as the save having failed. */
    if (!days && saveScope === 'day' && every && (wdays & (1 << weekday(on))) === 0) {
      setKept((k) => (k.includes(r.id) ? k : [...k, r.id]))
    }
    fillGoalForm(null)
    setFixing(null)
    setAdding(false)
    await load()
  }

  /**
   * Fill the goal form: from a goal being changed, or empty for a new one, with an optional first
   * draft of its title (see `ideaTitle`).
   *
   * ⚠️ ONE COPY FOR THE THREE PLACES THAT SET ALL TEN FIELDS — a row's ✎, `openAdd`, and the reset
   * after a save. Ten setters written out three times is how one of them comes to miss a field, and
   * a missed field here is not a blank: it is the previous goal's value, saved onto the next one.
   */
  const fillGoalForm = (g: Goal | null, draft = '') => {
    setTitle(g ? g.title : draft)
    setTarget(g?.target == null ? '' : String(g.target))
    setUnit(g?.unit ?? '')
    setEvery(g ? repeats(g) : false)
    setWdays(g ? maskOn(g.days ?? [], todayISO()) : EVERY_DAY)
    setSrc(g?.activity ? 'a:' + g.activity : g?.cat ? 'c:' + g.cat : '')
    setCountWhat(g ? g.counts : 'minutes')
    setEst(g?.est == null ? '' : String(g.est))
    setPri(g ? g.priority : 0)
    setWhy(g?.note ?? '')
  }

  /**
   * Open the add form empty, or with a title already in it.
   *
   * ⚠️ CLEARED ON THE WAY IN, or opening Add straight after a Cancel would show the goal you were
   * editing and quietly save over it — which is why this is one function for both doors: the
   * ＋ button and a journal entry handed over by `onIdea`. The ten fields themselves are filled by
   * `fillGoalForm`, for the same reason.
   */
  const openAdd = (draft: string) => {
    setFixing(null)
    fillGoalForm(null, draft)
    setAdding(true)
  }

  return {
    adding,
    setAdding,
    fixing,
    setFixing,
    title,
    setTitle,
    target,
    setTarget,
    unit,
    setUnit,
    every,
    setEvery,
    wdays,
    setWdays,
    src,
    setSrc,
    countWhat,
    setCountWhat,
    srcAct,
    goalCounts,
    suggestedUnit,
    why,
    setWhy,
    est,
    setEst,
    pri,
    setPri,
    beingFixed,
    add,
    fillGoalForm,
    openAdd,
  }
}

export type GoalFormState = ReturnType<typeof useGoalForm>
