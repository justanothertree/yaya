// Standings board — monthly points per person, with month navigation,
// day-squares (per-day glance), and current-streak flair (ported from the standalone).
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { currentStreak, monthDaily, monthLabel, monthTotal } from '../scoring'
import { CircuitPersonProfile } from './CircuitPersonProfile'
import type { Person } from '../types'

export function Board({ onLogToday }: { onLogToday?: (personId: string) => void } = {}) {
  const state = useCircuit()
  const [profile, setProfile] = useState<Person | null>(null)
  const curMonth = new Date().toISOString().slice(0, 7)
  const todayStr = new Date().toISOString().slice(0, 10)
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
      state.people
        .map((p) => ({
          p,
          total: monthTotal(p, state.logs, ym),
          goal: p.goal ?? 100,
          daily: monthDaily(p, state.logs, ym, days),
          streak: currentStreak(p, state.logs),
        }))
        .sort((a, b) => b.total - a.total),
    [state.people, state.logs, ym, days],
  )
  const max = Math.max(1, ...rows.map((r) => r.total))
  const anyData = rows.some((r) => r.total > 0)

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
        </span>
      </div>

      {state.people.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No participants yet — your Circuit data will appear here once it’s seeded or synced.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {!anyData && (
            <p className="muted" style={{ margin: 0 }}>
              No logs in {monthLabel(ym)} — try ◀ for an earlier month.
            </p>
          )}
          {rows.map((r, i) => (
            <div key={r.p.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ width: '1.5rem', textAlign: 'right', opacity: 0.6 }}>{i + 1}</span>
                <span
                  onClick={() => setProfile(r.p)}
                  title={`${r.p.name}'s stats`}
                  style={{ width: '6rem', fontWeight: 700, color: r.p.color, cursor: 'pointer' }}
                >
                  {r.p.name}
                </span>
                <span
                  style={{
                    flex: 1,
                    background: 'var(--b1, rgba(127,127,127,0.18))',
                    borderRadius: 6,
                    height: 14,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${(r.total / max) * 100}%`,
                      background: r.p.color,
                      borderRadius: 6,
                    }}
                  />
                </span>
                {r.streak > 0 && (
                  <span
                    style={{ flexShrink: 0, fontSize: '0.78rem', opacity: 0.85 }}
                    title={`${r.streak}-day streak`}
                  >
                    🔥{r.streak}
                  </span>
                )}
                <span
                  style={{
                    width: '3.5rem',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 700,
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
                  return (
                    <span
                      key={di}
                      title={`${ym}-${String(di + 1).padStart(2, '0')}: ${Math.round(pts)} pts`}
                      style={{
                        flex: '1 1 0',
                        minWidth: 0,
                        height: 8,
                        borderRadius: 1.5,
                        background: hit || some ? r.p.color : 'var(--b1, rgba(127,127,127,0.18))',
                        opacity: hit ? 1 : some ? 0.45 : 0.5,
                        boxShadow: hit ? 'inset 0 0 0 1px rgba(255,255,255,0.55)' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {anyData && (
            <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>
              bar = month total · each square = a day · ▢ ring = goal hit · 🔥 = current streak
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
