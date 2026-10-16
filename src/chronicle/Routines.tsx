import { useCallback, useEffect, useMemo, useState } from 'react'
import { dropRoutine, myRoutines, saveRoutine, type Routine } from './cloud'
import { spanText, type Activity } from './record'
import { readRoutine } from './routine'

/**
 * Routines — an ordered list of things you do together.
 *
 * The last named feature the HTML app had that chronicle did not: a morning you run through, a
 * closing-down list, the four things you always do before drawing.
 *
 * ⚠️ THERE IS NO "RUNNING ROUTINE", and that is the HTML app's `activeRoutine` deliberately left
 * out. The useful 80% of a routine is a saved list you tap down in order, and the timer already
 * knows what is running — a second idea of "where am I in the routine" would be a second answer to
 * that question, kept in step by hope. Which step is next is DERIVED from what you have already
 * done today, from the minutes the room already has in hand.
 *
 * ⚠️ AND A STEP IS A SUGGESTION, NOT A LIMIT. "10m" on a step says how long you meant it to take;
 * nothing stops it or nags about it. A routine that enforced its own timings would be a schedule,
 * which is a different thing from a list and a much easier thing to abandon.
 */
export function Routines({
  acts,
  mins,
  onStart,
  busy,
}: {
  acts: Activity[]
  /** minutes done today, per activity id — what makes a step look finished */
  mins: Record<string, number>
  onStart: (activity: string) => void
  busy: boolean
}) {
  const [rows, setRows] = useState<Routine[] | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftSteps, setDraftSteps] = useState<Array<{ activity: string; mins: number | null }>>([])
  /**
   * ⚠️ THE SERVER'S CEILING, SAID BEFORE IT IS HIT. `chronicle_routine_save` raises "that is more
   * than forty steps", and nothing here stopped you reaching forty-one — so the room offered a
   * ＋ Step whose only possible answer was an error, which is the same lesson as the archived
   * step one component over and the not-yet-started plan in Plans.tsx. The draft survives the
   * refusal, so this was never lost work; it was being told at Save what could have been said at
   * the control.
   */
  const STEP_CEILING = 40
  const [pick, setPick] = useState('')
  const [stepMins, setStepMins] = useState('')
  const [say, setSay] = useState<string | null>(null)

  const load = useCallback(async () => setRows(await myRoutines()), [])
  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts])
  /* the ones worth offering as a step: yours, still in use, and not the site's own bookkeeping */
  const offer = useMemo(() => acts.filter((a) => !a.archived && !a.auto), [acts])

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const open = (r: Routine | null) => {
    setFixing(r ? r.id : 'new')
    setDraftName(r ? r.name : '')
    setDraftSteps(r ? [...r.steps] : [])
    setPick('')
    setStepMins('')
  }

  const save = async () => {
    const n = draftName.trim()
    if (!n) return
    const r = await saveRoutine(n, draftSteps, fixing === 'new' ? undefined : (fixing ?? undefined))
    if ('why' in r) return moan(r.why)
    setFixing(null)
    await load()
  }

  const remove = async (r: Routine) => {
    if (!window.confirm(`Delete the routine “${r.name}”?`)) return
    await dropRoutine(r.id)
    await load()
  }

  /**
   * Which step you are up to.
   *
   * ⚠️ THE FIRST ONE YOU HAVE NOT DONE TODAY, which is the whole of the state this feature needs.
   * A step counts as done when there are minutes against its activity today — and when it carries
   * a suggested length, when there are at least that many. So a routine resumes itself after a
   * reload, after a day, and on another device, without storing where you were.
   *
   * ⚠️ THE RULE ITSELF LIVES IN routine.ts, because it has a unit in it and an invariant between
   * its two halves — the counter and the arrow have to agree — and inlined in JSX it could only
   * be checked by looking at a screen. See readRoutine, whose tests are the reason an archived
   * step no longer stops a routine dead.
   */
  const live = (id: string): boolean => {
    const a = byId.get(id)
    return !!a && !a.archived
  }
  const read = (r: Routine) => readRoutine(r.steps, mins, live)

  if (rows === null) {
    return (
      <p className="muted" aria-busy>
        Loading routines…
      </p>
    )
  }

  return (
    <div className="chron-routines">
      {rows.map((r) =>
        fixing === r.id ? null : (
          <div key={r.id} className="chron-routine">
            <div className="chron-routine-top">
              <strong>{r.name}</strong>
              {/* ⚠️ how far down it you are, said plainly: a routine you are halfway through
                  looks identical to one you have not started unless somebody says so */}
              {/* ⚠️ `total` COUNTS ONLY THE STEPS THAT CAN STILL BE DONE. A routine whose only
                  unfinished step names an archived activity is finished, not stuck at "2 of 3"
                  for ever — and one made entirely of archived steps says so instead of
                  congratulating you. */}
              <span className="muted">
                {(() => {
                  const k = read(r)
                  if (k.total === 0) return k.gone ? 'every step is archived' : 'no steps yet'
                  return k.nextIndex < 0 ? 'all done today' : `${k.done} of ${k.total}`
                })()}
              </span>
              <button
                className="btn btn-ghost chron-x"
                onClick={() => open(r)}
                title={`Change ${r.name}`}
              >
                ✎
              </button>
              <button
                className="btn btn-ghost chron-x"
                onClick={() => void remove(r)}
                title={`Delete ${r.name}`}
              >
                ✕
              </button>
            </div>
            {r.steps.length ? (
              <div className="chron-steps">
                {r.steps.map((s, i) => {
                  const a = byId.get(s.activity)
                  const did = mins[s.activity] ?? 0
                  const state = read(r).states[i]
                  const gone = state === 'gone'
                  const done = state === 'done'
                  return (
                    <button
                      key={s.activity + i}
                      className={
                        'btn btn-ghost chron-step' +
                        (gone ? ' is-gone' : done ? ' is-done' : state === 'next' ? ' is-next' : '')
                      }
                      /* ⚠️ AN ARCHIVED STEP IS NOT OFFERED. chronicle_start refuses an activity
                         with an archived_at, so this button used to answer "no such activity"
                         about an activity named on its own face. */
                      disabled={busy || gone}
                      onClick={() => onStart(s.activity)}
                      title={
                        gone
                          ? `${a?.name ?? 'This activity'} is archived — bring it back to use this step`
                          : done
                            ? `Done today — ${spanText(did * 60_000)}`
                            : 'Start this'
                      }
                    >
                      {gone ? '—' : done ? '✓' : '▶'} {a?.name ?? 'a deleted activity'}
                      {s.mins ? <span className="muted"> {s.mins}m</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="muted">No steps yet — press ✎ to add some.</p>
            )}
          </div>
        ),
      )}

      {fixing ? (
        <div className="chron-routine chron-routine-edit">
          <div className="chron-fix">
            <label>
              <span className="sr-only">What is it called?</span>
              <input
                autoFocus
                value={draftName}
                placeholder="Morning"
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <button className="btn" disabled={!draftName.trim()} onClick={() => void save()}>
              Save
            </button>
            <button className="btn btn-ghost" onClick={() => setFixing(null)}>
              Cancel
            </button>
          </div>

          <ol className="chron-draft">
            {draftSteps.map((s, i) => (
              <li key={s.activity + i}>
                <span className="chron-draft-name">{byId.get(s.activity)?.name ?? 'gone'}</span>
                {s.mins ? <span className="muted">{s.mins}m</span> : null}
                {/* ⚠️ up and down rather than dragging: HTML5 drag fires on no touch device and
                    reaches no keyboard, which is the same note the paint room's layer rows make */}
                <button
                  className="btn btn-ghost chron-x"
                  disabled={i === 0}
                  onClick={() =>
                    setDraftSteps((d) => {
                      const n = [...d]
                      ;[n[i - 1], n[i]] = [n[i], n[i - 1]]
                      return n
                    })
                  }
                  aria-label="Move this step earlier"
                  title="Move this step earlier"
                >
                  ▲
                </button>
                <button
                  className="btn btn-ghost chron-x"
                  disabled={i === draftSteps.length - 1}
                  onClick={() =>
                    setDraftSteps((d) => {
                      const n = [...d]
                      ;[n[i], n[i + 1]] = [n[i + 1], n[i]]
                      return n
                    })
                  }
                  aria-label="Move this step later"
                  title="Move this step later"
                >
                  ▼
                </button>
                <button
                  className="btn btn-ghost chron-x"
                  onClick={() => setDraftSteps((d) => d.filter((_, k) => k !== i))}
                  aria-label="Take this step out"
                  title="Take this step out"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>

          <div className="chron-fix">
            <label>
              <span className="sr-only">Which activity to add</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Add a step…</option>
                {offer.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="chron-qty">
              <span className="sr-only">How long, roughly</span>
              <input
                value={stepMins}
                inputMode="numeric"
                placeholder="mins"
                onChange={(e) => setStepMins(e.target.value)}
              />
            </label>
            <button
              className="btn btn-ghost"
              disabled={!pick || draftSteps.length >= STEP_CEILING}
              title={
                draftSteps.length >= STEP_CEILING
                  ? `Forty steps is the most a routine can hold — take one out to add another`
                  : undefined
              }
              onClick={() => {
                const n = Number(stepMins)
                setDraftSteps((d) => [
                  ...d,
                  { activity: pick, mins: Number.isFinite(n) && n > 0 ? Math.round(n) : null },
                ])
                setPick('')
                setStepMins('')
              }}
            >
              ＋ Step
            </button>
            {/* ⚠️ IN WORDS, NOT ONLY THE TITLE — a tooltip does not exist on a phone, and the
                button going quiet with no explanation is the thing this is for */}
            {draftSteps.length >= STEP_CEILING ? (
              <span className="muted">Forty steps is the most a routine can hold.</span>
            ) : null}
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost" onClick={() => open(null)}>
          ＋ Routine
        </button>
      )}

      {!rows.length && !fixing && (
        <p className="muted">
          A routine is a list you tap down in order — a morning, a shutdown, the three things you
          always do before drawing.
        </p>
      )}
      {say && <p className="chron-say">{say}</p>}
    </div>
  )
}
