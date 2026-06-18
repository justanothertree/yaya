// Activity feed — multi-view: List · Month · Week · Day · Table.
// All views share the person filter. Month/Table day cells drill into Day view.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import { catColor } from '../catColors'
import type { DayLog, Person } from '../types'

type View = 'list' | 'month' | 'week' | 'day' | 'table'

const isoToday = () => new Date().toISOString().slice(0, 10)
function isoAdd(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function startOfWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay()) // back to Sunday
  return d.toISOString().slice(0, 10)
}
function fmtDate(d: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d + 'T00:00:00').toLocaleDateString(
    'en-US',
    opts || { weekday: 'short', month: 'short', day: 'numeric' },
  )
}
function monthCells(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number)
  const lead = new Date(y, m - 1, 1).getDay()
  const days = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
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

// ── shared rich card ────────────────────────────────────────────────────────
function LogCard({
  log,
  person,
  onPhoto,
  compact,
}: {
  log: DayLog
  person: Person
  onPhoto: (src: string) => void
  compact?: boolean
}) {
  const p = person
  const pts = Math.round(logPoints(p, log))
  const goal = p.goal ?? 100
  const pct = Math.min(100, goal ? (pts / goal) * 100 : 0)
  const hit = pts >= goal
  const pills = pillsFor(p, log)
  const imported = isImportedTotal(log)
  return (
    <div
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
      {!compact && (
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
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <strong style={{ color: p.color }}>{p.name}</strong>
          {!compact && (
            <span className="muted" style={{ fontSize: '0.76rem' }}>
              {fmtDate(log.date)}
            </span>
          )}
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
        {log.img && (
          <img
            src={log.img}
            alt="workout"
            onClick={() => onPhoto(log.img!)}
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
}

export function Feed() {
  const state = useCircuit()
  const [view, setView] = useState<View>('list')
  const [filter, setFilter] = useState('') // '' = everyone
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)

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

  const latestDate = useMemo(
    () =>
      state.logs.length
        ? state.logs
            .map((l) => l.date)
            .sort()
            .pop()!
        : isoToday(),
    [state.logs],
  )
  const cur = cursor || latestDate

  // date -> logs (filtered)
  const logsByDate = useMemo(() => {
    const m: Record<string, DayLog[]> = {}
    for (const l of rows) (m[l.date] ||= []).push(l)
    return m
  }, [rows])

  // date -> personId -> points (filtered)
  const ptsIndex = useMemo(() => {
    const idx: Record<string, Record<string, number>> = {}
    for (const l of rows) {
      const p = peopleById[l.personId]
      if (!p) continue
      ;(idx[l.date] ||= {})[l.personId] = (idx[l.date]?.[l.personId] || 0) + logPoints(p, l)
    }
    return idx
  }, [rows, peopleById])

  const drillToDay = (date: string) => {
    setCursor(date)
    setView('day')
  }

  if (!state.logs.length) return <p className="muted">No activity yet.</p>

  const views: [View, string][] = [
    ['list', '📜 List'],
    ['month', '🗓️ Month'],
    ['week', '📆 Week'],
    ['day', '☀️ Day'],
    ['table', '▦ Table'],
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Activity</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {rows.length} entries
        </span>
        <span
          style={{ display: 'inline-flex', gap: '0.3rem', marginLeft: 'auto', flexWrap: 'wrap' }}
        >
          {views.map(([k, label]) => (
            <button
              key={k}
              className="btn"
              onClick={() => setView(k)}
              aria-pressed={view === k}
              style={
                view === k
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

      {/* date nav (month/week/day only) */}
      {view !== 'list' && view !== 'table' && (
        <DateNav view={view} cur={cur} latest={latestDate} onShift={(n) => setCursor(n)} />
      )}

      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rows.map((log) => (
            <LogCard
              key={log.id}
              log={log}
              person={peopleById[log.personId]}
              onPhoto={setLightbox}
            />
          ))}
        </div>
      )}

      {view === 'month' && (
        <MonthView
          ym={cur.slice(0, 7)}
          people={state.people}
          ptsIndex={ptsIndex}
          filter={filter}
          onDay={drillToDay}
        />
      )}

      {view === 'week' && (
        <WeekView
          cur={cur}
          logsByDate={logsByDate}
          peopleById={peopleById}
          onPhoto={setLightbox}
          onDay={drillToDay}
        />
      )}

      {view === 'day' && (
        <DayView cur={cur} logsByDate={logsByDate} peopleById={peopleById} onPhoto={setLightbox} />
      )}

      {view === 'table' && (
        <TableView
          rows={rows}
          people={state.people}
          ptsIndex={ptsIndex}
          filter={filter}
          onDay={drillToDay}
        />
      )}

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

// ── date navigation header ──────────────────────────────────────────────────
function DateNav({
  view,
  cur,
  latest,
  onShift,
}: {
  view: View
  cur: string
  latest: string
  onShift: (iso: string) => void
}) {
  let label = ''
  let prev = cur
  let next = cur
  let nextDisabled = false
  if (view === 'month') {
    const [y, m] = cur.split('-').map(Number)
    label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    prev = `${new Date(y, m - 2, 1).getFullYear()}-${String(new Date(y, m - 2, 1).getMonth() + 1).padStart(2, '0')}-01`
    const nx = new Date(y, m, 1)
    next = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, '0')}-01`
    nextDisabled = cur.slice(0, 7) >= latest.slice(0, 7)
  } else if (view === 'week') {
    const sow = startOfWeek(cur)
    const eow = isoAdd(sow, 6)
    label = `${fmtDate(sow, { month: 'short', day: 'numeric' })} – ${fmtDate(eow, { month: 'short', day: 'numeric' })}`
    prev = isoAdd(sow, -7)
    next = isoAdd(sow, 7)
    nextDisabled = sow >= startOfWeek(latest)
  } else {
    label = fmtDate(cur, { weekday: 'long', month: 'long', day: 'numeric' })
    prev = isoAdd(cur, -1)
    next = isoAdd(cur, 1)
    nextDisabled = cur >= latest
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.9rem',
      }}
    >
      <button className="btn btn-ghost" aria-label="Previous" onClick={() => onShift(prev)}>
        ◀
      </button>
      <strong style={{ minWidth: '12rem', textAlign: 'center' }}>{label}</strong>
      <button
        className="btn btn-ghost"
        aria-label="Next"
        onClick={() => onShift(next)}
        disabled={nextDisabled}
      >
        ▶
      </button>
    </div>
  )
}

// ── month calendar ──────────────────────────────────────────────────────────
function MonthView({
  ym,
  people,
  ptsIndex,
  filter,
  onDay,
}: {
  ym: string
  people: Person[]
  ptsIndex: Record<string, Record<string, number>>
  filter: string
  onDay: (date: string) => void
}) {
  const cells = monthCells(ym)
  const today = isoToday()
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p])) as Record<string, Person>
  const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
          marginBottom: 4,
        }}
      >
        {WD.map((d, i) => (
          <div
            key={i}
            className="muted"
            style={{ textAlign: 'center', fontSize: '0.68rem', fontWeight: 700 }}
          >
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const dayNum = Number(date.slice(8))
          const byP = ptsIndex[date] || {}
          const pids = Object.keys(byP).filter((pid) => byP[pid] > 0)
          const total = pids.reduce((s, pid) => s + byP[pid], 0)
          const isToday = date === today
          const has = pids.length > 0
          return (
            <button
              key={i}
              onClick={() => onDay(date)}
              title={has ? `${pids.length} logged · ${Math.round(total)} pts` : 'No activity'}
              style={{
                aspectRatio: '1 / 1',
                minHeight: 52,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                padding: '4px 5px',
                borderRadius: 8,
                border: isToday
                  ? '1px solid var(--accent, #7c6af7)'
                  : '1px solid var(--border, rgba(127,127,127,0.12))',
                background: has ? 'var(--b1, rgba(127,127,127,0.06))' : 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  opacity: isToday ? 1 : 0.55,
                  color: isToday ? 'var(--accent, #7c6af7)' : 'inherit',
                }}
              >
                {dayNum}
              </span>
              {filter ? (
                has && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      fontVariantNumeric: 'tabular-nums',
                      color: peopleById[pids[0]]?.color,
                    }}
                  >
                    {Math.round(total)}
                  </span>
                )
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 'auto' }}>
                  {pids.slice(0, 6).map((pid) => (
                    <span
                      key={pid}
                      title={peopleById[pid]?.name}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: peopleById[pid]?.color || '#888',
                      }}
                    />
                  ))}
                  {pids.length > 6 && (
                    <span className="muted" style={{ fontSize: '0.6rem', lineHeight: 1 }}>
                      +{pids.length - 6}
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.6rem' }}>
        Tap a day to see everyone's logs.
      </p>
    </div>
  )
}

// ── week (7 compact columns) ────────────────────────────────────────────────
function WeekView({
  cur,
  logsByDate,
  peopleById,
  onPhoto,
  onDay,
}: {
  cur: string
  logsByDate: Record<string, DayLog[]>
  peopleById: Record<string, Person>
  onPhoto: (src: string) => void
  onDay: (date: string) => void
}) {
  const sow = startOfWeek(cur)
  const days = Array.from({ length: 7 }, (_, i) => isoAdd(sow, i))
  const today = isoToday()
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.6rem',
      }}
    >
      {days.map((date) => {
        const logs = (logsByDate[date] || []).slice().sort((a, b) => {
          const pa = peopleById[a.personId]
          const pb = peopleById[b.personId]
          return logPoints(pb, b) - logPoints(pa, a)
        })
        const isToday = date === today
        return (
          <div
            key={date}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              padding: '0.5rem',
              borderRadius: 10,
              background: 'var(--b1, rgba(127,127,127,0.04))',
              border: isToday
                ? '1px solid var(--accent, #7c6af7)'
                : '1px solid var(--border, rgba(127,127,127,0.1))',
            }}
          >
            <button
              onClick={() => onDay(date)}
              className="muted"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.74rem',
                fontWeight: 700,
                textAlign: 'left',
                padding: 0,
                color: isToday ? 'var(--accent, #7c6af7)' : undefined,
              }}
            >
              {fmtDate(date, { weekday: 'short' })} {Number(date.slice(8))}
            </button>
            {logs.length === 0 ? (
              <span className="muted" style={{ fontSize: '0.72rem', opacity: 0.6 }}>
                —
              </span>
            ) : (
              logs.map((log) => (
                <LogCard
                  key={log.id}
                  log={log}
                  person={peopleById[log.personId]}
                  onPhoto={onPhoto}
                  compact
                />
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── single day (full cards) ─────────────────────────────────────────────────
function DayView({
  cur,
  logsByDate,
  peopleById,
  onPhoto,
}: {
  cur: string
  logsByDate: Record<string, DayLog[]>
  peopleById: Record<string, Person>
  onPhoto: (src: string) => void
}) {
  const logs = (logsByDate[cur] || [])
    .slice()
    .sort((a, b) => logPoints(peopleById[b.personId], b) - logPoints(peopleById[a.personId], a))
  if (!logs.length)
    return (
      <p className="muted" style={{ marginTop: '0.5rem' }}>
        No activity on this day.
      </p>
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {logs.map((log) => (
        <LogCard key={log.id} log={log} person={peopleById[log.personId]} onPhoto={onPhoto} />
      ))}
    </div>
  )
}

// ── table matrix (dates × people) ───────────────────────────────────────────
function TableView({
  rows,
  people,
  ptsIndex,
  filter,
  onDay,
}: {
  rows: DayLog[]
  people: Person[]
  ptsIndex: Record<string, Record<string, number>>
  filter: string
  onDay: (date: string) => void
}) {
  const dates = useMemo(
    () => [...new Set(rows.map((l) => l.date))].sort((a, b) => b.localeCompare(a)),
    [rows],
  )
  const cols = filter
    ? people.filter((p) => p.id === filter)
    : people.filter((p) => rows.some((l) => l.personId === p.id))
  return (
    <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th
              style={{
                padding: '6px 8px',
                position: 'sticky',
                top: 0,
                background: 'var(--panel, #141a2a)',
                zIndex: 1,
              }}
            >
              Date
            </th>
            {cols.map((p) => (
              <th
                key={p.id}
                style={{
                  padding: '6px 8px',
                  textAlign: 'center',
                  color: p.color,
                  position: 'sticky',
                  top: 0,
                  background: 'var(--panel, #141a2a)',
                  zIndex: 1,
                }}
              >
                {p.name}
              </th>
            ))}
            <th
              style={{
                padding: '6px 8px',
                textAlign: 'center',
                position: 'sticky',
                top: 0,
                background: 'var(--panel, #141a2a)',
                zIndex: 1,
              }}
            >
              Σ
            </th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const byP = ptsIndex[date] || {}
            const total = cols.reduce((s, p) => s + (byP[p.id] || 0), 0)
            return (
              <tr key={date} style={{ borderTop: '1px solid var(--b1, rgba(127,127,127,0.15))' }}>
                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => onDay(date)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'inherit',
                      padding: 0,
                      fontSize: '0.82rem',
                    }}
                    title="Open this day"
                  >
                    {fmtDate(date, { month: 'short', day: 'numeric' })}
                  </button>
                </td>
                {cols.map((p) => {
                  const v = byP[p.id] || 0
                  return (
                    <td key={p.id} style={{ padding: '5px 8px', textAlign: 'center' }}>
                      {v > 0 ? (
                        <span
                          style={{
                            display: 'inline-block',
                            minWidth: 30,
                            padding: '1px 6px',
                            borderRadius: 6,
                            background: p.color + '22',
                            color: p.color,
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {Math.round(v)}
                        </span>
                      ) : (
                        <span className="muted" style={{ opacity: 0.35 }}>
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
                <td
                  style={{
                    padding: '5px 8px',
                    textAlign: 'center',
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.round(total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
