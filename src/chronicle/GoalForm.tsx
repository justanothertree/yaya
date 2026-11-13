import { unitFor, today as todayISO, type Scope } from './goal'
import { CATS, type Activity } from './record'
import { dayLetter, dayName, maskOn, validMask } from './weekdays'
import { LIMIT } from './limits'
import type { GoalFormState } from './useGoalForm'

/**
 * The goal form under a view's list, or the ＋ button that opens it. Its state lives in useGoalForm,
 * which the room owns.
 */
export function GoalForm({
  form,
  v,
  acts,
  busy,
}: {
  form: GoalFormState
  /** the view on screen — its scope decides what the form offers, its label names the button */
  v: { scope: Scope; label: string }
  acts: Activity[]
  busy: boolean
}) {
  const {
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
    openAdd,
  } = form
  return adding ? (
    <div className="chron-add">
      <label>
        <span className="sr-only">What is the goal?</span>
        <input
          autoFocus
          value={title}
          maxLength={LIMIT.goalTitle}
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
          maxLength={LIMIT.goalNote}
          placeholder="why, if it helps"
          onChange={(e) => setWhy(e.target.value)}
        />
      </label>
      <label className="chron-choice">
        <span className="sr-only">How much does it matter?</span>
        <select value={String(pri)} onChange={(e) => setPri(Number(e.target.value) as 0 | 1 | 2)}>
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
          maxLength={LIMIT.unit}
          placeholder={unitFor('', {
            counts: goalCounts,
            activity: srcAct,
            cat: src.startsWith('c:') ? (src.slice(2) as 'locked' | 'free' | 'life') : null,
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
          <input type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} />
          <span>every {v.scope}</span>
        </label>
      )}
      {/**
       * ⚠️ ONLY FOR A REPEATING DAILY GOAL, the one shape a weekday means anything for.
       * Seven toggles rather than a list of ticks, because the choice is a pattern and
       * a row of letters shows the whole week at once. Each says its day in words, for
       * a screen reader and for the two Ts and two Ss; the last day left cannot be
       * unpressed, because a goal for no days is one the server refuses.
       */}
      {(beingFixed?.scope ?? v.scope) === 'day' && every && (
        <div className="chron-wdays" role="group" aria-label="On these days">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const picked = (wdays & (1 << d)) !== 0
            return (
              <button
                key={d}
                type="button"
                className={'chron-wday' + (picked ? ' is-on' : '')}
                aria-pressed={picked}
                aria-label={dayName(d)}
                onClick={() => {
                  const next = wdays ^ (1 << d)
                  if (validMask(next)) setWdays(next)
                }}
              >
                {dayLetter(d)}
              </button>
            )
          })}
          {/* ⚠️ THE RULE, SAID WHERE IT APPLIES. An edit that changes the days and
                does not say from when would leave somebody wondering whether last
                week's misses just became something else. */}
          {beingFixed && wdays !== maskOn(beingFixed.days ?? [], todayISO()) ? (
            <span className="muted chron-wdays-note">
              From today. Earlier days keep the old days.
            </span>
          ) : null}
        </div>
      )}
      <button className="btn" disabled={!title.trim() || busy} onClick={() => void add()}>
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
    <button className="btn" onClick={() => openAdd('')}>
      ＋ Add to {v.label.toLowerCase()}
    </button>
  )
}
