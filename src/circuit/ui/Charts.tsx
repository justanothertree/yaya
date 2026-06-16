// Charts — cumulative "race" line through the month + per-person category donuts.
// Ported flavor of the standalone's Charts tab; reads from the shared store.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { dayTotal, monthLabel, monthTotal } from '../scoring'
import type { Person } from '../types'

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
const catColor = (c: string) => CAT_COLORS[c] || '#9aa0aa'

export function Charts() {
  const state = useCircuit()
  const curMonth = new Date().toISOString().slice(0, 7)
  const months = useMemo(
    () => [...new Set(state.logs.map((l) => l.date.slice(0, 7)))].sort(),
    [state.logs],
  )
  const [picked, setPicked] = useState('')
  const ym =
    picked || (months.includes(curMonth) ? curMonth : months[months.length - 1] || curMonth)
  const shiftMonth = (d: number) => {
    const [y, m] = ym.split('-').map(Number)
    const dt = new Date(y, m - 1 + d, 1)
    setPicked(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const [y, m] = ym.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()

  // people with any points this month, with their cumulative-by-day series
  const series = useMemo(() => {
    return state.people
      .map((p) => {
        const total = monthTotal(p, state.logs, ym)
        if (total <= 0) return null
        let cum = 0
        const pts: number[] = []
        for (let d = 1; d <= days; d++) {
          cum += dayTotal(p, state.logs, `${ym}-${String(d).padStart(2, '0')}`)
          pts.push(cum)
        }
        return { p, total, pts }
      })
      .filter((x): x is { p: Person; total: number; pts: number[] } => !!x)
      .sort((a, b) => b.total - a.total)
  }, [state.people, state.logs, ym, days])

  const maxY = Math.max(1, ...series.map((s) => s.total))

  // race chart geometry
  const VW = 720,
    VH = 280,
    PL = 38,
    PR = 14,
    PT = 12,
    PB = 24
  const x = (day: number) => PL + ((day - 1) / Math.max(1, days - 1)) * (VW - PL - PR)
  const yy = (v: number) => VH - PB - (v / maxY) * (VH - PT - PB)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Charts</h3>
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

      {series.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No data in {monthLabel(ym)} — try ◀ for an earlier month.
        </p>
      ) : (
        <>
          {/* cumulative race */}
          <div style={{ fontWeight: 700, opacity: 0.75, margin: '1rem 0 0.4rem' }}>
            Cumulative points
          </div>
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            style={{
              width: '100%',
              height: 'auto',
              background: 'var(--b1, rgba(127,127,127,0.06))',
              borderRadius: 8,
            }}
          >
            {/* baseline */}
            <line
              x1={PL}
              y1={VH - PB}
              x2={VW - PR}
              y2={VH - PB}
              stroke="currentColor"
              opacity={0.2}
            />
            {/* goal pace reference (100/day) */}
            {(() => {
              const goalEnd = 100 * days
              const gy = yy(Math.min(goalEnd, maxY))
              return (
                <line
                  x1={PL}
                  y1={VH - PB}
                  x2={x(days)}
                  y2={gy}
                  stroke="currentColor"
                  opacity={0.18}
                  strokeDasharray="4 4"
                />
              )
            })()}
            {series.map((s) => (
              <polyline
                key={s.p.id}
                fill="none"
                stroke={s.p.color}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.pts.map((v, i) => `${x(i + 1)},${yy(v)}`).join(' ')}
              />
            ))}
          </svg>
          {/* legend */}
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', marginTop: '0.5rem' }}
          >
            {series.map((s) => (
              <span
                key={s.p.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.82rem',
                }}
              >
                <span
                  style={{ width: 10, height: 10, borderRadius: '50%', background: s.p.color }}
                />
                <strong style={{ color: s.p.color }}>{s.p.name}</strong>
                <span className="muted">{Math.round(s.total)}</span>
              </span>
            ))}
          </div>

          {/* per-person category donuts */}
          <div style={{ fontWeight: 700, opacity: 0.75, margin: '1.4rem 0 0.6rem' }}>
            Category breakdown
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '1rem',
            }}
          >
            {series.map((s) => (
              <Donut key={s.p.id} person={s.p} logs={state.logs} ym={ym} days={days} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Donut({
  person,
  logs,
  ym,
  days,
}: {
  person: Person
  logs: ReturnType<typeof useCircuit>['logs']
  ym: string
  days: number
}) {
  // sum points per category for the month
  const cats: Record<string, number> = {}
  for (let d = 1; d <= days; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`
    logs
      .filter((l) => l.personId === person.id && l.date === date)
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
  const entries = Object.entries(cats)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const R = 28,
    C = 2 * Math.PI * R
  let offset = 0

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 72 72" style={{ width: 84, height: 84 }}>
        <circle
          cx={36}
          cy={36}
          r={R}
          fill="none"
          stroke="var(--b1, rgba(127,127,127,0.18))"
          strokeWidth={10}
        />
        {entries.map(([cat, v]) => {
          const frac = v / total
          const seg = (
            <circle
              key={cat}
              cx={36}
              cy={36}
              r={R}
              fill="none"
              stroke={catColor(cat)}
              strokeWidth={10}
              strokeDasharray={`${frac * C} ${C}`}
              strokeDashoffset={-offset * C}
              transform="rotate(-90 36 36)"
            />
          )
          offset += frac
          return seg
        })}
        <text x={36} y={40} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">
          {Math.round(total)}
        </text>
      </svg>
      <div style={{ fontWeight: 700, color: person.color, fontSize: '0.85rem' }}>{person.name}</div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0.2rem 0.5rem',
          marginTop: 2,
        }}
      >
        {entries.slice(0, 4).map(([cat]) => (
          <span
            key={cat}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.66rem' }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: catColor(cat) }} />
            <span className="muted">{cat}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
