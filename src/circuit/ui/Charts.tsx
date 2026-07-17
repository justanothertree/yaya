// Charts — cumulative "race" line through the month + per-person category donuts.
// Ported flavor of the standalone's Charts tab; reads from the shared store.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { peopleInGroup } from '../groupFilter'
import { dayTotal, monthLabel, monthTotal } from '../scoring'
import { todayMonth } from '../dates'
import { catColor } from '../catColors'
import type { Person } from '../types'

type HoverDay = { day: number } | null

export function Charts({
  onDayClick,
  viewGroup = '',
}: { onDayClick?: (personId: string, date: string) => void; viewGroup?: string } = {}) {
  const state = useCircuit()
  // people scoped to the viewed circuit (shared filter)
  const people = useMemo(() => peopleInGroup(state.people, viewGroup), [state.people, viewGroup])
  const curMonth = todayMonth()
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
  const [mode, setMode] = useState<'cumulative' | 'daily' | 'rolling'>('cumulative')
  const [hover, setHover] = useState<HoverDay>(null)

  const handleSvgMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!series.length) return
    // Map the pointer into viewBox coords via the SVG's own matrix. The old
    // rect-proportional math broke inside canvas windows: the .cz-body zoom scales the
    // rendering but not getBoundingClientRect consistently, so the hover landed where
    // the full-size point would be. getScreenCTM reflects every transform above us.
    const ctm = e.currentTarget.getScreenCTM()
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ctm
      ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()).x
      : ((e.clientX - rect.left) / rect.width) * VW
    const rawDay = ((svgX - PL) / (VW - PL - PR)) * (days - 1)
    const day = Math.max(1, Math.min(days, Math.round(rawDay) + 1))
    setHover({ day })
  }

  // people with any points this month, with their per-day + derived series
  const series = useMemo(() => {
    return people
      .map((p) => {
        const total = monthTotal(p, state.logs, ym)
        if (total <= 0) return null
        const daily: number[] = []
        for (let d = 1; d <= days; d++) {
          daily.push(dayTotal(p, state.logs, `${ym}-${String(d).padStart(2, '0')}`))
        }
        const cumulative: number[] = []
        let cum = 0
        daily.forEach((v) => {
          cum += v
          cumulative.push(cum)
        })
        const rolling = daily.map((_, i) => {
          const win = daily.slice(Math.max(0, i - 6), i + 1)
          return win.reduce((s, v) => s + v, 0) / win.length
        })
        const pts = mode === 'cumulative' ? cumulative : mode === 'daily' ? daily : rolling
        return { p, total, pts }
      })
      .filter((x): x is { p: Person; total: number; pts: number[] } => !!x)
      .sort((a, b) => b.total - a.total)
  }, [people, state.logs, ym, days, mode])

  const maxY = Math.max(1, ...series.flatMap((s) => s.pts))
  const modeLabel =
    mode === 'cumulative'
      ? 'Cumulative points'
      : mode === 'daily'
        ? 'Points per day'
        : '7-day rolling average'

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
        <span
          style={{ display: 'inline-flex', gap: '0.35rem', marginLeft: 'auto', flexWrap: 'wrap' }}
        >
          {(
            [
              ['cumulative', 'Cumulative'],
              ['daily', 'Daily'],
              ['rolling', 'Rolling'],
            ] as ['cumulative' | 'daily' | 'rolling', string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className="btn"
              onClick={() => setMode(k)}
              aria-pressed={mode === k}
              style={
                mode === k
                  ? {
                      background: 'var(--accent, #7c6af7)',
                      color: '#fff',
                      borderColor: 'transparent',
                    }
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {series.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          No data in {monthLabel(ym)} — try ◀ for an earlier month.
        </p>
      ) : (
        <>
          {/* race / daily / rolling */}
          <div style={{ fontWeight: 700, opacity: 0.75, margin: '1rem 0 0.4rem' }}>{modeLabel}</div>
          <div style={{ position: 'relative' }}>
            <svg
              viewBox={`0 0 ${VW} ${VH}`}
              onMouseMove={handleSvgMove}
              onMouseLeave={() => setHover(null)}
              style={{
                width: '100%',
                // cap so the chart doesn't balloon (and get tall via its aspect) on a wide
                // window / big monitor — it stays a comfortable size, left-aligned
                maxWidth: 820,
                height: 'auto',
                background: 'var(--b1, rgba(127,127,127,0.06))',
                borderRadius: 8,
                cursor: hover ? 'crosshair' : 'default',
                display: 'block',
              }}
            >
              {/* y-axis grid + labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const v = Math.round(maxY * frac)
                return (
                  <g key={frac}>
                    <line
                      x1={PL}
                      y1={yy(v)}
                      x2={VW - PR}
                      y2={yy(v)}
                      stroke="currentColor"
                      opacity={frac === 0 ? 0.2 : 0.06}
                    />
                    <text
                      x={PL - 4}
                      y={yy(v)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      fontSize={9}
                      fill="currentColor"
                      opacity={0.45}
                    >
                      {v}
                    </text>
                  </g>
                )
              })}
              {/* x-axis day labels */}
              {Array.from({ length: days }, (_, i) => i + 1)
                .filter((d) => d === 1 || d % 7 === 0 || d === days)
                .map((d) => (
                  <text
                    key={d}
                    x={x(d)}
                    y={VH - 5}
                    textAnchor="middle"
                    fontSize={9}
                    fill="currentColor"
                    opacity={0.38}
                  >
                    {d}
                  </text>
                ))}
              {/* goal reference: diagonal pace for cumulative, flat 100/day line otherwise */}
              {mode === 'cumulative'
                ? (() => {
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
                  })()
                : 100 <= maxY && (
                    <line
                      x1={PL}
                      y1={yy(100)}
                      x2={x(days)}
                      y2={yy(100)}
                      stroke="currentColor"
                      opacity={0.18}
                      strokeDasharray="4 4"
                    />
                  )}
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
              {/* hover crosshair + dots */}
              {hover && (
                <>
                  <line
                    x1={x(hover.day)}
                    y1={PT}
                    x2={x(hover.day)}
                    y2={VH - PB}
                    stroke="currentColor"
                    opacity={0.25}
                    strokeWidth={1}
                  />
                  {series.map((s) => {
                    const val = s.pts[hover.day - 1]
                    if (val == null) return null
                    return (
                      <circle
                        key={s.p.id}
                        cx={x(hover.day)}
                        cy={yy(val)}
                        r={4}
                        fill={s.p.color}
                        stroke="var(--panel, #141a2a)"
                        strokeWidth={2}
                      />
                    )
                  })}
                </>
              )}
            </svg>

            {/* hover tooltip */}
            {hover &&
              (() => {
                const pct = (x(hover.day) / VW) * 100
                const onRight = pct > 62
                const dateStr = `${ym}-${String(hover.day).padStart(2, '0')}`
                return (
                  <div
                    style={{
                      position: 'absolute',
                      top: 6,
                      ...(onRight ? { right: `${100 - pct}%` } : { left: `${pct}%` }),
                      transform: onRight
                        ? 'translateX(50%)'
                        : pct < 14
                          ? 'translateX(4px)'
                          : 'translateX(-50%)',
                      background: 'var(--panel, #141a2a)',
                      border: '1px solid var(--border, rgba(255,255,255,0.12))',
                      borderRadius: 8,
                      padding: '0.35rem 0.55rem',
                      fontSize: '0.78rem',
                      pointerEvents: onDayClick ? 'auto' : 'none',
                      zIndex: 10,
                      whiteSpace: 'nowrap',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                    }}
                  >
                    <div className="muted" style={{ fontSize: '0.68rem', marginBottom: 4 }}>
                      {new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                    {series.map((s) => {
                      const val = s.pts[hover.day - 1] ?? 0
                      return (
                        <div
                          key={s.p.id}
                          onClick={onDayClick ? () => onDayClick(s.p.id, dateStr) : undefined}
                          title={onDayClick ? `Open ${s.p.name}'s log for this day` : undefined}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '1px 2px',
                            borderRadius: 4,
                            cursor: onDayClick ? 'pointer' : 'default',
                          }}
                          onMouseEnter={
                            onDayClick
                              ? (e) => {
                                  ;(e.currentTarget as HTMLElement).style.background =
                                    'rgba(127,127,127,0.12)'
                                }
                              : undefined
                          }
                          onMouseLeave={
                            onDayClick
                              ? (e) => {
                                  ;(e.currentTarget as HTMLElement).style.background = ''
                                }
                              : undefined
                          }
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: s.p.color,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ color: s.p.color, fontWeight: 700, minWidth: '2.5rem' }}>
                            {s.p.name}
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {Math.round(val)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
          </div>
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

      {/* monthly totals across all months with data */}
      {months.length > 1 && <MonthlyTotals viewGroup={viewGroup} />}
    </div>
  )
}

function MonthlyTotals({ viewGroup = '' }: { viewGroup?: string }) {
  const state = useCircuit()
  const people = useMemo(() => peopleInGroup(state.people, viewGroup), [state.people, viewGroup])
  const months = useMemo(
    () => [...new Set(state.logs.map((l) => l.date.slice(0, 7)))].sort(),
    [state.logs],
  )
  const data = useMemo(
    () =>
      months.map((ym) => ({
        ym,
        people: people
          .map((p) => ({ p, total: monthTotal(p, state.logs, ym) }))
          .filter((x) => x.total > 0),
      })),
    [months, people, state.logs],
  )
  const maxT = Math.max(1, ...data.flatMap((d) => d.people.map((x) => x.total)))

  return (
    <>
      <div style={{ fontWeight: 700, opacity: 0.75, margin: '1.6rem 0 0.6rem' }}>
        Monthly totals
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.9rem',
          alignItems: 'flex-end',
          overflowX: 'auto',
          paddingBottom: '0.4rem',
        }}
      >
        {data.map((mo) => (
          <div key={mo.ym} style={{ textAlign: 'center', flexShrink: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 3,
                height: 120,
                justifyContent: 'center',
              }}
            >
              {mo.people.map(({ p, total }) => (
                <span
                  key={p.id}
                  title={`${p.name}: ${Math.round(total)}`}
                  style={{
                    width: 12,
                    height: `${(total / maxT) * 100}%`,
                    minHeight: 2,
                    background: p.color,
                    borderRadius: '2px 2px 0 0',
                  }}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
              {monthLabel(mo.ym).replace(/ \d{4}$/, '')}
            </div>
          </div>
        ))}
      </div>
    </>
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
