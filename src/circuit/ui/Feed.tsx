// Activity feed — chronological list of everyone's logged days, filterable by person.
// First port of the standalone's Feed (list view); calendar / week / table views to follow.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import type { DayLog, Person } from '../types'

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
function summary(person: Person, log: DayLog): string {
  if (isImportedTotal(log)) return 'imported total'
  return (log.entries || [])
    .filter((e) => e.val > 0)
    .map((e) => {
      const ex = person.exercises.find((x) => x.id === e.eid)
      return ex ? `${ex.name} ${e.val}${ex.unit ? ' ' + ex.unit : ''}` : `${e.val}`
    })
    .join(' · ')
}

export function Feed() {
  const state = useCircuit()
  const [filter, setFilter] = useState('') // '' = everyone
  const peopleById = useMemo(
    () => Object.fromEntries(state.people.map((p) => [p.id, p])) as Record<string, Person>,
    [state.people],
  )

  const rows = useMemo(
    () =>
      state.logs
        .filter((l) => peopleById[l.personId] && (!filter || l.personId === filter))
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.logs, filter, peopleById],
  )

  if (!state.logs.length) return <p className="muted">No activity yet.</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Activity</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {rows.length} entries
        </span>
      </div>

      {/* person filter */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.8rem 0 1rem' }}>
        <button
          className="btn"
          onClick={() => setFilter('')}
          aria-pressed={filter === ''}
          style={
            filter === ''
              ? { background: 'var(--accent, #7c6af7)', color: '#fff', borderColor: 'transparent' }
              : undefined
          }
        >
          All
        </button>
        {state.people.map((p) => {
          const on = filter === p.id
          return (
            <button
              key={p.id}
              className="btn"
              onClick={() => setFilter(p.id)}
              style={{
                borderColor: p.color,
                color: on ? '#fff' : p.color,
                background: on ? p.color : 'transparent',
                fontWeight: 700,
              }}
            >
              {p.name}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((log) => {
          const p = peopleById[log.personId]
          const pts = Math.round(logPoints(p, log))
          const goal = p.goal ?? 100
          return (
            <div
              key={log.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.6rem 0',
                borderTop: '1px solid var(--b1, rgba(127,127,127,0.15))',
              }}
            >
              <span style={{ width: '5.5rem', flexShrink: 0, fontSize: '0.8rem', opacity: 0.7 }}>
                {fmtDate(log.date)}
              </span>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: p.color,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: p.color }}>{p.name}</div>
                <div
                  className="muted"
                  style={{
                    fontSize: '0.78rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {summary(p, log)}
                </div>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontWeight: 800,
                  fontVariantNumeric: 'tabular-nums',
                  color: pts >= goal ? '#22cc78' : 'inherit',
                }}
                title={`goal ${goal}`}
              >
                {pts}
                {pts >= goal ? ' ✓' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
