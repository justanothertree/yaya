import { useEffect, useRef, useState } from 'react'
import { saveActivity } from './cloud'
import { typedMinutes, type Activity } from './record'

/**
 * The Activities fold's editor: which activity is open in it, what its fields hold, and saving it.
 *
 * ⚠️ A HOOK CALLED BY THE TIMER, NOT STATE INSIDE THE FOLD, so a half-made edit survives the fold
 * being unmounted — switching to Journal and back leaves the editor where it was, exactly as when
 * this lived in Timer.tsx. The fold draws it (ActivitiesFold.tsx); the sitting editor's "name what
 * this counts" door opens it from outside, which is why the fold's open state is here too.
 */
export function useActivityEditor({
  acts,
  busy,
  setBusy,
  moan,
  after,
}: {
  acts: Activity[] | null
  busy: boolean
  setBusy: (busy: boolean) => void
  moan: (why: string) => void
  after: () => Promise<void>
}) {
  /**
   * Which activity is being edited, if any.
   *
   * ⚠️ INLINE RATHER THAN IN A DIALOG, because it is a repair made while you are looking at the
   * thing that is wrong — "that says Free Time and it should say Life" — so the fix belongs in the
   * row rather than behind a button that covers it up.
   */
  const [fixAct, setFixAct] = useState<string | null>(null)
  /** whether the Activities fold is open — see the note where it is drawn */
  const [actsOpen, setActsOpen] = useState(false)
  /** the activity editor's "also counts" box, so the door to it can land the cursor there */
  const metricBox = useRef<HTMLInputElement>(null)
  /* bumped by the door; the effect below acts once per bump, after the fold has rendered open */
  const [toMetric, setToMetric] = useState(0)
  useEffect(() => {
    if (!toMetric) return
    const el = metricBox.current
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus()
  }, [toMetric])
  const [actName, setActName] = useState('')
  const [actCat, setActCat] = useState<Activity['cat']>('free')
  /** what this activity counts besides time — "pages", "reps", blank for nothing */
  const [actColour, setActColour] = useState<string | null>(null)
  const [actMetric, setActMetric] = useState('')
  /** how long a sitting of it ought to be, in minutes — blank for no opinion */
  const [actSession, setActSession] = useState('')
  const [actShared, setActShared] = useState(false)

  /**
   * Open an activity's editor, seeded with what it holds now.
   *
   * ⚠️ ONE FUNCTION FOR THE ROW'S NAME BUTTON AND FOR THE "NAME WHAT THIS COUNTS" DOOR, for the
   * reason `openSitting` below is one: a second copy of these seven lines is where a field stops
   * being seeded, and an unseeded field here is not a blank — it is the PREVIOUS activity's value,
   * saved onto this one by the next Save.
   */
  const editActivity = (a: Activity) => {
    setFixAct(a.id)
    setActName(a.name)
    setActCat(a.cat)
    setActColour(a.colour)
    setActMetric(a.metric ?? '')
    setActSession(a.session == null ? '' : String(a.session))
    setActShared(a.shared)
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
      typedMinutes(actSession),
      actShared,
    )
    setBusy(false)
    if ('why' in r) return moan(r.why)
    setFixAct(null)
    await after()
  }

  return {
    fixAct,
    setFixAct,
    actsOpen,
    setActsOpen,
    metricBox,
    setToMetric,
    actName,
    setActName,
    actCat,
    setActCat,
    actColour,
    setActColour,
    actMetric,
    setActMetric,
    actSession,
    setActSession,
    actShared,
    setActShared,
    editActivity,
    saveAct,
  }
}

export type ActivityEditor = ReturnType<typeof useActivityEditor>
