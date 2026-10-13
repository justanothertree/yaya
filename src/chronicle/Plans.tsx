import { useCallback, useEffect, useMemo, useState } from 'react'
import { dropPlan, planDid, plansBetween, savePlan } from './cloud'
import { against, dayAgainst, planOpens, type Plan } from './plan'
import { lane, nowAt, spanText, type Activity, type Entry } from './record'

/**
 * Planned — what you mean a day to be, beside what it was.
 *
 * The HTML app's `planned` store, and the half of "looking ahead" the horizon tabs do not cover: a
 * goal says you are aiming at thirty minutes of drawing a day, a plan says where in tomorrow the
 * drawing goes. Both get asked, and they are different questions.
 *
 * ⚠️ A PLAN IS NEVER WORK DONE. Nothing here feeds a tally, a total or a goal — that is enforced by
 * `chronicle_plans` being its own table rather than a flag on the entries, and the comparison below
 * is the only place the two numbers meet. It keeps them in separate columns, because the whole use
 * of it is the gap between them.
 *
 * ⚠️ AND IT IS A FOLD, like Routines and Activities. The day already carries a stopwatch, a log,
 * three category totals and seven horizon tabs; a fourth always-open block would push the thing
 * people came for off a phone screen. It opens by itself when the day on screen has plans in it and
 * nothing has been logged against them yet — which is the one moment it is the most useful thing
 * in the room.
 */
