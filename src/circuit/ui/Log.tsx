// Daily log — pick a person + date, enter per-exercise amounts, watch points/goal live, save.
// Writes through the shared store (localStorage now, Supabase realtime later).
import { useEffect, useMemo, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import { showToast } from '../toast'
import { ScrubInput } from './ScrubInput'
import { ExerciseManager } from './ExerciseManager'

const todayISO = () => new Date().toISOString().slice(0, 10)

export function Log({
  defaultPersonId,
  defaultDate,
}: {
  defaultPersonId?: string
  defaultDate?: string
} = {}) {
  const state = useCircuit()
  const [selPid, setSelPid] = useState(defaultPersonId ?? '')
  const [date, setDate] = useState(defaultDate ?? todayISO())
  const [vals, setVals] = useState<Record<string, string>>({})
  const [managing, setManaging] = useState(false)

  const pid = selPid || state.people[0]?.id || ''
  const person = state.people.find((p) => p.id === pid)
  const existing = useMemo(
    () => state.logs.find((l) => l.personId === pid && l.date === date),
    [state.logs, pid, date],
  )
  const imported = isImportedTotal(existing)

  // load saved values when person/date (or underlying data) changes
  useEffect(() => {
    const next: Record<string, string> = {}
    if (existing && !isImportedTotal(existing)) {
      for (const e of existing.entries) if (e.val) next[e.eid] = String(e.val)
    }
    setVals(next)
  }, [existing])

  const cols = useMemo(() => {
    if (!person) return []
    return person.colLabels.map((label, ci) => ({
      label,
      exs: person.exercises.filter((e) => e.col === ci).sort((a, b) => a.row - b.row),
    }))
  }, [person])

  if (!person) return <p className="muted">No participants yet.</p>

  const total = person.exercises.reduce((s, ex) => s + (parseFloat(vals[ex.id]) || 0) * ex.mult, 0)
  const goal = person.goal ?? 100
  const pct = Math.min(100, goal ? (total / goal) * 100 : 0)
  const hit = total >= goal

  const setVal = (id: string, v: string) => setVals((prev) => ({ ...prev, [id]: v }))
  const shiftDay = (d: number) => {
    const dt = new Date(date + 'T00:00:00')
    dt.setDate(dt.getDate() + d)
    setDate(dt.toISOString().slice(0, 10))
  }
  const save = () => {
    const entries = person.exercises
      .map((ex) => ({ eid: ex.id, val: parseFloat(vals[ex.id]) || 0 }))
      .filter((e) => e.val > 0)
    if (entries.length === 0) {
      if (existing) void circuitStore.deleteLog(existing.id)
      return
    }
    const id = existing?.id ?? crypto.randomUUID?.() ?? 'l' + Date.now()
    void circuitStore.saveLog({ id, personId: pid, date, entries })
    showToast('Saved!')
  }
  const clear = () => setVals({})
  const copyLast = () => {
    const prior = state.logs
      .filter(
        (l) =>
          l.personId === pid &&
          l.date < date &&
          (l.entries || []).some((e) => e.eid !== '__total__' && e.val > 0),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (!prior) return
    const next: Record<string, string> = {}
    prior.entries.forEach((e) => {
      if (e.eid !== '__total__' && e.val > 0) next[e.eid] = String(e.val)
    })
    setVals(next)
  }

  return (
    <div>
      {/* person chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        {state.people.map((p) => {
          const on = p.id === pid
          return (
            <button
              key={p.id}
              className="btn"
              onClick={() => setSelPid(p.id)}
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

      {/* date row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}
      >
        <button className="btn" aria-label="Previous day" onClick={() => shiftDay(-1)}>
          ‹
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: '0.4rem 0.6rem' }}
        />
        <button className="btn" aria-label="Next day" onClick={() => shiftDay(1)}>
          ›
        </button>
        {existing && !imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#22cc78',
              background: 'rgba(34,204,120,0.12)',
              border: '1px solid rgba(34,204,120,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="A workout is saved for this day"
          >
            Saved ✓
          </span>
        )}
        {imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#f5c060',
              background: 'rgba(245,192,96,0.12)',
              border: '1px solid rgba(245,192,96,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="Imported historical total"
          >
            Imported
          </span>
        )}
      </div>

      {imported && (
        <p className="muted" style={{ marginTop: 0 }}>
          📊 Imported total: <strong>{Math.round(logPoints(person, existing!))} pts</strong> — no
          per-exercise breakdown. Entering values below will replace it.
        </p>
      )}

      {/* goal / live total */}
      <div style={{ margin: '0.5rem 0 1rem' }}>
        <div
          style={{
            height: 12,
            borderRadius: 6,
            background: 'var(--b1, rgba(127,127,127,0.18))',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${pct}%`,
              background: hit ? '#22cc78' : 'var(--accent, #7c6af7)',
              borderRadius: 6,
              transition: 'width .2s',
            }}
          />
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          <span
            className="cz-num"
            style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: hit ? '#22cc78' : 'var(--accent, #7c6af7)',
            }}
          >
            {Math.round(total)}
          </span>{' '}
          <span style={{ fontSize: '0.82rem' }}>
            / {goal} pts {hit ? '✓ goal hit!' : ''}
          </span>
        </div>
      </div>

      {/* exercise sections by category */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0.25rem 0 0.6rem',
        }}
      >
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Exercises
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => setManaging(true)}
          style={{ fontSize: '0.8rem' }}
          title="Add, rename, reweight, or reorder this person's exercises"
        >
          ⚙️ Edit exercises
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {cols.map((col, ci) => (
          <div key={ci}>
            <div style={{ fontWeight: 700, opacity: 0.75, marginBottom: '0.4rem' }}>
              {col.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {col.exs.map((ex) => {
                const v = parseFloat(vals[ex.id]) || 0
                const pts = v * ex.mult
                return (
                  <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{ex.name}</span>
                    <ScrubInput
                      value={vals[ex.id] ?? ''}
                      onChange={(v) => setVal(ex.id, v)}
                      style={{ width: 80, textAlign: 'right', padding: '0.35rem 0.5rem' }}
                    />
                    <span className="muted" style={{ width: 44, fontSize: '0.8rem' }}>
                      {ex.unit}
                    </span>
                    <span className="muted" style={{ width: 44, fontSize: '0.75rem' }}>
                      ×{ex.mult}
                    </span>
                    <span
                      style={{
                        width: 54,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: pts > 0 ? 'var(--accent, #7c6af7)' : 'inherit',
                        opacity: pts > 0 ? 1 : 0.4,
                      }}
                    >
                      {pts > 0 ? `${Math.round(pts * 10) / 10} pt` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={copyLast}
          title="Fill from this person's most recent workout"
        >
          ⧉ Copy last
        </button>
        <button className="btn" onClick={clear}>
          Clear
        </button>
        {existing && (
          <button
            className="btn"
            onClick={() => {
              void circuitStore.deleteLog(existing.id)
              setVals({})
            }}
          >
            Delete
          </button>
        )}
        <button
          className="btn"
          onClick={save}
          style={{
            background: 'var(--accent, #7c6af7)',
            color: '#fff',
            borderColor: 'transparent',
          }}
        >
          Save
        </button>
      </div>

      {managing && <ExerciseManager person={person} onClose={() => setManaging(false)} />}
    </div>
  )
}
