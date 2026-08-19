// A participant's fitness profile: month total, avg/day, goal-days, streak, all-time total,
// category breakdown, personal records (best single-day per exercise) — and, when you're looking
// at someone else, how you compare.
import { useMemo } from 'react'
import { useCircuit } from '../store'
import { Modal } from './Modal'
import { currentStreak, dayTotal, logPoints, monthLabel, monthTotal } from '../scoring'
import { catColor } from '../catColors'
import { peekPersistedUserId } from '../../finance/auth'
import type { DayLog, Person } from '../types'

/**
 * Points for one person over a whole month, and all-time.
 *
 * Pulled out of the big useMemo below so the SAME computation runs for you and for them —
 * comparing two numbers produced by two different code paths is how a head-to-head quietly
 * starts lying. Everything routes through the shared scoring module for the same reason: the
 * multipliers are per-person, so there is exactly one correct way to turn a log into points.
 */
function totalsFor(p: Person, logs: DayLog[], ym: string) {
  const mine = logs.filter((l) => l.personId === p.id)
  return {
    month: monthTotal(p, logs, ym),
    allTime: mine.reduce((acc, l) => acc + logPoints(p, l), 0),
    streak: currentStreak(p, logs),
    lastLogged: mine.reduce<string | null>((a, l) => (!a || l.date > a ? l.date : a), null),
  }
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 60,
        textAlign: 'center',
        background: 'var(--b1, rgba(127,127,127,0.07))',
        borderRadius: 8,
        padding: '0.5rem 0.35rem',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: color || 'inherit' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.64rem' }}>
        {label}
      </div>
    </div>
  )
}

