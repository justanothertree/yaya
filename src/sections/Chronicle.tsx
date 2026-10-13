import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  finished,
  derived,
  inScope,
  streakAsks,
  streakOf,
  lastDay,
  reached,
  repeats,
  tallyAsks,
  weight,
  share,
  today as todayISO,
  tomorrow as tomorrowISO,
  windowOf,
  type Goal,
  type Scope,
} from '../chronicle/goal'
import { dropGoal, myActivities, myGoals, saveGoal, setProgress, tally } from '../chronicle/cloud'
import { CATS, spanText, type Activity } from '../chronicle/record'
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
  const [src, setSrc] = useState('')
  /**
   * Whether a derived goal counts minutes or the activity's own metric.
   *
   * ⚠️ IT IS ONLY A REAL CHOICE FOR ONE ACTIVITY WITH A METRIC. A category's activities have
   * different metrics, so adding pages to reps gives a number with no unit — the table refuses
   * that pairing and the save function corrects it, and the picker below simply does not offer it.
   */
  const [countWhat, setCountWhat] = useState<'minutes' | 'amount'>('minutes')
  /** how long this is guessed to take, as typed — minutes, blank for "no idea" */
  const [est, setEst] = useState('')
  /** 0 normal, 1 important, 2 urgent — see Goal.priority, which is the list's order */
  const [pri, setPri] = useState<0 | 1 | 2>(0)

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
     * in one call — and `chronicle_tally` answers each by scanning the record separately. Timed
     * against a year of a heavy user (2,196 sessions, 19 activities) that call takes **2.75
     * seconds**; twenty asks take 186ms. See docs/2026-10-13-chronicle-tally-cost.sql.
     *
     * `load()` is what every write waits on — `after()` calls it when you tick a goal, stop a
     * timer, edit a span. Awaiting the streaks inside it meant each of those sat for the whole
     * 2.75s before the room settled, for a number that only decorates a chip. Letting it land on
     * its own turns the cost into "the flames appear a moment later" instead of "the room is
     * frozen after every tap".
     *
     * ⚠️ IT STILL COSTS THE DATABASE THE SAME. This hides the latency from the person; it does not
     * fix it. The fix is one pass in `chronicle_tally` rather than one scan per ask, the way
     * `chronicle_spread` fixed `chronicle_totals` — not done here because a replacement that
     * agreed with the old function on two targeted cases still disagreed on 94 of 310 at volume,
     * and a half-verified rewrite of the function that computes somebody's streaks is not worth
     * the speed. The evidence is in that file for whoever finishes it.
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
      out[x.id] = (goals ?? []).filter(
        (g) => inScope(g, x.scope, when) && !finished(g, got, when),
      ).length
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
      id: fixing ?? undefined,
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
      counts: hasTarget && src.startsWith('a:') ? countWhat : 'minutes',
      /* ⚠️ a blank or unreadable guess is null, not zero: "no idea" is a real answer and zero
         minutes of work is not — see Goal.est, and `weight`, which has to count the difference */
      est: (() => {
        const n = Number(est)
        return est.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null
      })(),
      priority: pri,
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
        const w = weight(goals ?? [], got, v.scope, on)
        if (!w.left) return null
        const parts = [`${w.left} left`]
        if (w.mins > 0) parts.push(`about ${spanText(w.mins * 60_000)}`)
        if (w.vague > 0) parts.push(w.mins > 0 ? `${w.vague} unguessed` : `none of them guessed at`)
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
              const s = share(g, got, on)
              const done = finished(g, got, on)
              const auto = derived(g)
              const have = reached(g, got, on)
              const act = g.activity ? acts.find((a) => a.id === g.activity) : null
              const from = g.activity
                ? (act?.name ?? 'an activity')
                : g.cat
                  ? (CATS.find(([c]) => c === g.cat)?.[1] ?? g.cat)
                  : null
              /* ⚠️ "from Writing · pages" rather than just "from Writing", because two goals on
                 one activity — an hour a day AND four pages a day — are otherwise identical on
                 screen while measuring completely different things */
              const fromWhat = auto && g.counts === 'amount' && act?.metric ? act.metric : null
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
                    {/**
                     * ⚠️ FLAGGED ONLY WHEN IT IS FLAGGED. Ordinary is the overwhelming majority, and
                     * a chip reading "ordinary" on every row would be noise that makes the two that
                     * matter harder to find rather than easier — which is the opposite of what a
                     * priority is for. The order already puts these at the top; the chip says why.
                     */}
                    {g.priority > 0 ? (
                      <span
                        className={'chron-chip is-pri' + (g.priority === 2 ? ' is-now' : '')}
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
                        <span className="chron-chip is-run" title={`${run} ${g.scope}s in a row`}>
                          🔥 {run}
                        </span>
                      ) : null
                    })()}
                    {/* ⚠️ a derived goal says WHERE its number comes from, because a number that
                        moves on its own and does not say why reads as a bug rather than a feature */}
                    {from ? (
                      <span className="chron-chip is-auto">
                        from {from}
                        {fromWhat ? ' · ' + fromWhat : ''}
                      </span>
                    ) : null}
                    {/* ⚠️ next to the delete rather than on the title, unlike the activity rows:
                        a goal's title is already a checkbox for the tick-box kind, and a label
                        that both ticks and opens an editor is a label you cannot press safely */}
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
                      }}
                      aria-label={`Change ${g.title}`}
                      title={`Change ${g.title}`}
                    >
                      ✎
                    </button>
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
              <label className="chron-src">
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
              {/**
               * ⚠️ ONLY WHEN THE SOURCE IS ONE ACTIVITY THAT COUNTS SOMETHING. Without a metric
               * there is nothing to choose between, and for a category the choice is meaningless —
               * so the control appears exactly when it is a real question and never as a dropdown
               * with one answer.
               */}
              {(() => {
                const picked = src.startsWith('a:') ? acts.find((a) => a.id === src.slice(2)) : null
                return picked?.metric ? (
                  <label className="chron-src">
                    <span className="sr-only">Count what?</span>
                    <select
                      value={countWhat}
                      onChange={(e) => setCountWhat(e.target.value as 'minutes' | 'amount')}
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
           * ⚠️ AND NOT FOR Years, which has no window to add up. All-time totals are a different
           * question and the range cap is 400 days, so pretending would mean quietly showing a
           * year and calling it everything.
           */}
          {win && v.scope !== 'day' && v.scope !== 'life' ? (
            <Looking win={win} label={v.label} scope={v.scope} on={on} />
          ) : null}
          {say && <p className="chron-say">{say}</p>}
        </>
      )}
    </section>
  )
}
