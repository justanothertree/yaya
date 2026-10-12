import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  finished,
  inScope,
  lastDay,
  repeats,
  share,
  today as todayISO,
  tomorrow as tomorrowISO,
  windowOf,
  type Goal,
  type Scope,
} from '../chronicle/goal'
import { dropGoal, myGoals, saveGoal, setProgress } from '../chronicle/cloud'

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
type View = { id: string; label: string; scope: Scope; when: () => string; blurb: string }

/**
 * ⚠️ TODAY AND TOMORROW ARE THE SAME SCOPE, DIFFERENT DAYS, which is why this is a list of views
 * rather than a list of scopes. A repeating daily goal appears in both, correctly — that is what
 * "daily" means — while a one-off anchored to tomorrow appears only in the second.
 *
 * ⚠️ AND `quarter` IS HERE BECAUSE THE TABLE ALLOWS IT. The design doc asks whether a quarter is
 * worth having or is noise, and that is unanswered — so it gets a view, because a scope the
 * database accepts and no view shows is a goal somebody can create and never see again. One line
 * to remove if the answer comes back "noise", and removing a view is safe where narrowing the
 * check constraint behind it would not be.
 */
const VIEWS: View[] = [
  { id: 'today', label: 'Today', scope: 'day', when: todayISO, blurb: 'What today is for.' },
  {
    id: 'tomorrow',
    label: 'Tomorrow',
    scope: 'day',
    when: tomorrowISO,
    blurb: 'Decided now, so tomorrow does not have to be.',
  },
  { id: 'week', label: 'This week', scope: 'week', when: todayISO, blurb: 'Sunday to Saturday.' },
  {
    id: 'month',
    label: 'This month',
    scope: 'month',
    when: todayISO,
    blurb: 'The calendar month.',
  },
  {
    id: 'quarter',
    label: 'This quarter',
    scope: 'quarter',
    when: todayISO,
    blurb: 'Three months at a time.',
  },
  { id: 'year', label: 'This year', scope: 'year', when: todayISO, blurb: 'The whole year.' },
  {
    id: 'life',
    label: 'Years',
    scope: 'life',
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

export function Chronicle({ authed = false }: { authed?: boolean } = {}) {
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [view, setView] = useState('today')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [every, setEvery] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!authed) {
      setGoals([])
      return
    }
    setGoals(await myGoals())
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  const v = VIEWS.find((x) => x.id === view) ?? VIEWS[0]
  const on = v.when()
  const win = windowOf(v.scope, on)

  /* ⚠️ memoised on the list and the view, because `inScope` runs per goal per render and the
     filter is the only work this component does that grows with somebody's history */
  const mine = useMemo(
    () => (goals ?? []).filter((g) => inScope(g, v.scope, on)),
    [goals, v.scope, on],
  )

  /** how many of each view has something in it, so the strip says where the work is */
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const x of VIEWS) {
      const when = x.when()
      out[x.id] = (goals ?? []).filter((g) => inScope(g, x.scope, when) && !finished(g)).length
    }
    return out
  }, [goals])

  const add = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    const n = Number(target)
    const hasTarget = target.trim() !== '' && Number.isFinite(n) && n > 0
    const r = await saveGoal({
      title: t,
      scope: v.scope,
      /* ⚠️ a repeat has no anchor and a one-off must have one — the check constraint enforces
         exactly this pair, so the form cannot send a shape the table would refuse */
      anchor: v.scope === 'life' || every ? null : (win?.from ?? null),
      every: v.scope === 'life' ? null : every ? 1 : null,
      target: hasTarget ? n : null,
      /* ⚠️ a target always carries a unit, or the number means nothing in six months */
      unit: hasTarget ? unit.trim() || 'done' : null,
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
    setBusy(true)
    await setProgress(g.id, g.progress, !g.done)
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

  if (!authed) {
    return (
      <section className="card">
        <h2 className="section-title">Chronicle</h2>
        <p className="muted">
          A planner for what you are aiming at — today, tomorrow, this week, this month, this year,
          and the things that take years. It lives in your account rather than in this browser, so
          it is here on your phone too. Sign in to use it.
        </p>
      </section>
    )
  }

  return (
    <section className="card chron">
      <h2 className="section-title">Chronicle</h2>

      {/* ⚠️ the counts are UNFINISHED work, not totals — a strip of totals tells you how much you
          have written down, which is not a thing anybody needs to know at a glance */}
      <div className="chron-strip" role="tablist" aria-label="How far ahead">
        {VIEWS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={view === x.id}
            className={'btn chron-tab' + (view === x.id ? ' is-on' : ' btn-ghost')}
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

      {goals === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : (
        <>
          <ul className="chron-list">
            {mine.map((g) => {
              const s = share(g)
              const done = finished(g)
              return (
                <li key={g.id} className={'chron-goal' + (done ? ' is-done' : '')}>
                  <div className="chron-goal-top">
                    {s == null ? (
                      <label className="chron-tick">
                        <input type="checkbox" checked={g.done} onChange={() => void tick(g)} />
                        <span>{g.title}</span>
                      </label>
                    ) : (
                      <span className="chron-name">{g.title}</span>
                    )}
                    {repeats(g) ? <span className="chron-chip">repeats</span> : null}
                    <button
                      className="btn btn-ghost chron-x"
                      onClick={() => void remove(g)}
                      aria-label={`Delete ${g.title}`}
                      title={`Delete ${g.title}`}
                    >
                      ✕
                    </button>
                  </div>
                  {s != null && (
                    <div className="chron-meter">
                      <div className="chron-bar">
                        <i style={{ width: `${Math.round(s * 100)}%` }} />
                      </div>
                      <span className="chron-num">
                        {g.progress} / {g.target} {g.unit}
                      </span>
                      <button className="btn btn-ghost" onClick={() => void bump(g, -1)}>
                        −
                      </button>
                      <button className="btn btn-ghost" onClick={() => void bump(g, 1)}>
                        +
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {!mine.length && <p className="muted">Nothing here yet.</p>}

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
              <label className="chron-qty">
                <span className="sr-only">What the number counts</span>
                <input
                  value={unit}
                  placeholder="points"
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
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
              <button className="btn" disabled={!title.trim() || busy} onClick={() => void add()}>
                Add
              </button>
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setAdding(true)}>
              ＋ Add to {v.label.toLowerCase()}
            </button>
          )}

          {say && <p className="chron-say">{say}</p>}
        </>
      )}
    </section>
  )
}