export function CircuitPersonProfile({
  person,
  ym,
  onClose,
}: {
  person: Person
  ym: string
  onClose: () => void
}) {
  const { logs, people } = useCircuit()
  /**
   * Who "you" are, read straight from the persisted session rather than passed down.
   *
   * Synchronous on purpose — this is local knowledge, so the comparison paints with the rest of
   * the modal instead of appearing a beat later. Threading it from App through Circuit and Board
   * would also have meant three components carrying a value only this one uses.
   */
  const meUserId = peekPersistedUserId()

  /**
   * You vs them — only when there is a real "you" to compare with.
   *
   * Deliberately quiet when it can't say something true: no signed-in user, you own no board in
   * this circuit, or you're looking at your own page. A comparison that falls back to zero for
   * one side isn't a comparison, it's just a discouraging number pointed at somebody.
   */
  const vs = useMemo(() => {
    if (!meUserId) return null
    const me = people.find((p) => p.ownerUserId === meUserId)
    if (!me || me.id === person.id) return null
    return { me, mine: totalsFor(me, logs, ym), theirs: totalsFor(person, logs, ym) }
  }, [meUserId, people, person, logs, ym])

  const s = useMemo(() => {
    const goal = person.goal ?? 100
    const [y, m] = ym.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const myLogs = logs.filter((l) => l.personId === person.id)

    let mTotal = 0,
      daysLogged = 0,
      goalDays = 0
    const cats: Record<string, number> = {}
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`
      const dt = dayTotal(person, logs, date)
      if (dt > 0) {
        daysLogged++
        mTotal += dt
        if (dt >= goal) goalDays++
      }
      myLogs
        .filter((l) => l.date === date)
        .forEach((l) =>
          (l.entries || []).forEach((e) => {
            if (e.eid === '__total__') {
              cats.other = (cats.other || 0) + e.val
              return
            }
            const ex = person.exercises.find((x) => x.id === e.eid)
            if (ex) cats[ex.cat || 'other'] = (cats[ex.cat || 'other'] || 0) + e.val * ex.mult
          }),
        )
    }
    const avgPerDay = daysLogged ? mTotal / daysLogged : 0
    const allTime = myLogs.reduce((acc, l) => acc + logPoints(person, l), 0)
    const streak = currentStreak(person, logs)
    const catList = Object.entries(cats)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])

    // personal records: best single-day raw value per exercise
    const prBy: Record<string, number> = {}
    myLogs.forEach((l) =>
      (l.entries || []).forEach((e) => {
        if (e.eid === '__total__') return
        if (!(e.eid in prBy) || e.val > prBy[e.eid]) prBy[e.eid] = e.val
      }),
    )
    const prs = person.exercises
      .map((ex) => ({ ex, best: prBy[ex.id] ?? 0 }))
      .filter((x) => x.best > 0)
      .sort((a, b) => b.best * b.ex.mult - a.best * a.ex.mult)
      .slice(0, 8)

    return { mTotal, daysLogged, goalDays, avgPerDay, allTime, streak, catList, prs }
  }, [logs, person, ym])

  const catMax = Math.max(1, ...s.catList.map(([, v]) => v))

  return (
    <Modal
      title={
        <span>
          <span style={{ color: person.color }}>{person.name}</span>
          <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
            {' '}
            · {monthLabel(ym)}
          </span>
        </span>
      }
      onClose={onClose}
    >
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Tile label="This month" value={String(Math.round(s.mTotal))} color={person.color} />
        <Tile label="Pts/day" value={String(Math.round(s.avgPerDay))} />
        <Tile label="Goal days" value={`${s.goalDays}/${s.daysLogged}`} />
        <Tile label="Streak" value={s.streak > 0 ? `🔥${s.streak}` : '—'} />
        <Tile label="All-time" value={s.allTime.toLocaleString()} />
      </div>

      {/* You vs them. Month AND all-time on purpose: a month is the live contest, all-time is
          the one that still means something when somebody hasn't logged in a while — and most
          of a crew is dormant most of the time. */}
      {vs && (
        <div className="cz-vs">
          <div className="cz-vs-head">
            <span style={{ color: vs.me.color }}>{vs.me.name}</span>
            <span className="muted">vs</span>
            <span style={{ color: person.color }}>{person.name}</span>
          </div>
          {(
            [
              { label: monthLabel(ym), a: vs.mine.month, b: vs.theirs.month },
              { label: 'All-time', a: vs.mine.allTime, b: vs.theirs.allTime },
            ] as const
          ).map((row) => {
            const total = row.a + row.b
            // an empty row would render a full bar for whoever has zero, which reads as a win
            const pct = total > 0 ? (row.a / total) * 100 : 50
            return (
              <div key={row.label} className="cz-vs-row">
                <span className="cz-vs-label muted">{row.label}</span>
                <strong className="cz-vs-num">{Math.round(row.a).toLocaleString()}</strong>
                <span className="cz-vs-bar" aria-hidden>
                  <span style={{ width: `${pct}%`, background: vs.me.color }} />
                  <span style={{ width: `${100 - pct}%`, background: person.color }} />
                </span>
                <strong className="cz-vs-num cz-vs-right">
                  {Math.round(row.b).toLocaleString()}
                </strong>
              </div>
            )
          })}
          {/* Says WHY their month is zero instead of leaving it looking like a thrashing. */}
          {vs.theirs.month === 0 && vs.theirs.lastLogged && (
            <p className="muted cz-vs-note">
              {person.name} hasn&apos;t logged this month — last was{' '}
              {new Date(vs.theirs.lastLogged + 'T00:00:00').toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
              .
            </p>
          )}
        </div>
      )}

      {/* category breakdown */}
      {s.catList.length > 0 && (
        <>
          <div
            style={{ fontWeight: 700, opacity: 0.7, fontSize: '0.78rem', margin: '1rem 0 0.4rem' }}
          >
            Category breakdown ({monthLabel(ym)})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {s.catList.map(([cat, v]) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: '3.5rem', fontSize: '0.78rem', textTransform: 'capitalize' }}>
                  {cat}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 12,
                    background: 'var(--b1, rgba(127,127,127,0.15))',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${(v / catMax) * 100}%`,
                      background: catColor(cat),
                      borderRadius: 6,
                    }}
                  />
                </span>
                <span
                  style={{
                    width: '3rem',
                    textAlign: 'right',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                  }}
                >
                  {Math.round(v)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* personal records */}
      {s.prs.length > 0 && (
        <>
          <div
            style={{ fontWeight: 700, opacity: 0.7, fontSize: '0.78rem', margin: '1rem 0 0.4rem' }}
          >
            🏆 Personal records (best day)
          </div>
          <div>
            {s.prs.map(({ ex, best }) => (
              <div
                key={ex.id}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '2px 0' }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: '0.82rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ex.name}
                </span>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {+best.toFixed(2)} {ex.unit}
                </span>
                <span
                  style={{
                    width: '3.5rem',
                    textAlign: 'right',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: person.color,
                  }}
                >
                  {Math.round(best * ex.mult)} pt
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {s.mTotal === 0 && s.allTime === 0 && (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          No workouts logged yet.
        </p>
      )}
    </Modal>
  )
}
