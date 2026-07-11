// Standings board — monthly points per person, with month navigation,
// day-squares (per-day glance), and current-streak flair (ported from the standalone).
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { currentStreak, monthDaily, monthLabel, monthTotal } from '../scoring'
import { todayISO, todayMonth } from '../dates'
import { CircuitPersonProfile } from './CircuitPersonProfile'
import type { Person } from '../types'

export function Board({
  onLogToday,
  onLogDate,
}: {
  onLogToday?: (personId: string) => void
  onLogDate?: (personId: string, date: string) => void
} = {}) {
  const state = useCircuit()
  const [profile, setProfile] = useState<Person | null>(null)
  // circuit picker: scope the standings to one of your circuits (only shown when you're
  // signed in and belong to one or more). 'all' shows everyone you can see.
  const groups = state.groups ?? []
  const [viewGroup, setViewGroup] = useState<string>('')
  const visiblePeople = useMemo(
    () =>
      viewGroup ? state.people.filter((p) => (p.groupIds ?? []).includes(viewGroup)) : state.people,
    [state.people, viewGroup],
  )
  const curMonth = todayMonth()
  const todayStr = todayISO()
  const months = useMemo(
    () => [...new Set(state.logs.map((l) => l.date.slice(0, 7)))].sort(),
    [state.logs],
  )
  const [picked, setPicked] = useState('')
  const ym =
    picked || (months.includes(curMonth) ? curMonth : months[months.length - 1] || curMonth)
  const [yNum, mNum] = ym.split('-').map(Number)
  const days = new Date(yNum, mNum, 0).getDate()
  const shiftMonth = (d: number) => {
    const dt = new Date(yNum, mNum - 1 + d, 1)
    setPicked(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const rows = useMemo(
    () =>
      visiblePeople
        .map((p) => {
          const daily = monthDaily(p, state.logs, ym, days)
          const daysLogged = daily.filter((d) => d > 0).length
          const total = monthTotal(p, state.logs, ym)
          return {
            p,
            total,
            goal: p.goal ?? 100,
            daily,
            daysLogged,
            avgDay: daysLogged ? total / daysLogged : 0,
            streak: currentStreak(p, state.logs),
          }
        })
        .sort((a, b) => b.total - a.total),
    [visiblePeople, state.logs, ym, days],
  )
  const max = Math.max(1, ...rows.map((r) => r.total))
  const anyData = rows.some((r) => r.total > 0)
  // today's day-of-month when the board is showing the current month (−1 otherwise) —
  // drives the highlighted "today" column, like the old fitness sheet's header
  const todayDay = ym === curMonth ? Number(todayStr.slice(8, 10)) : -1

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Standings</h3>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <button className="btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            ◀
          </button>
          <strong style={{ minWidth: '9rem', textAlign: 'center' }}>{monthLabel(ym)}</strong>
          <button
            className="btn"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            disabled={ym >= curMonth}
          >
            ▶
          </button>
          {ym !== curMonth && (
            <button
              className="btn btn-ghost"
              onClick={() => setPicked(curMonth)}
              style={{ fontSize: '0.78rem' }}
              title="Jump back to the current month"
            >
              ● This month
            </button>
          )}
        </span>
        {groups.length > 0 && (
          <label
            className="muted"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
              marginLeft: 'auto',
            }}
            title="Show just one of your circuits"
          >
            👥
            <select
              value={viewGroup}
              onChange={(e) => setViewGroup(e.target.value)}
              style={{ padding: '0.25rem 0.4rem' }}
            >
              <option value="">All circuits</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {visiblePeople.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          {viewGroup
            ? 'No one’s in this circuit yet — open the 👥 Circuits tab and “➕ Add me” to put yourself in it.'
            : 'No participants yet — your Circuit data will appear here once it’s seeded or synced.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {!anyData && (
            <p className="muted" style={{ margin: 0 }}>
              No logs in {monthLabel(ym)} — try ◀ for an earlier month.
            </p>
          )}
          {/* day-number header — one cell per day, aligned with every row's squares;
              today's column gets the accent pill (the fitness sheet's highlighted header) */}
          <div
            className="cz-board-days cz-board-dayhead"
            style={{
              display: 'flex',
              gap: 1.5,
              margin: '0 0 -6px calc(1.5rem + 0.75rem + 6rem + 0.75rem)',
            }}
            aria-hidden
          >
            {Array.from({ length: days }, (_, di) => {
              const isToday = di + 1 === todayDay
              return (
                <span
                  key={di}
                  className={isToday ? 'is-today' : undefined}
                  title={isToday ? 'Today' : undefined}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    textAlign: 'center',
                    fontSize: '0.58rem',
                    lineHeight: '13px',
                    height: 13,
                    borderRadius: 4,
                    overflow: 'hidden',
                    fontWeight: isToday ? 800 : 500,
                    color: isToday ? '#fff' : 'var(--ink2, rgba(127,127,127,0.75))',
                    background: isToday ? 'var(--accent, #7c6af7)' : 'transparent',
                  }}
                >
                  {di + 1}
                </span>
              )
            })}
          </div>
          {rows.map((r, i) => (
            <div key={r.p.id}>
              <div
                className="cz-board-row"
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <span
                  style={{
                    width: '1.5rem',
                    textAlign: 'center',
                    opacity: i < 3 ? 1 : 0.55,
                    fontSize: i < 3 ? '1rem' : undefined,
                  }}
                >
                  {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                </span>
                <span
                  className="cz-board-name"
                  onClick={() => setProfile(r.p)}
                  title={`${r.p.name}'s stats`}
                  style={{ width: '6rem', fontWeight: 700, color: r.p.color, cursor: 'pointer' }}
                >
                  {r.p.name}
                </span>
                <span
                  className="cz-board-bar"
                  style={{
                    flex: 1,
                    position: 'relative',
                    background: 'var(--b1, rgba(127,127,127,0.18))',
                    borderRadius: 6,
                    height: 14,
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${Math.min(100, (r.total / max) * 100)}%`,
                      background: r.p.color,
                      borderRadius: 6,
                      transition: 'width .7s cubic-bezier(.22,1,.36,1)',
                    }}
                  />
                  {/* a tick at every 100-pt milestone; the goal-pace mark (goal × days) is brighter */}
                  {Array.from({ length: Math.floor(max / 100) }, (_, k) => (k + 1) * 100).map(
                    (mark) => (
                      <span
                        key={mark}
                        title={mark === r.goal * days ? `goal pace · ${mark}` : `${mark}`}
                        style={{
                          position: 'absolute',
                          top: -2,
                          height: 18,
                          width: mark === r.goal * days ? 2 : 1,
                          left: `${(mark / max) * 100}%`,
                          background:
                            mark === r.goal * days
                              ? 'rgba(255,255,255,0.5)'
                              : 'rgba(255,255,255,0.15)',
                          pointerEvents: 'none',
                        }}
                      />
                    ),
                  )}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    width: '2.6rem',
                    textAlign: 'right',
                    fontSize: '0.78rem',
                    opacity: r.streak > 0 ? 0.9 : 0,
                  }}
                  title={r.streak > 0 ? `${r.streak}-day streak` : undefined}
                >
                  {r.streak > 0 ? `🔥${r.streak}` : ''}
                </span>
                <span
                  className="cz-num cz-board-avg"
                  style={{
                    flexShrink: 0,
                    width: '3rem',
                    textAlign: 'right',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color:
                      r.avgDay <= 0
                        ? 'transparent'
                        : r.avgDay >= r.goal
                          ? '#22cc78'
                          : r.avgDay >= r.goal * 0.6
                            ? '#f5c060'
                            : '#f46b6b',
                  }}
                  title={
                    r.avgDay > 0
                      ? `${Math.round(r.avgDay)} pts/day across ${r.daysLogged} logged days`
                      : undefined
                  }
                >
                  {r.avgDay > 0 ? `${Math.round(r.avgDay)}/d` : ''}
                </span>
                <span
                  className="cz-num"
                  style={{
                    width: '3.5rem',
                    textAlign: 'right',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                  }}
                  title={`${Math.round(r.total)} pts · goal ${r.goal}/day`}
                >
                  {Math.round(r.total)}
                </span>
                {onLogToday && (
                  <button
                    onClick={() => onLogToday(r.p.id)}
                    title={
                      state.logs.some((l) => l.personId === r.p.id && l.date === todayStr)
                        ? 'Logged today'
                        : 'Log today'
                    }
                    style={{
                      flexShrink: 0,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      opacity: state.logs.some((l) => l.personId === r.p.id && l.date === todayStr)
                        ? 1
                        : 0.4,
                      padding: '0 2px',
                    }}
                  >
                    {state.logs.some((l) => l.personId === r.p.id && l.date === todayStr)
                      ? '✓'
                      : '＋'}
                  </button>
                )}
              </div>
              {/* day-squares: one per day of the month */}
              <div
                className="cz-board-days"
                style={{
                  display: 'flex',
                  gap: 1.5,
                  marginTop: 5,
                  marginLeft: 'calc(1.5rem + 0.75rem + 6rem + 0.75rem)',
                }}
              >
                {r.daily.map((pts, di) => {
                  const hit = pts >= r.goal
                  const some = pts > 0 && !hit
                  const isToday = di + 1 === todayDay
                  const dStr = `${ym}-${String(di + 1).padStart(2, '0')}`
                  return (
                    <span
                      key={di}
                      onClick={onLogDate ? () => onLogDate(r.p.id, dStr) : undefined}
                      title={`${dStr}: ${Math.round(pts)} pts${onLogDate ? ' · click to log' : ''}`}
                      style={{
                        flex: '1 1 0',
                        minWidth: 0,
                        height: 8,
                        borderRadius: 1.5,
                        background: hit || some ? r.p.color : 'var(--b1, rgba(127,127,127,0.18))',
                        opacity: hit ? 1 : some ? 0.45 : isToday ? 0.85 : 0.5,
                        // today's column stays visible down every row (accent ring),
                        // goal-hit keeps its white inner ring
                        boxShadow:
                          [
                            hit ? 'inset 0 0 0 1px rgba(255,255,255,0.55)' : '',
                            isToday ? '0 0 0 1.5px var(--accent, #7c6af7)' : '',
                          ]
                            .filter(Boolean)
                            .join(', ') || undefined,
                        cursor: onLogDate ? 'pointer' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {anyData && (
            <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>
              <span className="cz-board-bar">bar = month total · </span>each square = a day
              {todayDay > 0 ? ' · ▣ purple column = today' : ''} · ▢ ring = goal hit · 🔥 = current
              streak
            </div>
          )}
        </div>
      )}
      {profile && (
        <CircuitPersonProfile person={profile} ym={ym} onClose={() => setProfile(null)} />
      )}
    </div>
  )
}
