// Activity feed — chronological list of everyone's logged days, filterable by person.
// Rich cards: avatar, goal progress bar, category-colored exercise pills, photo thumbnails.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import type { DayLog, Person } from '../types'

const CAT_COLORS: Record<string, string> = {
  arms: '#f46b6b',
  core: '#a78bfa',
  legs: '#5b9cf6',
  bike: '#2ec4b6',
  skate: '#fb923c',
  run: '#22cc78',
  walk: '#f5c060',
  other: '#9aa0aa',
}
const catColor = (c?: string) => CAT_COLORS[c || 'other'] || '#9aa0aa'

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

type Pill = { label: string; color: string }
function pillsFor(person: Person, log: DayLog): Pill[] {
  if (isImportedTotal(log)) return []
  return (log.entries || [])
    .filter((e) => e.val > 0)
    .map((e) => {
      const ex = person.exercises.find((x) => x.id === e.eid)
      return {
        label: ex ? `${ex.name} ${e.val}${ex.unit ? ' ' + ex.unit : ''}` : `${e.val}`,
        color: catColor(ex?.cat),
      }
    })
}

export function Feed() {
  const state = useCircuit()
  const [filter, setFilter] = useState('') // '' = everyone
  const [lightbox, setLightbox] = useState<string | null>(null)
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.map((log) => {
          const p = peopleById[log.personId]
          const pts = Math.round(logPoints(p, log))
          const goal = p.goal ?? 100
          const pct = Math.min(100, goal ? (pts / goal) * 100 : 0)
          const hit = pts >= goal
          const pills = pillsFor(p, log)
          const imported = isImportedTotal(log)
          return (
            <div
              key={log.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.7rem',
                padding: '0.6rem 0.7rem',
                background: 'var(--b1, rgba(127,127,127,0.05))',
                borderRadius: 10,
                borderLeft: `3px solid ${p.color}`,
              }}
            >
              {/* avatar */}
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: p.color,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  flexShrink: 0,
                }}
              >
                {p.name.charAt(0)}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ color: p.color }}>{p.name}</strong>
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    {fmtDate(log.date)}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontWeight: 800,
                      fontVariantNumeric: 'tabular-nums',
                      color: hit ? '#22cc78' : 'inherit',
                    }}
                    title={`goal ${goal}`}
                  >
                    {pts}
                    {hit ? ' ✓' : ''}
                  </span>
                </div>

                {/* goal progress bar */}
                <div
                  style={{
                    height: 5,
                    borderRadius: 3,
                    background: 'var(--b1, rgba(127,127,127,0.18))',
                    overflow: 'hidden',
                    margin: '5px 0',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${pct}%`,
                      background: hit ? '#22cc78' : p.color,
                      borderRadius: 3,
                    }}
                  />
                </div>

                {/* exercise pills */}
                {imported ? (
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    📊 imported total
                  </span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {pills.map((pill, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: '0.72rem',
                          padding: '1px 8px',
                          borderRadius: 10,
                          background: pill.color + '22',
                          color: pill.color,
                          fontWeight: 600,
                          border: `1px solid ${pill.color}55`,
                        }}
                      >
                        {pill.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* photo thumbnail */}
                {log.img && (
                  <img
                    src={log.img}
                    alt="workout"
                    onClick={() => setLightbox(log.img!)}
                    style={{
                      marginTop: 6,
                      maxHeight: 96,
                      borderRadius: 8,
                      cursor: 'zoom-in',
                      display: 'block',
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* photo lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            zIndex: 1500,
          }}
        >
          <img
            src={lightbox}
            alt="workout"
            style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 10 }}
          />
        </div>
      )}
    </div>
  )
}
