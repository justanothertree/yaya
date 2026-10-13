import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  finished,
  derived,
  inScope,
  lastDay,
  reached,
  repeats,
  tallyAsks,
  share,
  today as todayISO,
  tomorrow as tomorrowISO,
  windowOf,
  type Goal,
  type Scope,
} from '../chronicle/goal'
import { dropGoal, myActivities, myGoals, saveGoal, setProgress, tally } from '../chronicle/cloud'
import { CATS, type Activity } from '../chronicle/record'
import { Timer } from '../chronicle/Timer'
import { Looking } from '../chronicle/Looking'

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
  /**
   * What the record says, for the goals that have a source.
   *
   * ⚠️ FETCHED SEPARATELY RATHER THAN FOLDED INTO THE GOAL LIST, because the two answer different
   * questions and change at different times: the list changes when you edit a goal, the tally
   * changes every time the timer runs. Keeping them apart means stopping a timer refreshes the
   * numbers without re-reading every goal.
   */
  const [got, setGot] = useState<Record<string, number>>({})
  const [acts, setActs] = useState<Activity[]>([])
  const [src, setSrc] = useState('')

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
    const asks = [
      ...new Map(
        [todayISO(), tomorrowISO()]
          .flatMap((d) => tallyAsks(mine, d))
          .map((x) => [x.id + x.from, x]),
      ).values(),
    ]
    setGot(asks.length ? await tally(asks) : {})
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
      out[x.id] = (goals ?? []).filter((g) => inScope(g, x.scope, when) && !finished(g, got)).length
    }
    return out
  }, [goals, got])

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
      /* ⚠️ a source needs a target to count towards, which the table also insists on — a derived
         tick-box would tick itself the moment you did a minute of anything */
      activity: hasTarget && src.startsWith('a:') ? src.slice(2) : null,
      cat: hasTarget && src.startsWith('c:') ? (src.slice(2) as Activity['cat']) : null,
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
    setSrc('')
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

      {/**
       * ⚠️ THE ROOM HAS TO SAY WHAT IT IS, and it did not. Reported plainly by the person who
       * asked for it and watched it get built — "i am not sure how most of it works yet" — which
       * is as clear a signal as a room can give. Every word in it was mine: scope, source,
       * repeats, and three category names he had never used.
       *
       * ⚠️ TWO SENTENCES, AND THE LONG VERSION LIVES IN A COMMENT. The page gets the shortest true
       * thing; docs/2026-10-12-chronicle-design.md gets the reasoning.
       */}
      <p className="muted chron-how">
        Two halves. <strong>The stopwatch</strong> below times what you are doing, against
        activities you name. <strong>The tabs</strong> under it hold what you are aiming at, at
        whichever size you think about it — today, this week, this year. Point a numbered goal at an
        activity and it fills itself in as you work.
      </p>

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
      <Timer day={v.scope === 'day' ? on : todayISO()} onChange={() => void load()} />

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
                <strong>Name something you do.</strong> Press ＋ Activity up there — "Drawing",
                "Dishes", "Work". Each one is Locked In, Free Time or Life.
              </li>
              <li>
                <strong>Press Start when you begin it</strong>, Stop when you are done. That is the
                record, and it keeps running if you close the tab.
              </li>
              <li>
                <strong>Then aim at something.</strong> Add a goal below — a tick-box, or a number
                like 30 minutes. Point a number at an activity and you never have to tick it.
              </li>
            </ol>
          ) : null}
          <ul className="chron-list">
            {mine.map((g) => {
              const s = share(g, got)
              const done = finished(g, got)
              const auto = derived(g)
              const have = reached(g, got)
              const from = g.activity
                ? (acts.find((a) => a.id === g.activity)?.name ?? 'an activity')
                : g.cat
                  ? (CATS.find(([c]) => c === g.cat)?.[1] ?? g.cat)
                  : null
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
                    {/* ⚠️ "every day" rather than "repeats": the useful half of the fact is the
                        cadence and the room already knows it, so a chip saying only that a thing
                        repeats is a label that raises the question it should answer */}
                    {repeats(g) ? <span className="chron-chip">every {g.scope}</span> : null}
                    {/* ⚠️ a derived goal says WHERE its number comes from, because a number that
                        moves on its own and does not say why reads as a bug rather than a feature */}
                    {from ? <span className="chron-chip is-auto">from {from}</span> : null}
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
                        {/* ⚠️ rounded for reading, and the raw value is never shown: minutes come
                            back as a fraction of a minute from the overlap sum, and "29.983 / 30"
                            is a number that looks broken rather than nearly done */}
                        {auto ? Math.round(have) : have} / {g.target} {g.unit}
                      </span>
                      {/* ⚠️ NO PLUS AND MINUS ON A DERIVED GOAL. There is nothing to press — the
                          record is the number — and buttons that looked like they moved it would
                          either lie or fight the next tally. */}
                      {!auto && (
                        <>
                          <button className="btn btn-ghost" onClick={() => void bump(g, -1)}>
                            −
                          </button>
                          <button className="btn btn-ghost" onClick={() => void bump(g, 1)}>
                            +
                          </button>
                        </>
                      )}
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
              {/**
               * ⚠️ ONLY WHEN THERE IS A NUMBER TO COUNT, and only when the window can be added up.
               * A source on a tick-box has nothing to count towards, and a source on a lifetime
               * goal has no window to count over — both are refused one layer down, so offering
               * them here would be offering a thing that cannot be saved.
               */}
              {target.trim() !== '' && v.scope !== 'life' && acts.length > 0 && (
                <label className="chron-src">
                  <span className="sr-only">Counted from what?</span>
                  <select value={src} onChange={(e) => setSrc(e.target.value)}>
                    <option value="">I will count it myself</option>
                    <optgroup label="count my time on…">
                      {acts
                        .filter((a) => !a.archived)
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

          {/**
           * ⚠️ LOOKING BACK, FOR THE WINDOWS WHERE IT IS THE ONLY WAY TO SEE ANYTHING. Today and
           * Tomorrow have the Timer log above, entry by entry with the times on them, which is
           * strictly more than a total — showing both would be one day said twice. A week, a
           * month, a quarter and a year have no other view at all, which was the biggest hole in
           * the room: it recorded a life and could not show it back.
           *
           * ⚠️ AND NOT FOR Years, which has no window to add up. All-time totals are a different
           * question and the range cap is 400 days, so pretending would mean quietly showing a
           * year and calling it everything.
           */}
          {win && v.scope !== 'day' && v.scope !== 'life' ? (
            <Looking win={win} label={v.label} />
          ) : null}
          {say && <p className="chron-say">{say}</p>}
        </>
      )}
    </section>
  )
}
