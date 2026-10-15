/**
 * How far down a routine you are — derived, never stored.
 *
 * ⚠️ THIS IS PURE SO IT CAN BE ASKED A QUESTION. It lived in Routines.tsx as two expressions
 * inlined in JSX — `findIndex` for the next step and a `filter().length` for the counter — which
 * meant the one rule the feature has could only be checked by looking at a screen. It has a UNIT
 * in it (minutes) and an invariant (the counter and the arrow must agree), which is what CLAUDE.md
 * says belongs in vitest.
 *
 * ⚠️ AND A STEP WHOSE ACTIVITY IS ARCHIVED IS `gone`, WHICH IS THE WHOLE REASON THIS MOVED. The
 * old rule had two states, done and not-done, and an archived step could be neither: it can never
 * gain a minute, because `chronicle_start` refuses an activity with an `archived_at`. So the
 * routine offered a ▶ that answered "no such activity" — about an activity named on the very
 * button — and sat at "2 of 3" for the rest of its life. Archiving something is not a reason to
 * rewrite a list somebody saved, so the step stays visible and stops counting.
 */
export type Step = { activity: string; mins: number | null }

/** done: enough minutes today · next: the one to do now · todo: later · gone: archived */
export type StepState = 'done' | 'next' | 'todo' | 'gone'

export type RoutineRead = {
  states: StepState[]
  /** how many of the live steps are done */
  done: number
  /** how many steps can still be done at all — archived ones are not in it */
  total: number
  /** the step to do now, or -1 when there is none */
  nextIndex: number
  /** how many steps name an activity that has been archived or is no longer there */
  gone: number
}

/**
 * ⚠️ `mins ?? 1` IS THE RULE FOR A STEP WITH NO SUGGESTED LENGTH: one minute against it today is
 * enough to call it done. A step is a suggestion rather than a limit — see Routines.tsx — so the
 * question is "did you do this" and not "did you do it for long enough".
 */
const isDone = (s: Step, minsToday: Record<string, number>): boolean =>
  (minsToday[s.activity] ?? 0) >= (s.mins ?? 1)

/**
 * `live` answers whether a step's activity can still be started — it exists and is not archived.
 *
 * ⚠️ NOT FOUND COUNTS AS GONE TOO. Nothing in the schema deletes an activity today, so this
 * should not happen; a step pointing at nothing is still a step nobody can do, and treating it as
 * merely "not done yet" is how the stall above happened.
 */
export function readRoutine(
  steps: readonly Step[],
  minsToday: Record<string, number>,
  live: (activity: string) => boolean,
): RoutineRead {
  const states: StepState[] = []
  let done = 0
  let gone = 0
  let nextIndex = -1

  steps.forEach((s, i) => {
    if (!live(s.activity)) {
      states.push('gone')
      gone++
      return
    }
    if (isDone(s, minsToday)) {
      states.push('done')
      done++
      return
    }
    /* the FIRST live step you have not done is the one you are up to; the rest are simply later */
    if (nextIndex < 0) {
      nextIndex = i
      states.push('next')
    } else states.push('todo')
  })

  return { states, done, total: steps.length - gone, nextIndex, gone }
}