export function Plans({
  acts,
  log,
  bounds,
  onChange,
  busy,
}: {
  acts: Activity[]
  /** the day's entries, for the comparison — the same list the log above is drawn from */
  log: Entry[]
  /** ⚠️ the DAY arrives as its bounds rather than as a date, because that is what both the
      reload and the comparison need — and one of them deriving its own from the other is how two
      halves of a screen end up describing different days */
  bounds: { fromMs: number; toMs: number }
  onChange: () => Promise<void> | void
  busy: boolean
}) {
  const [rows, setRows] = useState<Plan[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [say, setSay] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const load = useCallback(async () => {
    setRows(
      await plansBetween(
        new Date(bounds.fromMs).toISOString(),
        new Date(bounds.toMs).toISOString(),
      ),
    )
  }, [bounds.fromMs, bounds.toMs])

  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts])

  const sides = useMemo(
    () => (rows ? against(rows, log, bounds.fromMs, bounds.toMs, Date.now()) : []),
    [rows, log, bounds.fromMs, bounds.toMs],
  )
  /**
   * The day as a strip: what was meant above, what happened below.
   *
   * ⚠️ IT COSTS NO QUERY, like the streak marks. This block already receives the day's entries —
   * it needs them for the comparison — and holds the plans itself, so both lanes are spans that
   * are already in memory. The log beneath draws them as a column of LENGTHS and throws the
   * placement away; this is the one thing the record could not say until now, which is the SHAPE
   * of a day: a solid morning, an afternoon that went somewhere else, an evening that was meant
   * to hold something and did not.
   *
   * ⚠️ AND IT LIVES HERE RATHER THAN IN THE TIMER, because here both lanes exist. An actual-only
   * strip above the log would be prettier and would say less than the log already does — the gap
   * between the two rows is the whole reason to draw it.
   */
  const strip = useMemo(
    () => ({
      meant: rows
        ? lane(
            rows.filter((p) => p.end),
            bounds.fromMs,
            bounds.toMs,
            Date.now(),
          )
        : [],
      had: lane(log, bounds.fromMs, bounds.toMs, Date.now()),
      now: nowAt(bounds.fromMs, bounds.toMs, Date.now()),
    }),
    [rows, log, bounds.fromMs, bounds.toMs],
  )

  const whole = useMemo(
    () =>
      rows ? dayAgainst(rows, log, bounds.fromMs, bounds.toMs, Date.now()) : { planned: 0, did: 0 },
    [rows, log, bounds.fromMs, bounds.toMs],
  )

  /**
   * ⚠️ OPENS ITSELF WHEN THERE IS A PLAN AND NOTHING DONE AGAINST IT, and only then. A fold that
   * springs open every time is a block that is always open with an extra click in it; one that
   * never does is a feature nobody finds. The moment worth interrupting for is the start of a day
   * you have already decided about.
   */
  useEffect(() => {
    if (rows && rows.length > 0 && whole.did === 0) setOpen(true)
  }, [rows, whole.did])

  /** the local `datetime-local` spelling of an instant — the same conversion the entry editor uses */
  const forInput = (ms: number): string => {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const startAdding = () => {
    const o = planOpens(rows ?? [], bounds.fromMs, bounds.toMs, Date.now())
    setFrom(forInput(o.fromMs))
    setTo(forInput(o.toMs))
    setPick(acts.find((a) => !a.archived)?.id ?? '')
    setNote('')
    setFixing(null)
    setAdding(true)
  }

  const startFixing = (p: Plan) => {
    setFixing(p.id)
    setPick(p.activity)
    setFrom(forInput(Date.parse(p.start)))
    setTo(forInput(Date.parse(p.end ?? p.start)))
    setNote(p.note ?? '')
    setAdding(false)
  }

  const keep = async () => {
    if (!pick) return moan('which activity?')
    if (!from || !to) return moan('both ends of the span, please')
    const r = await savePlan(
      pick,
      new Date(from).toISOString(),
      new Date(to).toISOString(),
      note.trim() || null,
      fixing ?? undefined,
    )
    if ('why' in r) return moan(r.why)
    setAdding(false)
    setFixing(null)
    await load()
  }

  const forget = async (p: Plan) => {
    const name = byId.get(p.activity)?.name ?? 'that'
    if (!window.confirm(`Drop the plan for ${name}?`)) return
    await dropPlan(p.id)
    await load()
  }

  /** ⚠️ it reloads BOTH: the plan list is ours, but the entry it made belongs to the day above */
  const did = async (p: Plan) => {
    const bad = await planDid(p.id)
    if (bad) return moan(bad.why)
    await load()
    await onChange()
  }

  /**
   * A span of a day, as short as it can be said.
   *
   * ⚠️ THE MERIDIEM ONCE, NOT TWICE. "7:00 AM–7:45 AM" is 112px of a 302px row before the
   * activity or any of its three buttons get a say, and it overflowed the list by 45px — a
   * plan row cannot answer that by hiding its time the way a log entry does, because for a
   * plan the time IS the content. Saying "AM" twice about one morning was the cheapest 27px
   * in the row, and it reads better.
   */
  const spanClock = (a: string, b: string): string => {
    const t = (iso: string) =>
      new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const x = t(a)
    const y = t(b)
    /* the trailing run of LETTERS, which is the meridiem where there is one and nothing at all in
       a 24-hour locale. Asking for letters rather than excluding separators is the point: Chrome
       puts a narrow no-break space before AM/PM, and a class that had to exclude that character
       either carries it literally — an eslint error, and invisible in a diff — or in an escape. */
    const tail = y.match(/\p{L}+$/u)?.[0]
    return tail && x.endsWith(tail) ? x.slice(0, -tail.length).trim() + '–' + y : x + '–' + y
  }

  const form = (
    <div className="chron-add">
      <label className="chron-gap">
        <span className="sr-only">Which activity</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {acts
            .filter((a) => !a.archived || a.id === pick)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label className="chron-gap">
        <span className="sr-only">From when</span>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="chron-gap">
        <span className="sr-only">Until when</span>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="chron-qty">
        <span className="sr-only">A note, if you like</span>
        <input
          value={note}
          placeholder="a note, if you like"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="btn" disabled={busy || !pick} onClick={() => void keep()}>
        {fixing ? 'Save' : 'Plan it'}
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
  )

  return (
    <details className="chron-tidy" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Planned
        {whole.planned > 0 && (
          <span className="muted">
            {spanText(whole.planned * 60_000)} planned · {spanText(whole.did * 60_000)} done
          </span>
        )}
      </summary>

      {rows === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : (
        <>
          {/**
           * ⚠️ A FIXED TWENTY-FOUR HOURS, never scaled to the part of the day that was used. A
           * strip that stretched an hour of work across its whole width would make a quiet day
           * look like a full one — the axis has to be the day, or the shape it shows is a lie.
           *
           * ⚠️ AND THE TICKS ARE THERE SO THE STRIP MEANS SOMETHING. Six, twelve and eighteen are
           * enough to place a block at a glance; an unlabelled bar is a decoration.
           */}
          {(strip.meant.length > 0 || strip.had.length > 0) && (
            <div className="chron-shape">
              <div className="chron-lane is-meant">
                {strip.meant.map((b, i) => (
                  <i
                    key={i}
                    style={{ left: b.left + '%', width: b.width + '%' }}
                    className={b.cut ? 'is-cut' : undefined}
                  />
                ))}
              </div>
              <div className="chron-lane is-had">
                {strip.had.map((b, i) => (
                  <i
                    key={i}
                    style={{ left: b.left + '%', width: b.width + '%' }}
                    className={
                      'is-' + (byId.get(b.activity)?.cat ?? 'free') + (b.cut ? ' is-cut' : '')
                    }
                  />
                ))}
                {strip.now != null && <b className="chron-now" style={{ left: strip.now + '%' }} />}
              </div>
              <div className="chron-ticks" aria-hidden>
                <span style={{ left: '25%' }}>6</span>
                <span style={{ left: '50%' }}>12</span>
                <span style={{ left: '75%' }}>18</span>
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <ul className="chron-plans">
              {rows.map((p) => {
                const a = byId.get(p.activity)
                return (
                  <li key={p.id} className="chron-plan">
                    <span className="chron-plan-when">{spanClock(p.start, p.end ?? p.start)}</span>
                    <span className="chron-plan-name">
                      {a?.name ?? 'an activity since deleted'}
                    </span>
                    {p.note && <span className="muted chron-plan-note">{p.note}</span>}
                    {/**
                     * ⚠️ THE THREE WRAP AS ONE. They are a single group of things you can do to
                     * this plan, and as loose siblings of a wrapping row the ✓ kept the first
                     * line while ✎ and ✕ dropped to the second — which reads as a broken layout
                     * rather than a deliberate one.
                     *
                     * ⚠️ And "I did it" writes the entry and KEEPS the plan — see planDid.
                     */}
                    <span className="chron-plan-do">
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        title="I did this — log it"
                        onClick={() => void did(p)}
                      >
                        <span aria-hidden>✓</span>
                        <span className="sr-only">Log this as done</span>
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => startFixing(p)}
                      >
                        <span aria-hidden>✎</span>
                        <span className="sr-only">Change this plan</span>
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void forget(p)}
                      >
                        <span aria-hidden>✕</span>
                        <span className="sr-only">Drop this plan</span>
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {(adding || fixing) && form}

          {!adding && !fixing && (
            <button className="btn btn-ghost" onClick={startAdding} disabled={!acts.length}>
              ＋ Plan a span
            </button>
          )}

          {!rows.length && !adding && (
            <p className="muted">
              {/* ⚠️ A DISABLED BUTTON THAT SAYS NOTHING IS ITS OWN DEAD END. With no activities yet
                  the adder above cannot work, and a new member staring at a greyed-out "＋ Plan a
                  span" has no way to learn what is missing — a tooltip does not exist on a phone
                  (CLAUDE.md §6), so the reason has to be in the sentence. */}
              {acts.length
                ? 'Nothing planned for this day. A plan is where in a day something goes — the horizon tabs below say what you are aiming at, this says when.'
                : 'Name an activity with ＋ Activity first — a plan is a stretch of a day set aside for one of them.'}
            </p>
          )}

          {/**
           * ⚠️ BOTH DIRECTIONS, which is the whole point — see `against`. A day misses its plan two
           * opposite ways, and the one that is easy to leave out is the afternoon that went into
           * something nobody planned. A list built from the plans alone would report that day as
           * having gone exactly as intended.
           */}
          {sides.length > 0 && (
            <ul className="chron-against">
              {sides.map((s) => {
                const a = byId.get(s.activity)
                const over = s.did > s.planned
                return (
                  <li key={s.activity} className="chron-vs">
                    <span className="chron-vs-name">{a?.name ?? 'something since deleted'}</span>
                    <span className="chron-vs-num">
                      {s.planned > 0 ? spanText(s.planned * 60_000) : 'unplanned'}
                    </span>
                    <span aria-hidden className="muted">
                      →
                    </span>
                    <span className={'chron-vs-num' + (over ? ' is-over' : '')}>
                      {s.did > 0 ? spanText(s.did * 60_000) : 'not yet'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {say && <p className="chron-say">{say}</p>}
        </>
      )}
    </details>
  )
}
